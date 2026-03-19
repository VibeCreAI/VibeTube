"""
Shared utilities for TTS/STT backend implementations.

Eliminates duplication of cache checking, device detection,
voice prompt combination, and model loading progress tracking.
"""

import logging
import platform
from contextlib import contextmanager
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from ..utils.audio import normalize_audio, load_audio
from ..utils.progress import get_progress_manager
from ..utils.hf_progress import HFProgressTracker, create_hf_progress_callback
from ..utils.tasks import get_task_manager

logger = logging.getLogger(__name__)


def is_model_cached(
    hf_repo: str,
    *,
    weight_extensions: tuple[str, ...] = (".safetensors", ".bin"),
    required_files: Optional[list[str]] = None,
) -> bool:
    """
    Check if a HuggingFace model is fully cached locally.
    """
    try:
        from huggingface_hub import constants as hf_constants

        repo_cache = Path(hf_constants.HF_HUB_CACHE) / ("models--" + hf_repo.replace("/", "--"))
        if not repo_cache.exists():
            return False

        blobs_dir = repo_cache / "blobs"
        if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
            logger.debug("Found incomplete blobs for %s", hf_repo)
            return False

        snapshots_dir = repo_cache / "snapshots"
        if not snapshots_dir.exists():
            return False

        if required_files:
            return all(any(snapshots_dir.rglob(name)) for name in required_files)

        for ext in weight_extensions:
            if any(snapshots_dir.rglob(f"*{ext}")):
                return True

        logger.debug("No model weights found for %s", hf_repo)
        return False
    except Exception as exc:
        logger.warning("Error checking cache for %s: %s", hf_repo, exc)
        return False


def get_torch_device(
    *,
    allow_xpu: bool = False,
    allow_directml: bool = False,
    allow_mps: bool = False,
    force_cpu_on_mac: bool = False,
):
    """Detect the best available torch device."""
    if force_cpu_on_mac and platform.system() == "Darwin":
        return "cpu"

    import torch

    if torch.cuda.is_available():
        return "cuda"

    if allow_xpu:
        try:
            import intel_extension_for_pytorch  # noqa: F401

            if hasattr(torch, "xpu") and torch.xpu.is_available():
                return "xpu"
        except ImportError:
            pass

    if allow_directml:
        try:
            import torch_directml

            if torch_directml.device_count() > 0:
                return torch_directml.device(0)
        except ImportError:
            pass

    if allow_mps and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"

    return "cpu"


async def combine_voice_prompts(
    audio_paths: List[str],
    reference_texts: List[str],
    *,
    sample_rate: Optional[int] = None,
) -> Tuple[np.ndarray, str]:
    """Combine multiple reference audio samples into one."""
    combined_audio: list[np.ndarray] = []

    for path in audio_paths:
        kwargs = {"sample_rate": sample_rate} if sample_rate else {}
        audio, _ = load_audio(path, **kwargs)
        combined_audio.append(normalize_audio(audio))

    mixed = normalize_audio(np.concatenate(combined_audio))
    combined_text = " ".join(reference_texts)
    return mixed, combined_text


@contextmanager
def model_load_progress(
    model_name: str,
    is_cached: bool,
    filter_non_downloads: Optional[bool] = None,
):
    """Context manager for model loading with HF download progress tracking."""
    if filter_non_downloads is None:
        filter_non_downloads = is_cached

    progress_manager = get_progress_manager()
    task_manager = get_task_manager()

    progress_callback = create_hf_progress_callback(model_name, progress_manager)
    tracker = HFProgressTracker(progress_callback, filter_non_downloads=filter_non_downloads)
    tracker_context = tracker.patch_download()
    tracker_context.__enter__()

    if not is_cached:
        task_manager.start_download(model_name)
        progress_manager.update_progress(
            model_name=model_name,
            current=0,
            total=0,
            filename="Connecting to HuggingFace...",
            status="downloading",
        )

    try:
        yield tracker_context
    except Exception as exc:
        progress_manager.mark_error(model_name, str(exc))
        task_manager.error_download(model_name, str(exc))
        raise
    else:
        if not is_cached:
            progress_manager.mark_complete(model_name)
            task_manager.complete_download(model_name)
    finally:
        tracker_context.__exit__(None, None, None)


def patch_chatterbox_f32(model) -> None:
    """Patch float64 -> float32 dtype mismatches in upstream chatterbox."""
    import types

    tokenizer = model.s3gen.tokenizer
    original_log_mel = tokenizer.log_mel_spectrogram.__func__

    def _f32_log_mel(self_tokenizer, audio, padding=0):
        import torch as _torch

        if _torch.is_tensor(audio):
            audio = audio.float()
        return original_log_mel(self_tokenizer, audio, padding)

    tokenizer.log_mel_spectrogram = types.MethodType(_f32_log_mel, tokenizer)

    voice_encoder = model.ve
    original_ve_forward = voice_encoder.forward.__func__

    def _f32_ve_forward(self_voice_encoder, mels):
        return original_ve_forward(self_voice_encoder, mels.float())

    voice_encoder.forward = types.MethodType(_f32_ve_forward, voice_encoder)
