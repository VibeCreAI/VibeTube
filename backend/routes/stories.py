"""Story routes and story-to-VibeTube rendering flow."""

from __future__ import annotations

import base64
import io
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Awaitable, Callable, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import config, models, vibetube
from ..database import (
    Generation as DBGeneration,
    Story as DBStory,
    StoryItem as DBStoryItem,
    VoiceProfile as DBVoiceProfile,
    get_db,
)
from ..services import stories

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


def _save_data_url_image(data_url: str, target_path: Path) -> None:
    """Decode a data URL image and save it to disk."""
    match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url.strip())
    if not match:
        raise ValueError("Invalid background image data URL format.")
    mime_type = match.group(1).lower()
    raw_b64 = match.group(2)
    if mime_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}:
        raise ValueError("Unsupported background image type. Use PNG/JPEG/WEBP/GIF.")
    try:
        payload = base64.b64decode(raw_b64, validate=True)
    except Exception as exc:
        raise ValueError("Invalid background image base64 payload.") from exc
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(payload)


def create_stories_router(generate_func: GenerateSpeechFunc) -> APIRouter:
    """Create a stories router bound to a generation function."""
    router = APIRouter()

    async def _render_story_vibetube_internal(
        story_id: str,
        data: models.StoryVibeTubeRenderRequest,
        db: Session,
    ) -> models.VibeTubeRenderResponse:
        """Internal helper used by story render and batch creation."""
        story = db.query(DBStory).filter_by(id=story_id).first()
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")

        rows = (
            db.query(DBStoryItem, DBGeneration)
            .join(DBGeneration, DBStoryItem.generation_id == DBGeneration.id)
            .filter(DBStoryItem.story_id == story_id)
            .order_by(DBStoryItem.start_time_ms)
            .all()
        )
        if not rows:
            raise HTTPException(status_code=400, detail="Story has no items to render")

        audio_bytes = await stories.export_story_audio(story_id, db)
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Story has no renderable audio items")

        job_id = str(uuid.uuid4())
        base_out = config.get_data_dir() / "vibetube" / job_id
        avatar_root = base_out / "avatar"
        avatar_root.mkdir(parents=True, exist_ok=True)

        mixed_audio_path = base_out / "story.wav"
        mixed_audio_path.write_bytes(audio_bytes)

        profile_segments: dict[str, list[tuple[float, float]]] = {}
        profile_display_names: dict[str, str] = {}
        story_text_parts: list[str] = []
        story_subtitle_cues: list[dict[str, int | str]] = []

        for item, generation in rows:
            trim_start_ms = max(0, int(getattr(item, "trim_start_ms", 0) or 0))
            trim_end_ms = max(0, int(getattr(item, "trim_end_ms", 0) or 0))
            original_ms = max(0, int(round(float(generation.duration) * 1000)))
            effective_ms = max(0, original_ms - trim_start_ms - trim_end_ms)
            if effective_ms <= 0:
                continue

            start_sec = max(0.0, float(item.start_time_ms) / 1000.0)
            end_sec = start_sec + (effective_ms / 1000.0)
            profile_segments.setdefault(generation.profile_id, []).append((start_sec, end_sec))

            text = (generation.text or "").strip()
            if text:
                story_text_parts.append(text)
                relative_cues = vibetube._build_subtitle_cues(
                    text=text,
                    duration_sec=effective_ms / 1000.0,
                )
                for cue in relative_cues:
                    story_subtitle_cues.append(
                        {
                            "start_ms": int(item.start_time_ms) + int(cue["start_ms"]),
                            "end_ms": int(item.start_time_ms) + int(cue["end_ms"]),
                            "text": str(cue["text"]),
                        }
                    )

        if not profile_segments:
            raise HTTPException(
                status_code=400,
                detail="Story has no effective audio after trim settings",
            )

        for profile_id in sorted(profile_segments.keys()):
            profile = db.query(DBVoiceProfile).filter_by(id=profile_id).first()
            profile_name = profile.name if profile else profile_id
            profile_display_names[profile_id] = profile_name
            pack_dir = _vibetube_avatar_pack_dir(profile_id)
            if not (pack_dir / "idle.png").exists() or not (pack_dir / "talk.png").exists():
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f'VibeTube avatar pack missing for profile "{profile_name}". '
                        "Save idle/talk (and optional blink) images for each voice in this story."
                    ),
                )

            out_dir = avatar_root / profile_id
            out_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(pack_dir / "idle.png", out_dir / "idle.png")
            shutil.copy2(pack_dir / "talk.png", out_dir / "talk.png")
            if (pack_dir / "idle_blink.png").exists():
                shutil.copy2(pack_dir / "idle_blink.png", out_dir / "idle_blink.png")
            if (pack_dir / "talk_blink.png").exists():
                shutil.copy2(pack_dir / "talk_blink.png", out_dir / "talk_blink.png")
            if (pack_dir / "blink.png").exists():
                shutil.copy2(pack_dir / "blink.png", out_dir / "blink.png")

        avatar_dirs = {profile_id: avatar_root / profile_id for profile_id in profile_segments.keys()}
        story_text = "\n".join(story_text_parts)
        story_background_image_path: Optional[Path] = None
        if data.use_background_image and data.background_image_data:
            try:
                story_background_image_path = base_out / "story_background.png"
                _save_data_url_image(data.background_image_data, story_background_image_path)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))

        story_background_enabled = bool(
            data.use_background
            or data.use_background_color
            or (data.use_background_image and story_background_image_path is not None)
        )

        render_result = vibetube.render_story_overlay(
            audio_path=mixed_audio_path,
            profile_segments=profile_segments,
            avatar_dirs=avatar_dirs,
            output_dir=base_out,
            fps=data.fps,
            width=data.width,
            height=data.height,
            on_threshold=data.on_threshold,
            off_threshold=data.off_threshold,
            smoothing_windows=data.smoothing_windows,
            min_hold_windows=data.min_hold_windows,
            blink_min_interval_sec=data.blink_min_interval_sec,
            blink_max_interval_sec=data.blink_max_interval_sec,
            blink_duration_frames=data.blink_duration_frames,
            head_motion_amount_px=data.head_motion_amount_px,
            head_motion_change_sec=data.head_motion_change_sec,
            head_motion_smoothness=data.head_motion_smoothness,
            voice_bounce_amount_px=data.voice_bounce_amount_px,
            voice_bounce_sensitivity=data.voice_bounce_sensitivity,
            use_background=story_background_enabled,
            background_color=data.background_color if data.use_background_color else None,
            background_image_path=story_background_image_path,
            text=story_text,
            subtitle_enabled=data.subtitle_enabled,
            subtitle_style=data.subtitle_style,
            subtitle_text_color=data.subtitle_text_color,
            subtitle_outline_color=data.subtitle_outline_color,
            subtitle_outline_width=data.subtitle_outline_width,
            subtitle_font_family=data.subtitle_font_family,
            subtitle_bold=data.subtitle_bold,
            subtitle_italic=data.subtitle_italic,
            story_layout_style=data.story_layout_style,
            show_profile_names=data.show_profile_names,
            profile_display_names=profile_display_names,
            subtitle_cues=story_subtitle_cues,
        )

        source_text_preview = story_text.strip()[:1000] if story_text.strip() else None

        meta_path = Path(render_result["meta_path"])
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
        meta.update(
            {
                "source_kind": "story",
                "source_story_id": story_id,
                "source_story_name": story.name,
                "source_text_preview": source_text_preview,
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
            source_story_id=story_id,
            source_kind="story",
            contains_transparency=bool(render_result.get("contains_transparency")),
            alpha_verified=bool(render_result.get("alpha_verified")),
            preferred_export_format=str(render_result.get("preferred_export_format") or "mp4"),
        )

    @router.get("/stories", response_model=List[models.StoryResponse])
    async def list_stories(db: Session = Depends(get_db)):
        """List all stories."""
        return await stories.list_stories(db)

    @router.post("/stories", response_model=models.StoryResponse)
    async def create_story(
        data: models.StoryCreate,
        db: Session = Depends(get_db),
    ):
        """Create a new story."""
        try:
            return await stories.create_story(data, db)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @router.post("/stories/batch", response_model=models.StoryBatchCreateResponse)
    async def create_story_batch(
        data: models.StoryBatchCreateRequest,
        db: Session = Depends(get_db),
    ):
        """Create a new story by generating multiple rows sequentially."""
        try:
            return await stories.create_story_from_batch(
                data,
                db,
                generate_func=generate_func,
                render_func=_render_story_vibetube_internal,
            )
        except stories.StoryBatchValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except stories.StoryBatchGenerationError as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/stories/import-json", response_model=models.StoryBatchCreateResponse)
    async def import_story_json(
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
    ):
        """Import a JSON script and create a new multi-voice story."""
        try:
            if not file.filename or not file.filename.lower().endswith(".json"):
                raise HTTPException(status_code=400, detail="Please upload a .json file")

            raw_content = await file.read()
            try:
                payload = json.loads(raw_content.decode("utf-8"))
            except UnicodeDecodeError:
                raise HTTPException(status_code=400, detail="JSON file must be UTF-8 encoded")
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=400, detail=f"Malformed JSON: {exc.msg}")

            try:
                request = models.StoryBatchCreateRequest.model_validate(payload)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Invalid JSON schema: {exc}")

            return await stories.create_story_from_batch(
                request,
                db,
                generate_func=generate_func,
                render_func=_render_story_vibetube_internal,
            )
        except stories.StoryBatchValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except stories.StoryBatchGenerationError as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @router.get("/stories/{story_id}", response_model=models.StoryDetailResponse)
    async def get_story(
        story_id: str,
        db: Session = Depends(get_db),
    ):
        """Get a story with all its items."""
        story = await stories.get_story(story_id, db)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")
        return story

    @router.put("/stories/{story_id}", response_model=models.StoryResponse)
    async def update_story(
        story_id: str,
        data: models.StoryCreate,
        db: Session = Depends(get_db),
    ):
        """Update a story."""
        story = await stories.update_story(story_id, data, db)
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")
        return story

    @router.delete("/stories/{story_id}")
    async def delete_story(
        story_id: str,
        db: Session = Depends(get_db),
    ):
        """Delete a story."""
        success = await stories.delete_story(story_id, db)
        if not success:
            raise HTTPException(status_code=404, detail="Story not found")
        return {"message": "Story deleted successfully"}

    @router.post("/stories/{story_id}/items", response_model=models.StoryItemDetail)
    async def add_story_item(
        story_id: str,
        data: models.StoryItemCreate,
        db: Session = Depends(get_db),
    ):
        """Add a generation to a story."""
        item = await stories.add_item_to_story(story_id, data, db)
        if not item:
            raise HTTPException(status_code=404, detail="Story or generation not found")
        return item

    @router.post(
        "/stories/{story_id}/items/{item_id}/regenerate",
        response_model=models.StoryItemDetail,
    )
    async def regenerate_story_item(
        story_id: str,
        item_id: str,
        data: models.StoryItemRegenerateRequest,
        db: Session = Depends(get_db),
    ):
        """Regenerate a story item and keep its placement in the story."""
        item = await stories.regenerate_story_item(
            story_id,
            item_id,
            data,
            db,
            generate_func,
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Story item not found")
        return item

    @router.delete("/stories/{story_id}/items/{item_id}")
    async def remove_story_item(
        story_id: str,
        item_id: str,
        db: Session = Depends(get_db),
    ):
        """Remove a story item from a story."""
        success = await stories.remove_item_from_story(story_id, item_id, db)
        if not success:
            raise HTTPException(status_code=404, detail="Story item not found")
        return {"message": "Item removed successfully"}

    @router.put("/stories/{story_id}/items/times")
    async def update_story_item_times(
        story_id: str,
        data: models.StoryItemBatchUpdate,
        db: Session = Depends(get_db),
    ):
        """Update story item timecodes."""
        success = await stories.update_story_item_times(story_id, data, db)
        if not success:
            raise HTTPException(status_code=400, detail="Invalid timecode update request")
        return {"message": "Item timecodes updated successfully"}

    @router.put(
        "/stories/{story_id}/items/reorder",
        response_model=List[models.StoryItemDetail],
    )
    async def reorder_story_items(
        story_id: str,
        data: models.StoryItemReorder,
        db: Session = Depends(get_db),
    ):
        """Reorder story items and recalculate timecodes."""
        items = await stories.reorder_story_items(story_id, data.generation_ids, db)
        if items is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid reorder request - ensure all generation IDs belong to this story"
                ),
            )
        return items

    @router.put(
        "/stories/{story_id}/items/{item_id}/move",
        response_model=models.StoryItemDetail,
    )
    async def move_story_item(
        story_id: str,
        item_id: str,
        data: models.StoryItemMove,
        db: Session = Depends(get_db),
    ):
        """Move a story item (update position and/or track)."""
        item = await stories.move_story_item(story_id, item_id, data, db)
        if item is None:
            raise HTTPException(status_code=404, detail="Story item not found")
        return item

    @router.put(
        "/stories/{story_id}/items/{item_id}/trim",
        response_model=models.StoryItemDetail,
    )
    async def trim_story_item(
        story_id: str,
        item_id: str,
        data: models.StoryItemTrim,
        db: Session = Depends(get_db),
    ):
        """Trim a story item (update trim_start_ms and trim_end_ms)."""
        item = await stories.trim_story_item(story_id, item_id, data, db)
        if item is None:
            raise HTTPException(
                status_code=404,
                detail="Story item not found or invalid trim values",
            )
        return item

    @router.post(
        "/stories/{story_id}/items/{item_id}/split",
        response_model=List[models.StoryItemDetail],
    )
    async def split_story_item(
        story_id: str,
        item_id: str,
        data: models.StoryItemSplit,
        db: Session = Depends(get_db),
    ):
        """Split a story item at a given time, creating two clips."""
        items = await stories.split_story_item(story_id, item_id, data, db)
        if items is None:
            raise HTTPException(
                status_code=404,
                detail="Story item not found or invalid split point",
            )
        return items

    @router.post(
        "/stories/{story_id}/items/{item_id}/duplicate",
        response_model=models.StoryItemDetail,
    )
    async def duplicate_story_item(
        story_id: str,
        item_id: str,
        db: Session = Depends(get_db),
    ):
        """Duplicate a story item, creating a copy with all properties."""
        item = await stories.duplicate_story_item(story_id, item_id, db)
        if item is None:
            raise HTTPException(status_code=404, detail="Story item not found")
        return item

    @router.get("/stories/{story_id}/export-audio")
    async def export_story_audio(
        story_id: str,
        db: Session = Depends(get_db),
    ):
        """Export story as single mixed audio file with timecode-based mixing."""
        try:
            story = db.query(DBStory).filter_by(id=story_id).first()
            if not story:
                raise HTTPException(status_code=404, detail="Story not found")

            audio_bytes = await stories.export_story_audio(story_id, db)
            if not audio_bytes:
                raise HTTPException(status_code=400, detail="Story has no audio items")

            safe_name = "".join(
                c for c in story.name if c.isalnum() or c in (" ", "-", "_")
            ).strip()
            if not safe_name:
                safe_name = "story"
            filename = f"{safe_name}.wav"

            return StreamingResponse(
                io.BytesIO(audio_bytes),
                media_type="audio/wav",
                headers={"Content-Disposition": _safe_content_disposition("attachment", filename)},
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post(
        "/stories/{story_id}/render-vibetube",
        response_model=models.VibeTubeRenderResponse,
    )
    async def render_story_vibetube(
        story_id: str,
        data: models.StoryVibeTubeRenderRequest,
        db: Session = Depends(get_db),
    ):
        """Render a full story into one multi-avatar VibeTube video."""
        try:
            return await _render_story_vibetube_internal(story_id, data, db)
        except HTTPException:
            raise
        except vibetube.VibeTubeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Story VibeTube render failed: {str(exc)}",
            )

    return router
