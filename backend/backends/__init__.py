"""
Backend abstraction layer for TTS and STT.

Provides a unified interface for MLX and PyTorch backends,
and a model config registry that eliminates hard-coded model maps.
"""

import threading
from dataclasses import dataclass, field
from typing import Protocol, Optional, Tuple, List

import numpy as np
from typing_extensions import runtime_checkable

from ..platform_detect import get_backend_type

LANGUAGE_CODE_TO_NAME = {
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
    "he": "hebrew",
    "ar": "arabic",
    "da": "danish",
    "el": "greek",
    "fi": "finnish",
    "hi": "hindi",
    "ms": "malay",
    "nl": "dutch",
    "no": "norwegian",
    "pl": "polish",
    "sv": "swedish",
    "sw": "swahili",
    "tr": "turkish",
}

WHISPER_HF_REPOS = {
    "base": "openai/whisper-base",
    "small": "openai/whisper-small",
    "medium": "openai/whisper-medium",
    "large": "openai/whisper-large-v3",
    "turbo": "openai/whisper-large-v3-turbo",
}

DEFAULT_QWEN_LANGUAGES = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]
CHATTERBOX_LANGUAGES = DEFAULT_QWEN_LANGUAGES + [
    "he",
    "ar",
    "da",
    "el",
    "fi",
    "hi",
    "ms",
    "nl",
    "no",
    "pl",
    "sv",
    "sw",
    "tr",
]


@dataclass
class ModelConfig:
    """Declarative config for a downloadable model variant."""

    model_name: str
    display_name: str
    engine: str
    hf_repo_id: str
    model_size: str = "default"
    size_mb: int = 0
    needs_trim: bool = False
    supports_instruct: bool = False
    languages: list[str] = field(default_factory=lambda: ["en"])


@runtime_checkable
class TTSBackend(Protocol):
    async def load_model(self, model_size: str) -> None:
        ...

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> Tuple[dict, bool]:
        ...

    async def combine_voice_prompts(
        self,
        audio_paths: List[str],
        reference_texts: List[str],
    ) -> Tuple[np.ndarray, str]:
        ...

    async def generate(
        self,
        text: str,
        voice_prompt: dict,
        language: str = "en",
        seed: Optional[int] = None,
        instruct: Optional[str] = None,
    ) -> Tuple[np.ndarray, int]:
        ...

    def unload_model(self) -> None:
        ...

    def is_loaded(self) -> bool:
        ...

    def _get_model_path(self, model_size: str) -> str:
        ...


@runtime_checkable
class STTBackend(Protocol):
    async def load_model(self, model_size: str) -> None:
        ...

    async def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        model_size: Optional[str] = None,
    ) -> str:
        ...

    def unload_model(self) -> None:
        ...

    def is_loaded(self) -> bool:
        ...


_tts_backends: dict[str, TTSBackend] = {}
_tts_backends_lock = threading.Lock()
_stt_backend: Optional[STTBackend] = None

TTS_ENGINES = {
    "qwen": "Qwen TTS",
    "luxtts": "LuxTTS",
    "chatterbox": "Chatterbox TTS",
    "chatterbox_turbo": "Chatterbox Turbo",
}


def _get_qwen_model_configs() -> list[ModelConfig]:
    backend_type = get_backend_type()
    if backend_type == "mlx":
        repo_1_7b = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
        repo_0_6b = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"
    else:
        repo_1_7b = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
        repo_0_6b = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"

    return [
        ModelConfig(
            model_name="qwen-tts-1.7B",
            display_name="Qwen TTS 1.7B",
            engine="qwen",
            hf_repo_id=repo_1_7b,
            model_size="1.7B",
            size_mb=3500,
            supports_instruct=True,
            languages=DEFAULT_QWEN_LANGUAGES,
        ),
        ModelConfig(
            model_name="qwen-tts-0.6B",
            display_name="Qwen TTS 0.6B",
            engine="qwen",
            hf_repo_id=repo_0_6b,
            model_size="0.6B",
            size_mb=1200,
            supports_instruct=True,
            languages=DEFAULT_QWEN_LANGUAGES,
        ),
    ]


def _get_non_qwen_tts_configs() -> list[ModelConfig]:
    return [
        ModelConfig(
            model_name="luxtts",
            display_name="LuxTTS (Fast, CPU-friendly)",
            engine="luxtts",
            hf_repo_id="YatharthS/LuxTTS",
            size_mb=300,
            languages=["en"],
        ),
        ModelConfig(
            model_name="chatterbox-tts",
            display_name="Chatterbox TTS (Multilingual)",
            engine="chatterbox",
            hf_repo_id="ResembleAI/chatterbox",
            size_mb=3200,
            needs_trim=True,
            languages=CHATTERBOX_LANGUAGES,
        ),
        ModelConfig(
            model_name="chatterbox-turbo",
            display_name="Chatterbox Turbo (English, Tags)",
            engine="chatterbox_turbo",
            hf_repo_id="ResembleAI/chatterbox-turbo",
            size_mb=1500,
            needs_trim=True,
            languages=["en"],
        ),
    ]


def _get_whisper_configs() -> list[ModelConfig]:
    return [
        ModelConfig(
            model_name="whisper-base",
            display_name="Whisper Base",
            engine="whisper",
            hf_repo_id=WHISPER_HF_REPOS["base"],
            model_size="base",
        ),
        ModelConfig(
            model_name="whisper-small",
            display_name="Whisper Small",
            engine="whisper",
            hf_repo_id=WHISPER_HF_REPOS["small"],
            model_size="small",
        ),
        ModelConfig(
            model_name="whisper-medium",
            display_name="Whisper Medium",
            engine="whisper",
            hf_repo_id=WHISPER_HF_REPOS["medium"],
            model_size="medium",
        ),
        ModelConfig(
            model_name="whisper-large",
            display_name="Whisper Large",
            engine="whisper",
            hf_repo_id=WHISPER_HF_REPOS["large"],
            model_size="large",
        ),
        ModelConfig(
            model_name="whisper-turbo",
            display_name="Whisper Turbo",
            engine="whisper",
            hf_repo_id=WHISPER_HF_REPOS["turbo"],
            model_size="turbo",
        ),
    ]


def get_all_model_configs() -> list[ModelConfig]:
    return _get_qwen_model_configs() + _get_non_qwen_tts_configs() + _get_whisper_configs()


def get_tts_model_configs() -> list[ModelConfig]:
    return _get_qwen_model_configs() + _get_non_qwen_tts_configs()


def get_model_config(model_name: str) -> Optional[ModelConfig]:
    return next((cfg for cfg in get_all_model_configs() if cfg.model_name == model_name), None)


def get_engine_default_model_name(engine: str, model_size: str = "default") -> Optional[str]:
    for cfg in get_tts_model_configs():
        if cfg.engine == engine and cfg.model_size == model_size:
            return cfg.model_name
    if model_size != "default":
        return get_engine_default_model_name(engine, "default")
    return next((cfg.model_name for cfg in get_tts_model_configs() if cfg.engine == engine), None)


def get_engine_config(engine: str, model_size: str = "default") -> Optional[ModelConfig]:
    model_name = get_engine_default_model_name(engine, model_size)
    return get_model_config(model_name) if model_name else None


def engine_needs_trim(engine: str) -> bool:
    cfg = get_engine_config(engine)
    return bool(cfg and cfg.needs_trim)


def engine_has_model_sizes(engine: str) -> bool:
    return len([cfg for cfg in get_tts_model_configs() if cfg.engine == engine]) > 1


def engine_supports_instruct(engine: str) -> bool:
    return any(cfg.supports_instruct for cfg in get_tts_model_configs() if cfg.engine == engine)


async def load_engine_model(engine: str, model_size: str = "default") -> None:
    backend = get_tts_backend_for_engine(engine)
    if engine == "qwen":
        await backend.load_model_async(model_size)
    else:
        await backend.load_model(model_size)


def get_tts_backend() -> TTSBackend:
    return get_tts_backend_for_engine("qwen")


def get_tts_backend_for_engine(engine: str) -> TTSBackend:
    if engine in _tts_backends:
        return _tts_backends[engine]

    with _tts_backends_lock:
        if engine in _tts_backends:
            return _tts_backends[engine]

        if engine == "qwen":
            backend_type = get_backend_type()
            if backend_type == "mlx":
                from .mlx_backend import MLXTTSBackend

                backend = MLXTTSBackend()
            else:
                from .pytorch_backend import PyTorchTTSBackend

                backend = PyTorchTTSBackend()
        elif engine == "luxtts":
            from .luxtts_backend import LuxTTSBackend

            backend = LuxTTSBackend()
        elif engine == "chatterbox":
            from .chatterbox_backend import ChatterboxTTSBackend

            backend = ChatterboxTTSBackend()
        elif engine == "chatterbox_turbo":
            from .chatterbox_turbo_backend import ChatterboxTurboTTSBackend

            backend = ChatterboxTurboTTSBackend()
        else:
            raise ValueError(f"Unknown TTS engine: {engine}. Supported: {list(TTS_ENGINES.keys())}")

        _tts_backends[engine] = backend
        return backend


def get_stt_backend() -> STTBackend:
    global _stt_backend

    if _stt_backend is None:
        backend_type = get_backend_type()
        if backend_type == "mlx":
            from .mlx_backend import MLXSTTBackend

            _stt_backend = MLXSTTBackend()
        else:
            from .pytorch_backend import PyTorchSTTBackend

            _stt_backend = PyTorchSTTBackend()

    return _stt_backend


def check_model_loaded(config: ModelConfig) -> bool:
    try:
        if config.engine == "whisper":
            whisper_model = get_stt_backend()
            return whisper_model.is_loaded() and getattr(whisper_model, "model_size", None) == config.model_size

        if config.engine == "qwen":
            tts_model = get_tts_backend()
            loaded_size = getattr(tts_model, "_current_model_size", None) or getattr(tts_model, "model_size", None)
            return tts_model.is_loaded() and loaded_size == config.model_size

        return get_tts_backend_for_engine(config.engine).is_loaded()
    except Exception:
        return False


def get_model_load_func(config: ModelConfig):
    if config.engine == "whisper":
        return lambda: get_stt_backend().load_model(config.model_size)

    if config.engine == "qwen":
        return lambda: get_tts_backend().load_model(config.model_size)

    return lambda: get_tts_backend_for_engine(config.engine).load_model(config.model_size)


def unload_model_by_config(config: ModelConfig) -> bool:
    if config.engine == "whisper":
        whisper_model = get_stt_backend()
        if whisper_model.is_loaded() and getattr(whisper_model, "model_size", None) == config.model_size:
            whisper_model.unload_model()
            return True
        return False

    if config.engine == "qwen":
        tts_model = get_tts_backend()
        loaded_size = getattr(tts_model, "_current_model_size", None) or getattr(tts_model, "model_size", None)
        if tts_model.is_loaded() and loaded_size == config.model_size:
            tts_model.unload_model()
            return True
        return False

    backend = get_tts_backend_for_engine(config.engine)
    if backend.is_loaded():
        backend.unload_model()
        return True
    return False


def reset_backends():
    global _stt_backend
    _tts_backends.clear()
    _stt_backend = None
