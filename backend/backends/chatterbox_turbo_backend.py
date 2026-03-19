"""
Chatterbox Turbo TTS backend implementation.

Wraps ChatterboxTurboTTS for fast English-only voice cloning.
"""

import asyncio
import logging
import threading
from pathlib import Path
from typing import ClassVar, List, Optional, Tuple

import numpy as np

from .base import (
    combine_voice_prompts as _combine_voice_prompts,
    force_hf_offline_if_cached,
    get_torch_device,
    is_model_cached,
    model_load_progress,
    patch_chatterbox_f32,
)

logger = logging.getLogger(__name__)

CHATTERBOX_TURBO_HF_REPO = "ResembleAI/chatterbox-turbo"
_TURBO_WEIGHT_FILES = ["t3_turbo_v1.safetensors", "s3gen_meanflow.safetensors", "ve.safetensors"]


class ChatterboxTurboTTSBackend:
    """Chatterbox Turbo backend."""

    _load_lock: ClassVar[threading.Lock] = threading.Lock()

    def __init__(self):
        self.model = None
        self.model_size = "default"
        self._device = None
        self._model_load_lock = asyncio.Lock()

    def _get_device(self):
        return get_torch_device(force_cpu_on_mac=True)

    def is_loaded(self) -> bool:
        return self.model is not None

    def _get_model_path(self, model_size: str = "default") -> str:
        return CHATTERBOX_TURBO_HF_REPO

    def _is_model_cached(self, model_size: str = "default") -> bool:
        return is_model_cached(CHATTERBOX_TURBO_HF_REPO, required_files=_TURBO_WEIGHT_FILES)

    async def load_model(self, model_size: str = "default") -> None:
        if self.model is not None:
            return
        async with self._model_load_lock:
            if self.model is not None:
                return
            await asyncio.to_thread(self._load_model_sync)

    def _load_model_sync(self):
        model_name = "chatterbox-turbo"
        is_cached = self._is_model_cached()

        with model_load_progress(model_name, is_cached):
            import torch
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            from huggingface_hub import snapshot_download

            device = self._get_device()
            self._device = device
            logger.info("Loading Chatterbox Turbo on %s...", device)

            with force_hf_offline_if_cached(is_cached):
                local_path = snapshot_download(
                    repo_id=CHATTERBOX_TURBO_HF_REPO,
                    token=None,
                    allow_patterns=["*.safetensors", "*.json", "*.txt", "*.pt", "*.model"],
                    local_files_only=is_cached,
                )

            if device == "cpu":
                original_torch_load = torch.load

                def _patched_load(*args, **kwargs):
                    kwargs.setdefault("map_location", "cpu")
                    return original_torch_load(*args, **kwargs)

                with ChatterboxTurboTTSBackend._load_lock:
                    torch.load = _patched_load
                    try:
                        model = ChatterboxTurboTTS.from_local(local_path, device)
                    finally:
                        torch.load = original_torch_load
            else:
                model = ChatterboxTurboTTS.from_local(local_path, device)

            patch_chatterbox_f32(model)
            self.model = model

        logger.info("Chatterbox Turbo loaded successfully")

    def unload_model(self) -> None:
        if self.model is not None:
            device = self._device
            del self.model
            self.model = None
            self._device = None

            if device == "cuda":
                import torch

                torch.cuda.empty_cache()

            logger.info("Chatterbox Turbo unloaded")

    async def create_voice_prompt(
        self,
        audio_path: str,
        reference_text: str,
        use_cache: bool = True,
    ) -> Tuple[dict, bool]:
        return {"ref_audio": str(audio_path), "ref_text": reference_text}, False

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
        await self.load_model()

        ref_audio = voice_prompt.get("ref_audio")
        if ref_audio and not Path(ref_audio).exists():
            logger.warning("Reference audio not found: %s", ref_audio)
            ref_audio = None

        def _generate_sync():
            import torch

            if seed is not None:
                torch.manual_seed(seed)

            wav = self.model.generate(
                text,
                audio_prompt_path=ref_audio,
                temperature=0.8,
                top_k=1000,
                top_p=0.95,
                repetition_penalty=1.2,
            )
            if isinstance(wav, torch.Tensor):
                audio = wav.squeeze().cpu().numpy().astype(np.float32)
            else:
                audio = np.asarray(wav, dtype=np.float32)

            sample_rate = getattr(self.model, "sr", None) or getattr(self.model, "sample_rate", 24000)
            return audio, sample_rate

        return await asyncio.to_thread(_generate_sync)
