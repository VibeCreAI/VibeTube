"""Database engine/session management."""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .. import config
from .migrations import run_migrations
from .models import AudioChannel, Base, ProfileChannelMapping, VoiceProfile

engine = None
SessionLocal = None
_db_path: Path | None = None


def init_db() -> None:
    """Initialize database tables and run migrations."""
    global engine, SessionLocal, _db_path

    _db_path = config.get_db_path()
    _db_path.parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        f"sqlite:///{_db_path}",
        connect_args={"check_same_thread": False},
    )

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    run_migrations(engine)
    Base.metadata.create_all(bind=engine)
    _ensure_default_channel()


def _ensure_default_channel() -> None:
    if SessionLocal is None:
        return

    db: Session = SessionLocal()
    try:
        default_channel = db.query(AudioChannel).filter(AudioChannel.is_default.is_(True)).first()
        if default_channel:
            return

        default_channel = AudioChannel(
            id=str(uuid.uuid4()),
            name="Default",
            is_default=True,
        )
        db.add(default_channel)

        profiles = db.query(VoiceProfile).all()
        for profile in profiles:
            db.add(
                ProfileChannelMapping(
                    profile_id=profile.id,
                    channel_id=default_channel.id,
                )
            )

        db.commit()
    finally:
        db.close()


def get_db():
    """Dependency-injected session with rollback-on-exception semantics."""
    if SessionLocal is None:
        init_db()

    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

