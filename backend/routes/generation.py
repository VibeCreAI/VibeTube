"""Generation routes (persisted generation, stream, and audio import)."""

from __future__ import annotations

from typing import Awaitable, Callable, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

GenerateSpeechFunc = Callable[
    [models.GenerationRequest, Session],
    Awaitable[models.GenerationResponse],
]
ImportUploadedAudioFunc = Callable[..., Awaitable[models.GenerationResponse]]
StreamSpeechFunc = Callable[[models.GenerationRequest, Session], Awaitable[bytes]]


def create_generation_router(
    generate_func: GenerateSpeechFunc,
    import_uploaded_audio_func: ImportUploadedAudioFunc,
    stream_func: StreamSpeechFunc,
) -> APIRouter:
    """Create generation router bound to shared generation/import functions."""
    router = APIRouter()

    @router.post("/generate", response_model=models.GenerationResponse)
    async def generate_speech(
        data: models.GenerationRequest,
        db: Session = Depends(get_db),
    ):
        """Generate speech from text using a voice profile."""
        return await generate_func(data, db)

    @router.post("/generations/import-audio", response_model=models.GenerationResponse)
    async def import_generation_audio(
        profile_id: str = Form(...),
        file: UploadFile = File(...),
        text: Optional[str] = Form(None),
        language: Optional[str] = Form(None),
        instruct: Optional[str] = Form(None),
        db: Session = Depends(get_db),
    ):
        """Create a generation entry from uploaded microphone audio."""
        return await import_uploaded_audio_func(
            profile_id=profile_id,
            file=file,
            db=db,
            text=text,
            language=language,
            instruct=instruct,
        )

    @router.post("/generate/stream")
    async def stream_speech(
        data: models.GenerationRequest,
        db: Session = Depends(get_db),
    ):
        """
        Generate speech and stream WAV audio directly without saving to disk.
        """
        wav_bytes = await stream_func(data, db)

        async def _wav_stream():
            # Yield in chunks so large responses do not block the event loop.
            chunk_size = 64 * 1024
            for i in range(0, len(wav_bytes), chunk_size):
                yield wav_bytes[i : i + chunk_size]

        return StreamingResponse(
            _wav_stream(),
            media_type="audio/wav",
            headers={"Content-Disposition": 'attachment; filename="speech.wav"'},
        )

    return router
