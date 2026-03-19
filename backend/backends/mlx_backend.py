"""
MLX backend implementation for TTS and STT using mlx-audio.
"""

import asyncio
import logging
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from . import LANGUAGE_CODE_TO_NAME, STTBackend, TTSBackend, WHISPER_HF_REPOS
from .base import (
    combine_voice_prompts as _combine_voice_prompts,
    force_hf_offline_if_cached,
    get_cached_snapshot_path,
    is_model_cached,
    model_load_progress,
)
from ..utils.cache import cache_voice_prompt, get_cache_key, get_cached_voice_prompt

logger = logging.getLogger(__name__)


class MLXTTSBackend:
    """MLX-based TTS backend using mlx-audio."""

    def __init__(self, model_size: str = "1.7B"):
        self.model = None
        self.model_size = model_size
        self._current_model_size = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def _get_model_path(self, model_size: str) -> str:
        model_map = {
            "1.7B": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
            "0.6B": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        }
        if model_size not in model_map:
            raise ValueError(f"Unknown model size: {model_size}")
        return model_map[model_size]

    def _is_model_cached(self, model_size: str) -> bool:
        return is_model_cached(
            self._get_model_path(model_size),
            weight_extensions=(".safetensors", ".bin", ".npz"),
        )

    async def load_model_async(self, model_size: Optional[str] = None):
        if model_size is None:
            model_size = self.model_size
        if self.model is not None and self._current_model_size == model_size:
            return
        if self.model is not None and self._current_model_size != model_size:
            self.unload_model()
        await asyncio.to_thread(self._load_model_sync, model_size)

    load_model = load_model_async

    def _load_model_sync(self, model_size: str):
        model_ref = self._get_model_path(model_size)
        model_source = model_ref
        model_name = f"qwen-tts-{model_size}"
        is_cached = self._is_model_cached(model_size)

        if is_cached:
            snapshot_path = get_cached_snapshot_path(
                model_ref,
                weight_extensions=(".safetensors", ".bin", ".npz"),
            )
            if snapshot_path is not None:
                model_source = str(snapshot_path)
                logger.info("Using local cached snapshot for %s: %s", model_ref, model_source)

        with model_load_progress(model_name, is_cached):
            from mlx_audio.tts import load

            logger.info("Loading MLX TTS model %s...", model_size)
            with force_hf_offline_if_cached(is_cached):
                self.model = load(model_source)

        self._current_model_size = model_size
        self.model_size = model_size
        logger.info("MLX TTS model %s loaded successfully", model_size)

    def unload_model(self):
        if self.model is not None:
            del self.model
            self.model = None
            self._current_model_size = None
            logger.info("MLX TTS model unloaded")

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> Tuple[dict, bool]:
        await self.load_model_async(None)

        if use_cache:
            cache_key = get_cache_key(audio_path, reference_text)
            cached_prompt = get_cached_voice_prompt(cache_key)
            if isinstance(cached_prompt, dict):
                cached_audio_path = cached_prompt.get("ref_audio") or cached_prompt.get("ref_audio_path")
                if cached_audio_path and Path(cached_audio_path).exists():
                    return cached_prompt, True
                logger.warning("Cached audio file not found: %s, regenerating prompt", cached_audio_path)

        voice_prompt = {"ref_audio": str(audio_path), "ref_text": reference_text}
        if use_cache:
            cache_voice_prompt(get_cache_key(audio_path, reference_text), voice_prompt)
        return voice_prompt, False

    async def combine_voice_prompts(
        self,
        audio_paths: List[str],
        reference_texts: List[str],
    ) -> Tuple[np.ndarray, str]:
        return await _combine_voice_prompts(audio_paths, reference_texts)

    async def generate(
        self,
        text: str,
        voice_prompt: dict,
        language: str = "en",
        seed: Optional[int] = None,
        instruct: Optional[str] = None,
    ) -> Tuple[np.ndarray, int]:
        await self.load_model_async(None)

        def _generate_sync():
            audio_chunks: list[np.ndarray] = []
            sample_rate = 24000
            lang = LANGUAGE_CODE_TO_NAME.get(language, "auto")

            if seed is not None:
                import mlx.core as mx

                np.random.seed(seed)
                mx.random.seed(seed)

            ref_audio = voice_prompt.get("ref_audio") or voice_prompt.get("ref_audio_path")
            ref_text = voice_prompt.get("ref_text", "")

            if ref_audio and not Path(ref_audio).exists():
                logger.warning("Audio file not found: %s", ref_audio)
                ref_audio = None

            try:
                import inspect

                sig = inspect.signature(self.model.generate)
                if ref_audio and "ref_audio" in sig.parameters:
                    iterator = self.model.generate(text, ref_audio=ref_audio, ref_text=ref_text, lang_code=lang)
                else:
                    iterator = self.model.generate(text, lang_code=lang)
            except Exception as exc:
                logger.warning("Voice cloning failed, generating without voice prompt: %s", exc)
                iterator = self.model.generate(text, lang_code=lang)

            for result in iterator:
                audio_chunks.append(np.asarray(result.audio, dtype=np.float32))
                sample_rate = result.sample_rate

            audio = np.concatenate(audio_chunks) if audio_chunks else np.array([], dtype=np.float32)
            return audio, sample_rate

        return await asyncio.to_thread(_generate_sync)


class MLXSTTBackend:
    """MLX-based STT backend using mlx-audio Whisper."""

    def __init__(self, model_size: str = "base"):
        self.model = None
        self.model_size = model_size

    def is_loaded(self) -> bool:
        return self.model is not None

    def _is_model_cached(self, model_size: str) -> bool:
        return is_model_cached(
            WHISPER_HF_REPOS.get(model_size, f"openai/whisper-{model_size}"),
            weight_extensions=(".safetensors", ".bin", ".npz"),
        )

    async def load_model_async(self, model_size: Optional[str] = None):
        if model_size is None:
            model_size = self.model_size
        if self.model is not None and self.model_size == model_size:
            return
        await asyncio.to_thread(self._load_model_sync, model_size)

    load_model = load_model_async

    def _load_model_sync(self, model_size: str):
        progress_model_name = f"whisper-{model_size}"
        is_cached = self._is_model_cached(model_size)

        with model_load_progress(progress_model_name, is_cached):
            from mlx_audio.stt import load

            model_name = WHISPER_HF_REPOS.get(model_size, f"openai/whisper-{model_size}")
            logger.info("Loading MLX Whisper model %s...", model_size)
            with force_hf_offline_if_cached(is_cached):
                self.model = load(model_name)

        self.model_size = model_size
        logger.info("MLX Whisper model %s loaded successfully", model_size)

    def unload_model(self):
        if self.model is not None:
            del self.model
            self.model = None
            logger.info("MLX Whisper model unloaded")

    async def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        model_size: Optional[str] = None,
    ) -> str:
        await self.load_model_async(model_size)

        def _transcribe_sync():
            decode_options = {"task": "transcribe"}
            if language:
                decode_options["language"] = language

            result = self.model.generate(str(audio_path), **decode_options)
            if isinstance(result, str):
                return result.strip()
            if isinstance(result, dict):
                return result.get("text", "").strip()
            if hasattr(result, "text"):
                return result.text.strip()
            return str(result).strip()

        return await asyncio.to_thread(_transcribe_sync)
