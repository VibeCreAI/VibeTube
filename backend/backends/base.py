"""
Shared utilities for TTS/STT backend implementations.

Eliminates duplication of cache checking, device detection,
voice prompt combination, and model loading progress tracking.
"""

import logging
import os
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
    return (
        get_cached_snapshot_path(
            hf_repo,
            weight_extensions=weight_extensions,
            required_files=required_files,
        )
        is not None
    )


def get_cached_snapshot_path(
    hf_repo: str,
    *,
    weight_extensions: tuple[str, ...] = (".safetensors", ".bin"),
    required_files: Optional[list[str]] = None,
) -> Optional[Path]:
    """
    Return a local cached snapshot path for a Hugging Face repo if one is usable.
    """
    try:
        from huggingface_hub import constants as hf_constants

        repo_cache = Path(hf_constants.HF_HUB_CACHE) / ("models--" + hf_repo.replace("/", "--"))
        if not repo_cache.exists():
            return None

        blobs_dir = repo_cache / "blobs"
        if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
            logger.debug("Found incomplete blobs for %s", hf_repo)
            return None

        snapshots_dir = repo_cache / "snapshots"
        if not snapshots_dir.exists():
            return None

        def _snapshot_is_usable(snapshot_dir: Path) -> bool:
            if not snapshot_dir.exists() or not snapshot_dir.is_dir():
                return False

            if required_files:
                for required in required_files:
                    if not any(snapshot_dir.rglob(required)):
                        return False

            has_weights = any(any(snapshot_dir.rglob(f"*{ext}")) for ext in weight_extensions)
            if not has_weights:
                return False

            return True

        candidates: list[Path] = []
        refs_main = repo_cache / "refs" / "main"
        if refs_main.exists():
            revision = refs_main.read_text(encoding="utf-8").strip()
            if revision:
                candidates.append(snapshots_dir / revision)

        for snapshot_dir in sorted(
            snapshots_dir.iterdir(),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        ):
            candidates.append(snapshot_dir)

        seen: set[Path] = set()
        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if _snapshot_is_usable(candidate):
                return candidate

        logger.debug("No complete cached snapshot found for %s", hf_repo)
        return None
    except Exception as exc:
        logger.warning("Error resolving cache snapshot for %s: %s", hf_repo, exc)
        return None


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


@contextmanager
def force_hf_offline_if_cached(is_cached: bool):
    """
    Force Hugging Face/Transformers offline mode while loading already-cached models.

    Some upstream loaders still make metadata HEAD requests even when files are local.
    This prevents runtime network access for cached model loads.
    """
    if not is_cached:
        yield
        return

    previous_hf_env = os.environ.get("HF_HUB_OFFLINE")
    previous_tf_env = os.environ.get("TRANSFORMERS_OFFLINE")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    previous_hf_constant = None
    hf_constant_patched = False
    try:
        import huggingface_hub.constants as hf_constants

        previous_hf_constant = getattr(hf_constants, "HF_HUB_OFFLINE", None)
        hf_constants.HF_HUB_OFFLINE = True
        hf_constant_patched = True
    except Exception:
        pass

    previous_tf_offline = None
    tf_offline_patched = False
    try:
        import transformers.utils.hub as tf_hub

        previous_tf_offline = getattr(tf_hub, "_is_offline_mode", None)
        tf_hub._is_offline_mode = True
        tf_offline_patched = True
    except Exception:
        pass

    try:
        yield
    finally:
        if previous_hf_env is None:
            os.environ.pop("HF_HUB_OFFLINE", None)
        else:
            os.environ["HF_HUB_OFFLINE"] = previous_hf_env

        if previous_tf_env is None:
            os.environ.pop("TRANSFORMERS_OFFLINE", None)
        else:
            os.environ["TRANSFORMERS_OFFLINE"] = previous_tf_env

        if hf_constant_patched:
            try:
                import huggingface_hub.constants as hf_constants

                hf_constants.HF_HUB_OFFLINE = previous_hf_constant
            except Exception:
                pass

        if tf_offline_patched:
            try:
                import transformers.utils.hub as tf_hub

                tf_hub._is_offline_mode = previous_tf_offline
            except Exception:
                pass
