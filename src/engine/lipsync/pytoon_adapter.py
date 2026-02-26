from __future__ import annotations

import inspect
import logging
from pathlib import Path
from typing import Optional


KNOWN_ALIGN_FUNCTIONS = (
    "align_audio",
    "generate_alignment",
    "analyze_audio",
    "align",
)


def try_pytoon_timeline(
    audio_path: Path,
    fps: int,
    total_frames: int,
    logger: logging.Logger,
) -> Optional[list[dict[str, str | int]]]:
    """
    Best-effort adapter for PyToon API variations.
    Returns frame-state change points or None when unavailable.
    """
    try:
        import pytoon  # type: ignore
    except Exception:
        return None

    for fn_name in KNOWN_ALIGN_FUNCTIONS:
        fn = getattr(pytoon, fn_name, None)
        if not callable(fn):
            continue

        try:
            signature = inspect.signature(fn)
            kwargs = {}
            if "audio_path" in signature.parameters:
                kwargs["audio_path"] = str(audio_path)
            elif "path" in signature.parameters:
                kwargs["path"] = str(audio_path)
            else:
                kwargs[next(iter(signature.parameters))] = str(audio_path)

            if "fps" in signature.parameters:
                kwargs["fps"] = fps

            result = fn(**kwargs)
            timeline = _normalize_pytoon_result(result, fps, total_frames)
            if timeline:
                logger.info("Using PyToon lip-sync alignment via '%s'.", fn_name)
                return timeline
        except Exception as exc:
            logger.warning("PyToon function '%s' failed: %s", fn_name, exc)

    logger.info("PyToon installed, but no compatible alignment function was detected. Falling back to RMS.")
    return None


def _normalize_pytoon_result(result: object, fps: int, total_frames: int) -> list[dict[str, str | int]]:
    if not isinstance(result, list) or not result:
        return []

    timeline: list[dict[str, str | int]] = [{"frame": 0, "state": "idle"}]
    for item in result:
        if not isinstance(item, dict):
            continue

        if "frame" in item and "state" in item:
            frame = int(item["frame"])
            state = str(item["state"])
        elif "start" in item:
            frame = int(float(item["start"]) * fps)
            state = "talk"
        else:
            continue

        frame = max(0, min(total_frames - 1, frame))
        if state not in {"talk", "idle"}:
            state = "talk"

        if timeline[-1]["state"] == state:
            continue
        timeline.append({"frame": frame, "state": state})

    if not timeline:
        return [{"frame": 0, "state": "idle"}]
    return timeline

