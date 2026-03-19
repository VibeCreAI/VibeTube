"""
Chatterbox TTS backend implementation.

Wraps ChatterboxMultilingualTTS for zero-shot multilingual voice cloning.
"""

import asyncio
import logging
import threading
from pathlib import Path
from typing import ClassVar, List, Optional, Tuple

import numpy as np

from .base import (
    combine_voice_prompts as _combine_voice_prompts,
    get_torch_device,
    is_model_cached,
    model_load_progress,
    patch_chatterbox_f32,
)

logger = logging.getLogger(__name__)

CHATTERBOX_HF_REPO = "ResembleAI/chatterbox"
_MTL_WEIGHT_FILES = ["t3_mtl23ls_v2.safetensors", "s3gen.pt", "ve.pt"]


class ChatterboxTTSBackend:
    """Chatterbox multilingual TTS backend."""

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
        return CHATTERBOX_HF_REPO

    def _is_model_cached(self, model_size: str = "default") -> bool:
        return is_model_cached(CHATTERBOX_HF_REPO, required_files=_MTL_WEIGHT_FILES)

    async def load_model(self, model_size: str = "default") -> None:
        if self.model is not None:
            return
        async with self._model_load_lock:
            if self.model is not None:
                return
            await asyncio.to_thread(self._load_model_sync)

    def _load_model_sync(self):
        model_name = "chatterbox-tts"
        is_cached = self._is_model_cached()

        with model_load_progress(model_name, is_cached):
            device = self._get_device()
            self._device = device
            logger.info("Loading Chatterbox multilingual TTS on %s...", device)

            import torch
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            if device == "cpu":
                original_torch_load = torch.load

                def _patched_load(*args, **kwargs):
                    kwargs.setdefault("map_location", "cpu")
                    return original_torch_load(*args, **kwargs)

                with ChatterboxTTSBackend._load_lock:
                    torch.load = _patched_load
                    try:
                        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
                    finally:
                        torch.load = original_torch_load
            else:
                model = ChatterboxMultilingualTTS.from_pretrained(device=device)

            transformer = model.t3.tfmr
            if hasattr(transformer, "config") and hasattr(transformer.config, "_attn_implementation"):
                transformer.config._attn_implementation = "eager"
                for layer in getattr(transformer, "layers", []):
                    if hasattr(layer, "self_attn"):
                        layer.self_attn._attn_implementation = "eager"

            patch_chatterbox_f32(model)
            self.model = model

        logger.info("Chatterbox multilingual TTS loaded successfully")

    def unload_model(self) -> None:
        if self.model is not None:
            device = self._device
            del self.model
            self.model = None
            self._device = None

            if device == "cuda":
                import torch

                torch.cuda.empty_cache()

            logger.info("Chatterbox unloaded")

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

    _LANG_DEFAULTS: ClassVar[dict] = {
        "he": {
            "exaggeration": 0.4,
            "cfg_weight": 0.7,
            "temperature": 0.65,
            "repetition_penalty": 2.5,
        }
    }
    _GLOBAL_DEFAULTS: ClassVar[dict] = {
        "exaggeration": 0.5,
        "cfg_weight": 0.5,
        "temperature": 0.8,
        "repetition_penalty": 2.0,
    }

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

        language_defaults = self._LANG_DEFAULTS.get(language, self._GLOBAL_DEFAULTS)

        def _generate_sync():
            import torch

            if seed is not None:
                torch.manual_seed(seed)

            wav = self.model.generate(
                text,
                language_id=language,
                audio_prompt_path=ref_audio,
                exaggeration=language_defaults["exaggeration"],
                cfg_weight=language_defaults["cfg_weight"],
                temperature=language_defaults["temperature"],
                repetition_penalty=language_defaults["repetition_penalty"],
            )
            if isinstance(wav, torch.Tensor):
                audio = wav.squeeze().cpu().numpy().astype(np.float32)
            else:
                audio = np.asarray(wav, dtype=np.float32)

            sample_rate = getattr(self.model, "sr", None) or getattr(self.model, "sample_rate", 24000)
            return audio, sample_rate

        return await asyncio.to_thread(_generate_sync)
