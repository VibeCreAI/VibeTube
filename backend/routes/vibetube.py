"""VibeTube render/export/list routes and related helpers."""

from __future__ import annotations

import io
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from .. import config, models, vibetube
from ..database import Generation as DBGeneration
from ..database import VoiceProfile as DBVoiceProfile
from ..database import get_db

GenerateSpeechFunc = Callable[
    [models.GenerationRequest, Session],
    Awaitable[models.GenerationResponse],
]


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


def _vibetube_avatar_pack_dir(profile_id: str) -> Path:
    return config.get_profiles_dir() / profile_id / "vibetube_avatar"


def _extract_caption_preview(captions_path: Path, max_chars: int = 120) -> Optional[str]:
    """Extract a short readable preview line from an SRT caption file."""
    if not captions_path.exists():
        return None
    try:
        for raw in captions_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            if line.isdigit():
                continue
            if "-->" in line:
                continue
            return line[:max_chars]
    except Exception:
        return None
    return None


def _ensure_vibetube_job_captions(job_dir: Path) -> Path:
    """Resolve or regenerate captions.srt for a VibeTube job directory."""
    meta_path = job_dir / "meta.json"
    captions_path = job_dir / "captions.srt"
    meta: dict = {}

    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    if captions_path.exists():
        return captions_path

    captions_name = str(meta.get("captions") or "").strip()
    if captions_name:
        named_path = job_dir / captions_name
        if named_path.exists():
            return named_path

    source_text = str(meta.get("source_text_preview") or "").strip()
    duration_sec = meta.get("duration_sec")
    try:
        duration_value = float(duration_sec)
    except (TypeError, ValueError):
        duration_value = 0.0

    if source_text and duration_value > 0:
        vibetube._write_srt(text=source_text, duration_sec=duration_value, out_path=captions_path)
        meta["captions"] = captions_path.name
        try:
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        except Exception:
            pass
        return captions_path

    raise FileNotFoundError("No subtitle data found for this render job.")


def _srt_text_to_vtt_text(srt_text: str) -> str:
    """Convert SRT text payload to WebVTT payload."""
    lines = srt_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    converted: list[str] = ["WEBVTT", ""]
    for raw in lines:
        line = raw.strip()
        if line and line.isdigit():
            continue
        converted.append(raw.replace(",", "."))
    return "\n".join(converted).strip() + "\n"


def _load_vibetube_job_meta(job_dir: Path) -> dict:
    meta_path = job_dir / "meta.json"
    if not meta_path.exists():
        return {}
    try:
        raw = meta_path.read_text(encoding="utf-8")
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def _vibetube_job_source_kind(meta: Optional[dict]) -> str:
    if not isinstance(meta, dict):
        return "unknown"

    source_kind = meta.get("source_kind")
    if source_kind in {"generation", "story", "broadcast_recording", "unknown"}:
        return str(source_kind)

    if meta.get("source_story_id"):
        return "story"
    if meta.get("source_generation_id"):
        return "generation"
    return "unknown"


def _vibetube_job_source_profile_id(meta: Optional[dict]) -> Optional[str]:
    if not isinstance(meta, dict):
        return None
    source_profile_id = meta.get("source_profile_id")
    return str(source_profile_id) if source_profile_id else None


def _vibetube_job_contains_transparency(
    job_dir: Path,
    meta: Optional[dict] = None,
    probe_if_needed: bool = False,
) -> bool:
    resolved_meta = meta if meta is not None else _load_vibetube_job_meta(job_dir)

    contains_transparency = resolved_meta.get("contains_transparency")
    if isinstance(contains_transparency, bool):
        return contains_transparency

    alpha_meta = resolved_meta.get("alpha")
    if isinstance(alpha_meta, dict):
        alpha_verified = alpha_meta.get("verified")
        if isinstance(alpha_verified, bool):
            return alpha_verified

    if probe_if_needed:
        webm_path = job_dir / "avatar.webm"
        if webm_path.exists():
            try:
                inspection = vibetube.inspect_video_alpha(webm_path)
                return bool(inspection["contains_transparency"])
            except Exception:
                pass

    return False


def _vibetube_job_alpha_verified(meta: Optional[dict]) -> Optional[bool]:
    if not isinstance(meta, dict):
        return None
    alpha_meta = meta.get("alpha")
    if isinstance(alpha_meta, dict):
        verified = alpha_meta.get("verified")
        if isinstance(verified, bool):
            return verified
    contains_transparency = meta.get("contains_transparency")
    if isinstance(contains_transparency, bool):
        return contains_transparency
    return None


def _vibetube_job_preferred_export_format(
    job_dir: Path,
    meta: Optional[dict] = None,
    probe_if_needed: bool = False,
) -> str:
    resolved_meta = meta if meta is not None else _load_vibetube_job_meta(job_dir)
    preferred_export_format = resolved_meta.get("preferred_export_format")
    if preferred_export_format in {"webm", "mp4", "mov"}:
        return str(preferred_export_format)
    return "webm" if _vibetube_job_contains_transparency(job_dir, resolved_meta, probe_if_needed) else "mp4"


def create_vibetube_router(generate_func: GenerateSpeechFunc) -> APIRouter:
    """Create a VibeTube router bound to a generation function."""
    router = APIRouter()

    @router.post("/vibetube/render", response_model=models.VibeTubeRenderResponse)
    async def vibetube_render(
        profile_id: Optional[str] = Form(None),
        text: Optional[str] = Form(None),
        language: str = Form("en"),
        generation_id: Optional[str] = Form(None),
        fps: int = Form(30),
        width: int = Form(1080),
        height: int = Form(1080),
        on_threshold: float = Form(0.03),
        off_threshold: float = Form(0.025),
        smoothing_windows: int = Form(2),
        min_hold_windows: int = Form(1),
        blink_min_interval_sec: float = Form(2.5),
        blink_max_interval_sec: float = Form(4.0),
        blink_duration_frames: int = Form(3),
        head_motion_amount_px: float = Form(10.0),
        head_motion_change_sec: float = Form(2.8),
        head_motion_smoothness: float = Form(0.04),
        voice_bounce_amount_px: float = Form(2.0),
        voice_bounce_sensitivity: float = Form(1.0),
        use_background_color: bool = Form(False),
        use_background_image: bool = Form(False),
        use_background: bool = Form(False),
        background_color: str = Form("#101820"),
        subtitle_enabled: bool = Form(False),
        subtitle_style: str = Form("minimal", pattern="^(minimal|cinema|glass)$"),
        subtitle_text_color: str = Form("#FFFFFF", pattern="^#[0-9A-Fa-f]{6}$"),
        subtitle_outline_color: str = Form("#000000", pattern="^#[0-9A-Fa-f]{6}$"),
        subtitle_outline_width: int = Form(2, ge=0, le=12),
        subtitle_font_family: str = Form("sans", pattern="^(sans|serif|mono)$"),
        subtitle_bold: bool = Form(True),
        subtitle_italic: bool = Form(False),
        show_profile_names: bool = Form(True),
        background_image: Optional[UploadFile] = File(None),
        idle: Optional[UploadFile] = File(None),
        talk: Optional[UploadFile] = File(None),
        idle_blink: Optional[UploadFile] = File(None),
        talk_blink: Optional[UploadFile] = File(None),
        blink: Optional[UploadFile] = File(None),
        db: Session = Depends(get_db),
    ):
        """
        Render a PNGtuber overlay video from an existing generation or from fresh text generation.
        """
        try:
            if generation_id:
                generation = db.query(DBGeneration).filter_by(id=generation_id).first()
                if not generation:
                    raise HTTPException(status_code=404, detail="Generation not found")
                audio_path = Path(generation.audio_path)
                source_text = generation.text
                source_generation_id = generation.id
                avatar_profile_id = generation.profile_id
            else:
                if not profile_id or not text:
                    raise HTTPException(
                        status_code=400,
                        detail="Provide generation_id OR both profile_id and text",
                    )
                gen = await generate_func(
                    models.GenerationRequest(
                        profile_id=profile_id,
                        text=text,
                        language=language,
                    ),
                    db,
                )
                audio_path = Path(gen.audio_path)
                source_text = gen.text
                source_generation_id = gen.id
                avatar_profile_id = profile_id

            if profile_id:
                avatar_profile_id = profile_id

            if not audio_path.exists():
                raise HTTPException(status_code=404, detail="Source audio file not found")

            job_id = str(uuid.uuid4())
            base_out = config.get_data_dir() / "vibetube" / job_id
            avatar_dir = base_out / "avatar"
            avatar_dir.mkdir(parents=True, exist_ok=True)

            async def save_upload(upload: UploadFile, target: Path):
                data = await upload.read()
                target.write_bytes(data)

            if idle and talk:
                await save_upload(idle, avatar_dir / "idle.png")
                await save_upload(talk, avatar_dir / "talk.png")
                if idle_blink:
                    await save_upload(idle_blink, avatar_dir / "idle_blink.png")
                if talk_blink:
                    await save_upload(talk_blink, avatar_dir / "talk_blink.png")
                if blink:
                    await save_upload(blink, avatar_dir / "blink.png")
            else:
                pack_dir = _vibetube_avatar_pack_dir(avatar_profile_id)
                if not (pack_dir / "idle.png").exists() or not (pack_dir / "talk.png").exists():
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Avatar images are missing. Upload idle/talk images, "
                            "or save a VibeTube avatar pack for this voice profile first."
                        ),
                    )

                shutil.copy2(pack_dir / "idle.png", avatar_dir / "idle.png")
                shutil.copy2(pack_dir / "talk.png", avatar_dir / "talk.png")
                if (pack_dir / "idle_blink.png").exists():
                    shutil.copy2(pack_dir / "idle_blink.png", avatar_dir / "idle_blink.png")
                if (pack_dir / "talk_blink.png").exists():
                    shutil.copy2(pack_dir / "talk_blink.png", avatar_dir / "talk_blink.png")
                if (pack_dir / "blink.png").exists():
                    shutil.copy2(pack_dir / "blink.png", avatar_dir / "blink.png")

            background_image_path: Optional[Path] = None
            if use_background_image and background_image is not None:
                suffix = Path(background_image.filename or "").suffix.lower()
                if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                    suffix = ".png"
                background_image_path = base_out / f"background{suffix}"
                await save_upload(background_image, background_image_path)

            background_enabled = bool(
                use_background
                or use_background_color
                or (use_background_image and background_image_path)
            )
            source_profile_name: Optional[str] = None
            if avatar_profile_id:
                profile = db.query(DBVoiceProfile).filter_by(id=avatar_profile_id).first()
                if profile:
                    source_profile_name = profile.name

            render_result = vibetube.render_overlay(
                audio_path=audio_path,
                avatar_dir=avatar_dir,
                output_dir=base_out,
                fps=fps,
                width=width,
                height=height,
                on_threshold=on_threshold,
                off_threshold=off_threshold,
                smoothing_windows=smoothing_windows,
                min_hold_windows=min_hold_windows,
                blink_min_interval_sec=blink_min_interval_sec,
                blink_max_interval_sec=blink_max_interval_sec,
                blink_duration_frames=blink_duration_frames,
                head_motion_amount_px=head_motion_amount_px,
                head_motion_change_sec=head_motion_change_sec,
                head_motion_smoothness=head_motion_smoothness,
                voice_bounce_amount_px=voice_bounce_amount_px,
                voice_bounce_sensitivity=voice_bounce_sensitivity,
                use_background=background_enabled,
                background_color=background_color if use_background_color else None,
                background_image_path=background_image_path,
                text=source_text,
                subtitle_enabled=subtitle_enabled,
                subtitle_style=subtitle_style,
                subtitle_text_color=subtitle_text_color,
                subtitle_outline_color=subtitle_outline_color,
                subtitle_outline_width=subtitle_outline_width,
                subtitle_font_family=subtitle_font_family,
                subtitle_bold=subtitle_bold,
                subtitle_italic=subtitle_italic,
                show_profile_names=show_profile_names,
                profile_display_name=source_profile_name,
            )

            meta_path = Path(render_result["meta_path"])
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
            meta.update(
                {
                    "source_kind": "generation",
                    "source_generation_id": source_generation_id,
                    "source_profile_id": avatar_profile_id,
                    "source_profile_name": source_profile_name,
                    "source_text_preview": (source_text or "").strip(),
                }
            )
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

            return models.VibeTubeRenderResponse(
                job_id=job_id,
                output_dir=str(base_out.resolve()),
                video_path=str(Path(render_result["video_path"]).resolve()),
                timeline_path=str(Path(render_result["timeline_path"]).resolve()),
                captions_path=str(Path(render_result["captions_path"]).resolve())
                if render_result["captions_path"]
                else None,
                meta_path=str(Path(render_result["meta_path"]).resolve()),
                duration=float(render_result["duration_sec"]),
                source_generation_id=source_generation_id,
                source_kind="generation",
                source_profile_id=avatar_profile_id,
                contains_transparency=bool(render_result.get("contains_transparency")),
                alpha_verified=bool(render_result.get("alpha_verified")),
                preferred_export_format=str(render_result.get("preferred_export_format") or "mp4"),
            )
        except HTTPException:
            raise
        except vibetube.VibeTubeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"VibeTube render failed: {str(exc)}")

    @router.post("/vibetube/render-audio", response_model=models.VibeTubeRenderResponse)
    async def vibetube_render_audio(
        profile_id: str = Form(...),
        audio: UploadFile = File(...),
        caption_text: Optional[str] = Form(None),
        fps: int = Form(30),
        width: int = Form(1080),
        height: int = Form(1080),
        on_threshold: float = Form(0.03),
        off_threshold: float = Form(0.025),
        smoothing_windows: int = Form(2),
        min_hold_windows: int = Form(1),
        blink_min_interval_sec: float = Form(2.5),
        blink_max_interval_sec: float = Form(4.0),
        blink_duration_frames: int = Form(3),
        head_motion_amount_px: float = Form(10.0),
        head_motion_change_sec: float = Form(2.8),
        head_motion_smoothness: float = Form(0.04),
        voice_bounce_amount_px: float = Form(2.0),
        voice_bounce_sensitivity: float = Form(1.0),
        use_background_color: bool = Form(False),
        use_background_image: bool = Form(False),
        use_background: bool = Form(False),
        background_color: str = Form("#101820"),
        subtitle_enabled: bool = Form(False),
        subtitle_style: str = Form("minimal", pattern="^(minimal|cinema|glass)$"),
        subtitle_text_color: str = Form("#FFFFFF", pattern="^#[0-9A-Fa-f]{6}$"),
        subtitle_outline_color: str = Form("#000000", pattern="^#[0-9A-Fa-f]{6}$"),
        subtitle_outline_width: int = Form(2, ge=0, le=12),
        subtitle_font_family: str = Form("sans", pattern="^(sans|serif|mono)$"),
        subtitle_bold: bool = Form(True),
        subtitle_italic: bool = Form(False),
        show_profile_names: bool = Form(True),
        background_image: Optional[UploadFile] = File(None),
        db: Session = Depends(get_db),
    ):
        """Render a PNGtuber overlay video from uploaded microphone audio."""
        profile = db.query(DBVoiceProfile).filter_by(id=profile_id).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")

        pack_dir = _vibetube_avatar_pack_dir(profile_id)
        required_states = ("idle.png", "talk.png", "idle_blink.png", "talk_blink.png")
        if any(not (pack_dir / state).exists() for state in required_states):
            raise HTTPException(
                status_code=400,
                detail=(
                    f'VibeTube avatar pack missing for profile "{profile.name}". '
                    "Broadcast mode requires a complete 4-state VibeTube avatar pack."
                ),
            )

        if not audio.filename:
            raise HTTPException(status_code=400, detail="Audio file is required")

        try:
            job_id = str(uuid.uuid4())
            base_out = config.get_data_dir() / "vibetube" / job_id
            avatar_dir = base_out / "avatar"
            avatar_dir.mkdir(parents=True, exist_ok=True)

            audio_path = base_out / "source.wav"
            audio_path.write_bytes(await audio.read())

            shutil.copy2(pack_dir / "idle.png", avatar_dir / "idle.png")
            shutil.copy2(pack_dir / "talk.png", avatar_dir / "talk.png")
            if (pack_dir / "idle_blink.png").exists():
                shutil.copy2(pack_dir / "idle_blink.png", avatar_dir / "idle_blink.png")
            if (pack_dir / "talk_blink.png").exists():
                shutil.copy2(pack_dir / "talk_blink.png", avatar_dir / "talk_blink.png")
            if (pack_dir / "blink.png").exists():
                shutil.copy2(pack_dir / "blink.png", avatar_dir / "blink.png")

            background_image_path: Optional[Path] = None
            if use_background_image and background_image is not None:
                suffix = Path(background_image.filename or "").suffix.lower()
                if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                    suffix = ".png"
                background_image_path = base_out / f"background{suffix}"
                background_image_path.write_bytes(await background_image.read())

            background_enabled = bool(
                use_background
                or use_background_color
                or (use_background_image and background_image_path is not None)
            )
            normalized_caption_text = (caption_text or "").strip() or None

            render_result = vibetube.render_overlay(
                audio_path=audio_path,
                avatar_dir=avatar_dir,
                output_dir=base_out,
                fps=fps,
                width=width,
                height=height,
                on_threshold=on_threshold,
                off_threshold=off_threshold,
                smoothing_windows=smoothing_windows,
                min_hold_windows=min_hold_windows,
                blink_min_interval_sec=blink_min_interval_sec,
                blink_max_interval_sec=blink_max_interval_sec,
                blink_duration_frames=blink_duration_frames,
                head_motion_amount_px=head_motion_amount_px,
                head_motion_change_sec=head_motion_change_sec,
                head_motion_smoothness=head_motion_smoothness,
                voice_bounce_amount_px=voice_bounce_amount_px,
                voice_bounce_sensitivity=voice_bounce_sensitivity,
                use_background=background_enabled,
                background_color=background_color if use_background_color else None,
                background_image_path=background_image_path,
                text=normalized_caption_text,
                subtitle_enabled=subtitle_enabled,
                subtitle_style=subtitle_style,
                subtitle_text_color=subtitle_text_color,
                subtitle_outline_color=subtitle_outline_color,
                subtitle_outline_width=subtitle_outline_width,
                subtitle_font_family=subtitle_font_family,
                subtitle_bold=subtitle_bold,
                subtitle_italic=subtitle_italic,
                show_profile_names=show_profile_names,
                profile_display_name=profile.name,
            )

            meta_path = Path(render_result["meta_path"])
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
            meta.update(
                {
                    "source_kind": "broadcast_recording",
                    "source_profile_id": profile_id,
                    "source_profile_name": profile.name,
                    "source_text_preview": normalized_caption_text,
                }
            )
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

            return models.VibeTubeRenderResponse(
                job_id=job_id,
                output_dir=str(base_out.resolve()),
                video_path=str(Path(render_result["video_path"]).resolve()),
                timeline_path=str(Path(render_result["timeline_path"]).resolve()),
                captions_path=str(Path(render_result["captions_path"]).resolve())
                if render_result["captions_path"]
                else None,
                meta_path=str(Path(render_result["meta_path"]).resolve()),
                duration=float(render_result["duration_sec"]),
                source_kind="broadcast_recording",
                source_profile_id=profile_id,
                contains_transparency=bool(render_result.get("contains_transparency")),
                alpha_verified=bool(render_result.get("alpha_verified")),
                preferred_export_format=str(render_result.get("preferred_export_format") or "mp4"),
            )
        except HTTPException:
            raise
        except vibetube.VibeTubeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"VibeTube audio render failed: {str(exc)}")

    @router.get("/vibetube/jobs/{job_id}/video")
    async def vibetube_job_video(job_id: str):
        """Serve rendered WebM video for in-app preview."""
        video_path = config.get_data_dir() / "vibetube" / job_id / "avatar.webm"
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Rendered video not found")
        return FileResponse(video_path, media_type="video/webm")

    @router.get("/vibetube/jobs/{job_id}/export-mp4")
    async def vibetube_export_mp4(job_id: str):
        """Export rendered job as MP4 and return as downloadable file."""
        base_out = config.get_data_dir() / "vibetube" / job_id
        webm_path = base_out / "avatar.webm"
        mp4_path = base_out / "avatar.mp4"

        if not webm_path.exists():
            raise HTTPException(status_code=404, detail="Rendered video not found")

        job_meta = _load_vibetube_job_meta(base_out)
        if _vibetube_job_contains_transparency(base_out, job_meta, probe_if_needed=True):
            raise HTTPException(
                status_code=400,
                detail="This VibeTube render contains transparency. Export WebM or MOV to preserve alpha.",
            )

        try:
            vibetube.export_mp4(webm_path=webm_path, mp4_path=mp4_path)
        except vibetube.VibeTubeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"MP4 export failed: {str(exc)}")

        return FileResponse(
            mp4_path,
            media_type="video/mp4",
            filename=f"vibetube-{job_id}.mp4",
        )

    @router.get("/vibetube/jobs/{job_id}/export-video")
    async def vibetube_export_video(
        job_id: str,
        format: str = Query(default="auto", pattern="^(auto|webm|mp4|mov)$"),
    ):
        """Export a rendered job in a format that preserves transparency when needed."""
        base_out = config.get_data_dir() / "vibetube" / job_id
        webm_path = base_out / "avatar.webm"
        mp4_path = base_out / "avatar.mp4"
        mov_path = base_out / "avatar-alpha.mov"

        if not webm_path.exists():
            raise HTTPException(status_code=404, detail="Rendered video not found")

        job_meta = _load_vibetube_job_meta(base_out)
        contains_transparency = _vibetube_job_contains_transparency(
            base_out,
            job_meta,
            probe_if_needed=True,
        )
        preferred_export_format = _vibetube_job_preferred_export_format(
            base_out,
            job_meta,
            probe_if_needed=True,
        )
        export_format = format
        if export_format == "auto":
            export_format = preferred_export_format

        try:
            if export_format == "webm":
                if contains_transparency:
                    inspection = vibetube.inspect_video_alpha(webm_path)
                    if not bool(inspection["contains_transparency"]):
                        raise HTTPException(
                            status_code=400,
                            detail="WebM alpha could not be verified for this render. Export MOV instead.",
                        )
                return FileResponse(
                    webm_path,
                    media_type="video/webm",
                    filename=f"vibetube-{job_id}.webm",
                )

            if export_format == "mov":
                if not mov_path.exists():
                    vibetube.export_prores_4444(source_path=webm_path, mov_path=mov_path)
                if contains_transparency:
                    vibetube.verify_video_alpha(mov_path)
                return FileResponse(
                    mov_path,
                    media_type="video/quicktime",
                    filename=f"vibetube-{job_id}.mov",
                )

            if contains_transparency:
                raise HTTPException(
                    status_code=400,
                    detail="This VibeTube render contains transparency. Export WebM or MOV to preserve alpha.",
                )

            vibetube.export_mp4(webm_path=webm_path, mp4_path=mp4_path)
            return FileResponse(
                mp4_path,
                media_type="video/mp4",
                filename=f"vibetube-{job_id}.mp4",
            )
        except HTTPException:
            raise
        except vibetube.VibeTubeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Video export failed: {str(exc)}")

    @router.get("/vibetube/jobs/{job_id}/export-subtitles")
    async def vibetube_export_subtitles(
        job_id: str,
        format: str = Query(default="srt", pattern="^(srt|vtt)$"),
    ):
        """Export subtitles with timestamps for a rendered VibeTube job."""
        job_dir = config.get_data_dir() / "vibetube" / job_id
        if not job_dir.exists() or not job_dir.is_dir():
            raise HTTPException(status_code=404, detail="VibeTube job not found")

        try:
            captions_path = _ensure_vibetube_job_captions(job_dir)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Subtitle export failed: {str(exc)}")

        if format == "srt":
            return FileResponse(
                captions_path,
                media_type="application/x-subrip",
                filename=f"vibetube-{job_id}.srt",
            )

        try:
            srt_text = captions_path.read_text(encoding="utf-8")
            vtt_text = _srt_text_to_vtt_text(srt_text)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to convert subtitles to VTT: {str(exc)}")

        return StreamingResponse(
            io.BytesIO(vtt_text.encode("utf-8")),
            media_type="text/vtt",
            headers={
                "Content-Disposition": _safe_content_disposition("attachment", f"vibetube-{job_id}.vtt")
            },
        )

    @router.get("/vibetube/jobs", response_model=List[models.VibeTubeJobResponse])
    async def list_vibetube_jobs(db: Session = Depends(get_db)):
        """List all rendered VibeTube jobs."""
        jobs_root = config.get_data_dir() / "vibetube"
        if not jobs_root.exists():
            return []

        jobs: List[models.VibeTubeJobResponse] = []
        for job_dir in jobs_root.iterdir():
            if not job_dir.is_dir():
                continue

            meta_path = job_dir / "meta.json"
            meta = _load_vibetube_job_meta(job_dir)
            created_ts = datetime.fromtimestamp(job_dir.stat().st_mtime)
            duration_sec: Optional[float] = None
            video_path: Optional[str] = None
            source_generation_id: Optional[str] = None
            source_story_id: Optional[str] = None
            source_kind: Optional[str] = None
            source_profile_id: Optional[str] = None
            source_story_name: Optional[str] = None
            source_profile_name: Optional[str] = None
            source_text_preview: Optional[str] = None
            contains_transparency: Optional[bool] = None
            alpha_verified: Optional[bool] = None
            preferred_export_format: Optional[str] = None

            if meta:
                try:
                    duration_sec = (
                        float(meta.get("duration_sec"))
                        if meta.get("duration_sec") is not None
                        else None
                    )
                    source_generation_id = meta.get("source_generation_id")
                    source_story_id = meta.get("source_story_id")
                    source_kind = _vibetube_job_source_kind(meta)
                    source_profile_id = _vibetube_job_source_profile_id(meta)
                    source_story_name = meta.get("source_story_name")
                    source_profile_name = meta.get("source_profile_name")
                    source_text_preview = meta.get("source_text_preview")
                    contains_transparency = _vibetube_job_contains_transparency(job_dir, meta)
                    alpha_verified = _vibetube_job_alpha_verified(meta)
                    preferred_export_format = _vibetube_job_preferred_export_format(job_dir, meta)
                except Exception:
                    duration_sec = None

            if source_generation_id is None and meta_path.exists():
                try:
                    audio_name = str(meta.get("audio") or "").strip()
                    if audio_name.lower().endswith(".wav"):
                        source_generation_id = Path(audio_name).stem
                except Exception:
                    pass

            if source_generation_id and (not source_profile_name or not source_text_preview):
                generation = db.query(DBGeneration).filter_by(id=source_generation_id).first()
                if generation:
                    if not source_profile_id:
                        source_profile_id = generation.profile_id
                    if not source_text_preview:
                        source_text_preview = generation.text
                    if not source_profile_name:
                        profile = db.query(DBVoiceProfile).filter_by(id=generation.profile_id).first()
                        if profile:
                            source_profile_name = profile.name

            if source_story_id and source_kind in {None, "unknown"}:
                source_kind = "story"
            elif source_generation_id and source_kind in {None, "unknown"}:
                source_kind = "generation"
            elif source_kind is None:
                source_kind = "unknown"

            if not source_text_preview and meta_path.exists():
                try:
                    captions_name = str(meta.get("captions") or "").strip()
                    if captions_name:
                        source_text_preview = _extract_caption_preview(job_dir / captions_name)
                except Exception:
                    pass

            webm_path = job_dir / "avatar.webm"
            if webm_path.exists():
                video_path = str(webm_path.resolve())

            jobs.append(
                models.VibeTubeJobResponse(
                    job_id=job_dir.name,
                    created_at=created_ts,
                    duration_sec=duration_sec,
                    video_path=video_path,
                    source_generation_id=source_generation_id,
                    source_story_id=source_story_id,
                    source_kind=source_kind,
                    source_profile_id=source_profile_id,
                    source_story_name=source_story_name,
                    source_profile_name=source_profile_name,
                    source_text_preview=source_text_preview,
                    contains_transparency=contains_transparency,
                    alpha_verified=alpha_verified,
                    preferred_export_format=preferred_export_format,
                )
            )

        jobs.sort(key=lambda item: item.created_at, reverse=True)
        return jobs

    @router.delete("/vibetube/jobs/{job_id}")
    async def delete_vibetube_job(job_id: str):
        """Delete one VibeTube render job and all generated files."""
        job_dir = config.get_data_dir() / "vibetube" / job_id
        if not job_dir.exists() or not job_dir.is_dir():
            raise HTTPException(status_code=404, detail="VibeTube job not found")

        shutil.rmtree(job_dir, ignore_errors=True)
        return {"message": "VibeTube job deleted"}

    return router
