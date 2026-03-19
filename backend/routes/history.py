"""History and generation-file routes."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from .. import export_import, models
from ..database import Generation as DBGeneration
from ..database import VoiceProfile as DBVoiceProfile
from ..database import get_db
from ..services import history

router = APIRouter()

_MAX_HISTORY_IMPORT_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _safe_content_disposition(disposition_type: str, filename: str) -> str:
    """Build a Content-Disposition header that is safe for non-ASCII filenames."""
    ascii_name = "".join(
        c for c in filename if c.isascii() and (c.isalnum() or c in " -_.")
    ).strip() or "download"
    utf8_name = quote(filename, safe="")
    return (
        f'{disposition_type}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{utf8_name}"
    )


@router.get("/history", response_model=models.HistoryListResponse)
async def list_history(
    profile_id: Optional[str] = None,
    search: Optional[str] = None,
    exclude_story_generations: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """List generation history with optional filters."""
    query = models.HistoryQuery(
        profile_id=profile_id,
        search=search,
        exclude_story_generations=exclude_story_generations,
        limit=limit,
        offset=offset,
    )
    return await history.list_generations(query, db)


@router.get("/history/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Get generation statistics."""
    return await history.get_generation_stats(db)


@router.post("/history/import")
async def import_generation(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Import a generation from a ZIP archive."""
    content = await file.read()
    if len(content) > _MAX_HISTORY_IMPORT_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {_MAX_HISTORY_IMPORT_FILE_SIZE / (1024 * 1024)}MB",
        )

    try:
        return await export_import.import_generation_from_zip(content, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/history/{generation_id}", response_model=models.HistoryResponse)
async def get_generation(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Get a generation by ID."""
    result = (
        db.query(
            DBGeneration,
            DBVoiceProfile.name.label("profile_name"),
        )
        .join(DBVoiceProfile, DBGeneration.profile_id == DBVoiceProfile.id)
        .filter(DBGeneration.id == generation_id)
        .first()
    )

    if not result:
        raise HTTPException(status_code=404, detail="Generation not found")

    generation, profile_name = result
    return models.HistoryResponse(
        id=generation.id,
        profile_id=generation.profile_id,
        profile_name=profile_name,
        text=generation.text,
        language=generation.language,
        engine=getattr(generation, "engine", "qwen"),
        model_size=getattr(generation, "model_size", "1.7B"),
        source_type=getattr(generation, "source_type", "ai"),
        audio_path=generation.audio_path,
        duration=generation.duration,
        seed=generation.seed,
        instruct=generation.instruct,
        created_at=generation.created_at,
    )


@router.delete("/history/{generation_id}")
async def delete_generation(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Delete a generation."""
    success = await history.delete_generation(generation_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Generation not found")
    return {"message": "Generation deleted successfully"}


@router.get("/history/{generation_id}/export")
async def export_generation(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Export a generation as a ZIP archive."""
    try:
        generation = db.query(DBGeneration).filter_by(id=generation_id).first()
        if not generation:
            raise HTTPException(status_code=404, detail="Generation not found")

        zip_bytes = export_import.export_generation_to_zip(generation_id, db)

        safe_text = "".join(
            c for c in generation.text[:30] if c.isalnum() or c in (" ", "-", "_")
        ).strip()
        if not safe_text:
            safe_text = "generation"
        filename = f"generation-{safe_text}.vibetube.zip"

        return StreamingResponse(
            io.BytesIO(zip_bytes),
            media_type="application/zip",
            headers={"Content-Disposition": _safe_content_disposition("attachment", filename)},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/history/{generation_id}/export-audio")
async def export_generation_audio(
    generation_id: str,
    db: Session = Depends(get_db),
):
    """Export only the audio file from a generation."""
    generation = db.query(DBGeneration).filter_by(id=generation_id).first()
    if not generation:
        raise HTTPException(status_code=404, detail="Generation not found")

    audio_path = Path(generation.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    safe_text = "".join(
        c for c in generation.text[:30] if c.isalnum() or c in (" ", "-", "_")
    ).strip()
    if not safe_text:
        safe_text = "generation"
    filename = f"{safe_text}.wav"

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        headers={"Content-Disposition": _safe_content_disposition("attachment", filename)},
    )


@router.get("/audio/{generation_id}")
async def get_audio(generation_id: str, db: Session = Depends(get_db)):
    """Serve generated audio file."""
    generation = await history.get_generation(generation_id, db)
    if not generation:
        raise HTTPException(status_code=404, detail="Generation not found")

    audio_path = Path(generation.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=f"generation_{generation_id}.wav",
    )
