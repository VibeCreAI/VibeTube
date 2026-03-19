"""FastAPI application factory for VibeTube backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .lifecycle import register_lifecycle_handlers
from .routes.channels import router as channels_router
from .routes.generation import create_generation_router
from .routes.history import router as history_router
from .routes.model_management import router as model_management_router
from .routes.profiles import router as profiles_router
from .routes.runtime import router as runtime_router
from .routes.stories import create_stories_router
from .routes.system import router as system_router
from .routes.vibetube import create_vibetube_router
from .routes.vibetube_profiles import router as vibetube_profiles_router
from .services.generation import (
    create_generation_from_uploaded_audio,
    generate_and_persist_speech,
    generate_stream_wav_bytes,
)

ALLOWED_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="VibeTube API",
        description="Production-quality Qwen3-TTS voice cloning API",
        version=__version__,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(profiles_router)
    app.include_router(history_router)
    app.include_router(create_stories_router(generate_and_persist_speech))
    app.include_router(model_management_router)
    app.include_router(channels_router)
    app.include_router(
        create_generation_router(
            generate_and_persist_speech,
            create_generation_from_uploaded_audio,
            generate_stream_wav_bytes,
        )
    )
    app.include_router(create_vibetube_router(generate_and_persist_speech))
    app.include_router(vibetube_profiles_router)
    app.include_router(runtime_router)
    app.include_router(system_router)
    register_lifecycle_handlers(app)

    return app

