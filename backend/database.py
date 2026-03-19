"""Compatibility facade for database modules.

This keeps legacy imports (``backend.database``) working while the internals
live under ``backend.db``.
"""

from __future__ import annotations

from .db.models import (
    AudioChannel,
    Base,
    ChannelDeviceMapping,
    Generation,
    ProfileChannelMapping,
    ProfileSample,
    Project,
    Story,
    StoryItem,
    VoiceProfile,
)
from .db.session import get_db, init_db
from .db import session as _session

__all__ = [
    "AudioChannel",
    "Base",
    "ChannelDeviceMapping",
    "Generation",
    "ProfileChannelMapping",
    "ProfileSample",
    "Project",
    "Story",
    "StoryItem",
    "VoiceProfile",
    "get_db",
    "init_db",
    "engine",
    "SessionLocal",
    "_db_path",
]


def __getattr__(name: str):
    if name in {"engine", "SessionLocal", "_db_path"}:
        return getattr(_session, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

