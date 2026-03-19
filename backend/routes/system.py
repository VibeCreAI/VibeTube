"""System routes: root, shutdown, and health checks."""

from __future__ import annotations

import asyncio
import os
import signal
from pathlib import Path

import torch
from fastapi import APIRouter

from .. import __version__, models, tts
from ..platform_detect import get_backend_type

router = APIRouter()


@router.get("/")
async def root():
    """Root endpoint."""
    return {"message": "VibeTube API", "version": __version__}


@router.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the server."""

    async def shutdown_async():
        await asyncio.sleep(0.1)  # Give response time to send
        os.kill(os.getpid(), signal.SIGTERM)

    asyncio.create_task(shutdown_async())
    return {"message": "Shutting down..."}


@router.get("/health", response_model=models.HealthResponse)
async def health():
    """Health check endpoint."""
    from huggingface_hub import constants as hf_constants

    tts_model = tts.get_tts_model()
    backend_type = get_backend_type()

    has_cuda = torch.cuda.is_available()
    has_mps = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()

    has_xpu = False
    xpu_name = None
    try:
        import intel_extension_for_pytorch as ipex  # noqa: F401

        if hasattr(torch, "xpu") and torch.xpu.is_available():
            has_xpu = True
            try:
                xpu_name = torch.xpu.get_device_name(0)
            except Exception:
                xpu_name = "Intel GPU"
    except ImportError:
        pass

    has_directml = False
    directml_name = None
    try:
        import torch_directml

        if torch_directml.device_count() > 0:
            has_directml = True
            try:
                directml_name = torch_directml.device_name(0)
            except Exception:
                directml_name = "DirectML GPU"
    except ImportError:
        pass

    gpu_available = has_cuda or has_mps or has_xpu or has_directml or backend_type == "mlx"

    gpu_type = None
    if has_cuda:
        gpu_type = f"CUDA ({torch.cuda.get_device_name(0)})"
    elif has_mps:
        gpu_type = "MPS (Apple Silicon)"
    elif backend_type == "mlx":
        gpu_type = "Metal (Apple Silicon via MLX)"
    elif has_xpu:
        gpu_type = f"XPU ({xpu_name})"
    elif has_directml:
        gpu_type = f"DirectML ({directml_name})"

    vram_used = None
    if has_cuda:
        vram_used = torch.cuda.memory_allocated() / 1024 / 1024

    model_loaded = False
    model_size = None
    try:
        if tts_model.is_loaded():
            model_loaded = True
            model_size = getattr(tts_model, "_current_model_size", None)
            if not model_size:
                model_size = getattr(tts_model, "model_size", None)
    except Exception:
        model_loaded = False
        model_size = None

    model_downloaded = None
    try:
        if backend_type == "mlx":
            default_model_id = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
        else:
            default_model_id = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

        try:
            from huggingface_hub import scan_cache_dir

            cache_info = scan_cache_dir()
            for repo in cache_info.repos:
                if repo.repo_id == default_model_id:
                    model_downloaded = True
                    break
        except (ImportError, Exception):
            cache_dir = hf_constants.HF_HUB_CACHE
            repo_cache = Path(cache_dir) / ("models--" + default_model_id.replace("/", "--"))
            if repo_cache.exists():
                has_model_files = (
                    any(repo_cache.rglob("*.bin"))
                    or any(repo_cache.rglob("*.safetensors"))
                    or any(repo_cache.rglob("*.pt"))
                    or any(repo_cache.rglob("*.pth"))
                    or any(repo_cache.rglob("*.npz"))
                )
                model_downloaded = has_model_files
    except Exception:
        pass

    return models.HealthResponse(
        status="healthy",
        model_loaded=model_loaded,
        model_downloaded=model_downloaded,
        model_size=model_size,
        gpu_available=gpu_available,
        gpu_type=gpu_type,
        vram_used_mb=vram_used,
        backend_type=backend_type,
    )

