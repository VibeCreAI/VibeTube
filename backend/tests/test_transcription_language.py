import asyncio
from io import BytesIO

import numpy as np
from fastapi import UploadFile

from backend import main
from backend.backends.mlx_backend import MLXSTTBackend


class DummyWhisperModel:
    def __init__(self):
        self.model_size = "base"
        self.calls = []

    async def transcribe(self, audio_path: str, language: str | None):
        self.calls.append((audio_path, language))
        return "stub transcript"


class DummyMLXModel:
    def __init__(self):
        self.calls = []

    def generate(self, audio_path: str, **kwargs):
        self.calls.append((audio_path, kwargs))
        return "mlx transcript"


def _make_upload_file() -> UploadFile:
    return UploadFile(filename="sample.wav", file=BytesIO(b"fake-audio"))


def test_transcribe_endpoint_omits_language_for_auto_detect(monkeypatch, tmp_path):
    dummy_model = DummyWhisperModel()
    repo_cache = tmp_path / "models--openai--whisper-base"
    repo_cache.mkdir(parents=True)

    monkeypatch.setattr(main.transcribe, "get_whisper_model", lambda: dummy_model)
    monkeypatch.setattr("huggingface_hub.constants.HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr("backend.utils.audio.load_audio", lambda *_args, **_kwargs: (np.zeros(16000), 16000))

    response = asyncio.run(main.transcribe_audio(file=_make_upload_file(), language=None))

    assert response.text == "stub transcript"
    assert response.duration == 1.0
    assert dummy_model.calls[0][1] is None


def test_transcribe_endpoint_forwards_explicit_language(monkeypatch, tmp_path):
    dummy_model = DummyWhisperModel()
    repo_cache = tmp_path / "models--openai--whisper-base"
    repo_cache.mkdir(parents=True)

    monkeypatch.setattr(main.transcribe, "get_whisper_model", lambda: dummy_model)
    monkeypatch.setattr("huggingface_hub.constants.HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr("backend.utils.audio.load_audio", lambda *_args, **_kwargs: (np.zeros(8000), 16000))

    response = asyncio.run(main.transcribe_audio(file=_make_upload_file(), language="ko"))

    assert response.text == "stub transcript"
    assert response.duration == 0.5
    assert dummy_model.calls[0][1] == "ko"


def test_mlx_transcribe_uses_transcribe_task(monkeypatch):
    backend = MLXSTTBackend()
    backend.model = DummyMLXModel()

    async def _noop_load_model_async(_model_size=None):
        return None

    monkeypatch.setattr(backend, "load_model_async", _noop_load_model_async)

    result = asyncio.run(backend.transcribe("sample.wav", "ko"))

    assert result == "mlx transcript"
    assert backend.model.calls == [
        ("sample.wav", {"task": "transcribe", "language": "ko"})
    ]
