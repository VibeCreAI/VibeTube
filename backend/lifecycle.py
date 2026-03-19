"""Application startup/shutdown lifecycle registration."""

from __future__ import annotations

import asyncio
from pathlib import Path
import platform as py_platform

import torch
from fastapi import FastAPI

from . import __version__, config, database
from .backends import get_all_model_configs, unload_model_by_config
from .database import Generation as DBGeneration
from .database import Story as DBStory
from .database import StoryItem as DBStoryItem
from .database import VoiceProfile as DBVoiceProfile
from .platform_detect import get_backend_type
from .utils.progress import get_progress_manager


def _collect_db_stats() -> dict[str, int]:
    """Collect lightweight DB counts for startup diagnostics."""
    if not database.SessionLocal:
        return {}

    db = database.SessionLocal()
    try:
        return {
            "profiles": db.query(DBVoiceProfile).count(),
            "generations": db.query(DBGeneration).count(),
            "stories": db.query(DBStory).count(),
            "story_items": db.query(DBStoryItem).count(),
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _get_gpu_status() -> str:
    """Get GPU availability status."""
    backend_type = get_backend_type()
    if torch.cuda.is_available():
        return f"CUDA ({torch.cuda.get_device_name(0)})"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "MPS (Apple Silicon)"
    if backend_type == "mlx":
        return "Metal (Apple Silicon via MLX)"
    return "None (CPU only)"


async def _startup_event() -> None:
    """Run on application startup."""
    print("VibeTube API starting up...")
    print(f"Version: {__version__}")
    print(f"Platform: {py_platform.platform()}")
    print(f"Data directory: {config.get_data_dir()}")
    print(f"Profiles directory: {config.get_profiles_dir()}")
    database.init_db()
    print(f"Database initialized at {database._db_path}")
    backend_type = get_backend_type()
    print(f"Backend: {backend_type.upper()}")
    print(f"GPU available: {_get_gpu_status()}")
    try:
        stats = _collect_db_stats()
        if stats:
            stats_summary = ", ".join(f"{name}={count}" for name, count in stats.items())
            print(f"Database stats: {stats_summary}")
    except Exception as exc:
        print(f"Warning: Failed to collect database stats: {exc}")

    try:
        progress_manager = get_progress_manager()
        progress_manager._set_main_loop(asyncio.get_running_loop())
        print("Progress manager initialized with event loop")
    except Exception as exc:
        print(f"Warning: Could not initialize progress manager event loop: {exc}")

    try:
        from huggingface_hub import constants as hf_constants

        cache_dir = Path(hf_constants.HF_HUB_CACHE)
        cache_dir.mkdir(parents=True, exist_ok=True)
        print(f"HuggingFace cache directory: {cache_dir}")
    except Exception as exc:
        print(f"Warning: Could not create HuggingFace cache directory: {exc}")
        print("Model downloads may fail. Please ensure the directory exists and has write permissions.")


async def _shutdown_event() -> None:
    """Run on application shutdown."""
    print("VibeTube API shutting down...")
    for model_config in get_all_model_configs():
        try:
            unloaded = unload_model_by_config(model_config)
            if unloaded:
                print(f"Unloaded {model_config.display_name}")
        except Exception as exc:
            print(f"Warning: Failed to unload {model_config.display_name}: {exc}")


def register_lifecycle_handlers(app: FastAPI) -> None:
    """Attach startup and shutdown handlers to the app."""
    app.add_event_handler("startup", _startup_event)
    app.add_event_handler("shutdown", _shutdown_event)

