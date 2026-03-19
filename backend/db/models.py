"""SQLAlchemy models for VibeTube backend."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


class VoiceProfile(Base):
    """Voice profile database model."""

    __tablename__ = "profiles"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    description = Column(Text)
    language = Column(String, default="en")
    avatar_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProfileSample(Base):
    """Voice profile sample database model."""

    __tablename__ = "profile_samples"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    profile_id = Column(String, ForeignKey("profiles.id"), nullable=False)
    audio_path = Column(String, nullable=False)
    reference_text = Column(Text, nullable=False)


class Generation(Base):
    """Generation history database model."""

    __tablename__ = "generations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    profile_id = Column(String, ForeignKey("profiles.id"), nullable=False)
    text = Column(Text, nullable=False)
    language = Column(String, default="en")
    engine = Column(String, nullable=False, default="qwen")
    model_size = Column(String, nullable=False, default="1.7B")
    source_type = Column(String, nullable=False, default="ai")
    audio_path = Column(String, nullable=False)
    duration = Column(Float, nullable=False)
    seed = Column(Integer)
    instruct = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class Story(Base):
    """Story database model."""

    __tablename__ = "stories"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StoryItem(Base):
    """Story item database model (links generations to stories)."""

    __tablename__ = "story_items"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    story_id = Column(String, ForeignKey("stories.id"), nullable=False)
    generation_id = Column(String, ForeignKey("generations.id"), nullable=False)
    start_time_ms = Column(Integer, nullable=False, default=0)
    track = Column(Integer, nullable=False, default=0)
    trim_start_ms = Column(Integer, nullable=False, default=0)
    trim_end_ms = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class Project(Base):
    """Audio studio project database model."""

    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    data = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AudioChannel(Base):
    """Audio channel (bus) database model."""

    __tablename__ = "audio_channels"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChannelDeviceMapping(Base):
    """Mapping between channels and OS audio devices."""

    __tablename__ = "channel_device_mappings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id = Column(String, ForeignKey("audio_channels.id"), nullable=False)
    device_id = Column(String, nullable=False)


class ProfileChannelMapping(Base):
    """Mapping between voice profiles and audio channels (many-to-many)."""

    __tablename__ = "profile_channel_mappings"

    profile_id = Column(String, ForeignKey("profiles.id"), primary_key=True)
    channel_id = Column(String, ForeignKey("audio_channels.id"), primary_key=True)
