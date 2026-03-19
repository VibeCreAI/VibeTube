"""
PyTorch backend implementation for TTS and STT.
"""

import asyncio
import logging
from typing import List, Optional, Tuple

import numpy as np
import torch

from . import LANGUAGE_CODE_TO_NAME, STTBackend, TTSBackend, WHISPER_HF_REPOS
from .base import (
    combine_voice_prompts as _combine_voice_prompts,
    force_hf_offline_if_cached,
    get_cached_snapshot_path,
    get_torch_device,
    is_model_cached,
    model_load_progress,
)
from ..utils.audio import load_audio
from ..utils.cache import cache_voice_prompt, get_cache_key, get_cached_voice_prompt

logger = logging.getLogger(__name__)


class PyTorchTTSBackend:
    """PyTorch-based TTS backend using Qwen3-TTS."""

    def __init__(self, model_size: str = "1.7B"):
        self.model = None
        self.model_size = model_size
        self.device = self._get_device()
        self._current_model_size = None

    def _get_device(self):
        return get_torch_device(allow_xpu=True, allow_directml=True)

    def is_loaded(self) -> bool:
        return self.model is not None

    def _get_model_path(self, model_size: str) -> str:
        model_map = {
            "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
            "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        }
        if model_size not in model_map:
            raise ValueError(f"Unknown model size: {model_size}")
        return model_map[model_size]

    def _is_model_cached(self, model_size: str) -> bool:
        return is_model_cached(self._get_model_path(model_size))

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
        model_name = f"qwen-tts-{model_size}"
        is_cached = self._is_model_cached(model_size)
        model_ref = self._get_model_path(model_size)
        model_source = model_ref

        if is_cached:
            snapshot_path = get_cached_snapshot_path(model_ref)
            if snapshot_path is not None:
                model_source = str(snapshot_path)
                logger.info("Using local cached snapshot for %s: %s", model_ref, model_source)

        with model_load_progress(model_name, is_cached):
            from qwen_tts import Qwen3TTSModel

            logger.info("Loading TTS model %s on %s...", model_size, self.device)

            with force_hf_offline_if_cached(is_cached):
                if self.device == "cpu":
                    self.model = Qwen3TTSModel.from_pretrained(
                        model_source,
                        torch_dtype=torch.float32,
                        low_cpu_mem_usage=False,
                        local_files_only=is_cached,
                    )
                else:
                    self.model = Qwen3TTSModel.from_pretrained(
                        model_source,
                        device_map=self.device,
                        torch_dtype=torch.bfloat16,
                        local_files_only=is_cached,
                    )

        self._current_model_size = model_size
        self.model_size = model_size
        logger.info("TTS model %s loaded successfully", model_size)

    def unload_model(self):
        if self.model is not None:
            del self.model
            self.model = None
            self._current_model_size = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("TTS model unloaded")

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
            if cached_prompt is not None:
                if isinstance(cached_prompt, dict):
                    return cached_prompt, True
                if isinstance(cached_prompt, torch.Tensor):
                    return {"prompt": cached_prompt}, True

        def _create_prompt_sync():
            return self.model.create_voice_clone_prompt(
                ref_audio=str(audio_path),
                ref_text=reference_text,
                x_vector_only_mode=False,
            )

        voice_prompt = await asyncio.to_thread(_create_prompt_sync)

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
            if seed is not None:
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed(seed)

            wavs, sample_rate = self.model.generate_voice_clone(
                text=text,
                voice_clone_prompt=voice_prompt,
                language=LANGUAGE_CODE_TO_NAME.get(language, "auto"),
                instruct=instruct,
            )
            return wavs[0], sample_rate

        return await asyncio.to_thread(_generate_sync)


class PyTorchSTTBackend:
    """PyTorch-based STT backend using Whisper."""

    def __init__(self, model_size: str = "base"):
        self.model = None
        self.processor = None
        self.model_size = model_size
        self.device = self._get_device()

    def _get_device(self):
        return get_torch_device(allow_xpu=True, allow_directml=True)

    def is_loaded(self) -> bool:
        return self.model is not None

    def _is_model_cached(self, model_size: str) -> bool:
        return is_model_cached(WHISPER_HF_REPOS.get(model_size, f"openai/whisper-{model_size}"))

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
            from transformers import WhisperForConditionalGeneration, WhisperProcessor

            model_name = WHISPER_HF_REPOS.get(model_size, f"openai/whisper-{model_size}")
            logger.info("Loading Whisper model %s on %s...", model_size, self.device)
            with force_hf_offline_if_cached(is_cached):
                self.processor = WhisperProcessor.from_pretrained(
                    model_name,
                    local_files_only=is_cached,
                )
                self.model = WhisperForConditionalGeneration.from_pretrained(
                    model_name,
                    local_files_only=is_cached,
                )

        self.model.to(self.device)
        self.model_size = model_size
        logger.info("Whisper model %s loaded successfully", model_size)

    def unload_model(self):
        if self.model is not None:
            del self.model
            del self.processor
            self.model = None
            self.processor = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("Whisper model unloaded")

    async def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        model_size: Optional[str] = None,
    ) -> str:
        await self.load_model_async(model_size)

        def _transcribe_sync():
            audio, _ = load_audio(audio_path, sample_rate=16000)
            inputs = self.processor(audio, sampling_rate=16000, return_tensors="pt")
            inputs = inputs.to(self.device)

            generate_kwargs = {}
            if language:
                generate_kwargs["forced_decoder_ids"] = self.processor.get_decoder_prompt_ids(
                    language=language,
                    task="transcribe",
                )

            with torch.no_grad():
                predicted_ids = self.model.generate(inputs["input_features"], **generate_kwargs)

            return self.processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()

        return await asyncio.to_thread(_transcribe_sync)
