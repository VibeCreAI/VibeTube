"""Core voice-profile routes (CRUD, samples, avatar, import/export)."""

from __future__ import annotations

import io
from pathlib import Path
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from .. import export_import, models
from ..database import ProfileSample as DBProfileSample
from ..database import get_db
from ..services.errors import extract_error_message
from ..services import profiles
from ..services.uploads import write_upload_to_temp

router = APIRouter()
_MAX_PROFILE_IMPORT_FILE_SIZE = 100 * 1024 * 1024


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


@router.post("/profiles", response_model=models.VoiceProfileResponse)
async def create_profile(
    data: models.VoiceProfileCreate,
    db: Session = Depends(get_db),
):
    """Create a new voice profile."""
    try:
        return await profiles.create_profile(data, db)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/profiles", response_model=List[models.VoiceProfileResponse])
async def list_profiles(
    exclude_story_only: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """List all voice profiles."""
    return await profiles.list_profiles(db, exclude_story_only=exclude_story_only)


@router.post("/profiles/import", response_model=models.VoiceProfileResponse)
async def import_profile(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Import a voice profile from a ZIP archive."""
    content = await file.read()
    if len(content) > _MAX_PROFILE_IMPORT_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File too large. Maximum size is "
                f"{_MAX_PROFILE_IMPORT_FILE_SIZE / (1024 * 1024)}MB"
            ),
        )

    try:
        return await export_import.import_profile_from_zip(content, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/profiles/{profile_id}", response_model=models.VoiceProfileResponse)
async def get_profile(
    profile_id: str,
    db: Session = Depends(get_db),
):
    """Get a voice profile by ID."""
    profile = await profiles.get_profile(profile_id, db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.put("/profiles/{profile_id}", response_model=models.VoiceProfileResponse)
async def update_profile(
    profile_id: str,
    data: models.VoiceProfileCreate,
    db: Session = Depends(get_db),
):
    """Update a voice profile."""
    profile = await profiles.update_profile(profile_id, data, db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    db: Session = Depends(get_db),
):
    """Delete a voice profile."""
    success = await profiles.delete_profile(profile_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"message": "Profile deleted successfully"}


@router.post("/profiles/{profile_id}/samples", response_model=models.ProfileSampleResponse)
async def add_profile_sample(
    profile_id: str,
    file: UploadFile = File(...),
    reference_text: str = Form(...),
    db: Session = Depends(get_db),
):
    """Add a sample to a voice profile."""
    allowed_audio_exts = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac", ".webm", ".opus"}
    uploaded_ext = Path(file.filename or "").suffix.lower()
    file_suffix = uploaded_ext if uploaded_ext in allowed_audio_exts else ".wav"
    tmp_path = await write_upload_to_temp(file, suffix=file_suffix)

    try:
        return await profiles.add_profile_sample(
            profile_id,
            str(tmp_path),
            reference_text,
            db,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process audio file: {extract_error_message(exc)}",
        )
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/profiles/{profile_id}/samples", response_model=List[models.ProfileSampleResponse])
async def get_profile_samples(
    profile_id: str,
    db: Session = Depends(get_db),
):
    """Get all samples for a profile."""
    return await profiles.get_profile_samples(profile_id, db)


@router.delete("/profiles/samples/{sample_id}")
async def delete_profile_sample(
    sample_id: str,
    db: Session = Depends(get_db),
):
    """Delete a profile sample."""
    success = await profiles.delete_profile_sample(sample_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Sample not found")
    return {"message": "Sample deleted successfully"}


@router.put("/profiles/samples/{sample_id}", response_model=models.ProfileSampleResponse)
async def update_profile_sample(
    sample_id: str,
    data: models.ProfileSampleUpdate,
    db: Session = Depends(get_db),
):
    """Update a profile sample's reference text."""
    sample = await profiles.update_profile_sample(sample_id, data.reference_text, db)
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    return sample


@router.put("/profiles/samples/{sample_id}/gain", response_model=models.ProfileSampleResponse)
async def update_profile_sample_gain(
    sample_id: str,
    data: models.ProfileSampleGainUpdate,
    db: Session = Depends(get_db),
):
    """Apply gain (dB) to a profile sample audio file."""
    try:
        sample = await profiles.apply_gain_to_profile_sample(sample_id, data.gain_db, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")
    return sample


@router.post("/profiles/{profile_id}/avatar", response_model=models.VoiceProfileResponse)
async def upload_profile_avatar(
    profile_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload or update avatar image for a profile."""
    suffix = Path(file.filename or "").suffix or ".png"
    tmp_path = await write_upload_to_temp(file, suffix=suffix)

    try:
        return await profiles.upload_avatar(profile_id, str(tmp_path), db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/profiles/{profile_id}/avatar")
async def get_profile_avatar(
    profile_id: str,
    db: Session = Depends(get_db),
):
    """Get avatar image for a profile."""
    profile = await profiles.get_profile(profile_id, db)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    if not profile.avatar_path:
        raise HTTPException(status_code=404, detail="No avatar found for this profile")

    avatar_path = Path(profile.avatar_path)
    if not avatar_path.exists():
        raise HTTPException(status_code=404, detail="Avatar file not found")

    return FileResponse(avatar_path)


@router.delete("/profiles/{profile_id}/avatar")
async def delete_profile_avatar(
    profile_id: str,
    db: Session = Depends(get_db),
):
    """Delete avatar image for a profile."""
    success = await profiles.delete_avatar(profile_id, db)
    if not success:
        raise HTTPException(status_code=404, detail="Profile not found or no avatar to delete")
    return {"message": "Avatar deleted successfully"}


@router.get("/profiles/{profile_id}/export")
async def export_profile(
    profile_id: str,
    db: Session = Depends(get_db),
):
    """Export a voice profile as a ZIP archive."""
    try:
        profile = await profiles.get_profile(profile_id, db)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")

        zip_bytes = export_import.export_profile_to_zip(profile_id, db)

        safe_name = "".join(c for c in profile.name if c.isalnum() or c in (" ", "-", "_")).strip()
        if not safe_name:
            safe_name = "profile"
        filename = f"profile-{safe_name}.vibetube.zip"

        return StreamingResponse(
            io.BytesIO(zip_bytes),
            media_type="application/zip",
            headers={"Content-Disposition": _safe_content_disposition("attachment", filename)},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/samples/{sample_id}")
async def get_sample_audio(sample_id: str, db: Session = Depends(get_db)):
    """Serve profile sample audio file."""
    sample = db.query(DBProfileSample).filter_by(id=sample_id).first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    audio_path = Path(sample.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=f"sample_{sample_id}.wav",
    )
