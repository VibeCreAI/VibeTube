"""Database migration helpers."""

from __future__ import annotations

from sqlalchemy import inspect, text


def run_migrations(engine) -> None:
    """Run lightweight in-place SQLite migrations."""
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    if "generations" in table_names:
        columns = {col["name"] for col in inspector.get_columns("generations")}
        if "engine" not in columns:
            print("Migrating generations: adding engine column")
            with engine.connect() as conn:
                conn.execute(
                    text("ALTER TABLE generations ADD COLUMN engine VARCHAR NOT NULL DEFAULT 'qwen'")
                )
                conn.execute(
                    text("UPDATE generations SET engine = 'qwen' WHERE engine IS NULL OR engine = ''")
                )
                conn.commit()
                print("Added engine column to generations")
            inspector = inspect(engine)
            table_names = set(inspector.get_table_names())

        columns = {col["name"] for col in inspector.get_columns("generations")}
        if "model_size" not in columns:
            print("Migrating generations: adding model_size column")
            with engine.connect() as conn:
                conn.execute(
                    text("ALTER TABLE generations ADD COLUMN model_size VARCHAR NOT NULL DEFAULT '1.7B'")
                )
                conn.execute(
                    text(
                        "UPDATE generations SET model_size = '1.7B' "
                        "WHERE model_size IS NULL OR model_size = ''"
                    )
                )
                conn.commit()
                print("Added model_size column to generations")

        columns = {col["name"] for col in inspector.get_columns("generations")}
        if "source_type" not in columns:
            print("Migrating generations: adding source_type column")
            with engine.connect() as conn:
                conn.execute(
                    text("ALTER TABLE generations ADD COLUMN source_type VARCHAR NOT NULL DEFAULT 'ai'")
                )
                conn.execute(
                    text(
                        "UPDATE generations SET source_type = 'ai' "
                        "WHERE source_type IS NULL OR source_type = ''"
                    )
                )
                conn.commit()
                print("Added source_type column to generations")

    if "story_items" not in table_names:
        return

    columns = {col["name"] for col in inspector.get_columns("story_items")}

    if "position" in columns:
        print("Migrating story_items: removing position column, using start_time_ms")

        with engine.connect() as conn:
            has_start_time = "start_time_ms" in columns

            if not has_start_time:
                conn.execute(text("ALTER TABLE story_items ADD COLUMN start_time_ms INTEGER DEFAULT 0"))

                result = conn.execute(
                    text(
                        """
                        SELECT si.id, si.story_id, si.position, g.duration
                        FROM story_items si
                        JOIN generations g ON si.generation_id = g.id
                        ORDER BY si.story_id, si.position
                        """
                    )
                )

                rows = result.fetchall()
                current_story_id = None
                current_time_ms = 0

                for row in rows:
                    item_id, story_id, _position, duration = row
                    if story_id != current_story_id:
                        current_story_id = story_id
                        current_time_ms = 0

                    conn.execute(
                        text("UPDATE story_items SET start_time_ms = :time WHERE id = :id"),
                        {"time": current_time_ms, "id": item_id},
                    )
                    current_time_ms += int(duration * 1000) + 200

                conn.commit()

            conn.execute(
                text(
                    """
                    CREATE TABLE story_items_new (
                        id VARCHAR PRIMARY KEY,
                        story_id VARCHAR NOT NULL,
                        generation_id VARCHAR NOT NULL,
                        start_time_ms INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME,
                        FOREIGN KEY (story_id) REFERENCES stories(id),
                        FOREIGN KEY (generation_id) REFERENCES generations(id)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO story_items_new (id, story_id, generation_id, start_time_ms, created_at)
                    SELECT id, story_id, generation_id, start_time_ms, created_at FROM story_items
                    """
                )
            )
            conn.execute(text("DROP TABLE story_items"))
            conn.execute(text("ALTER TABLE story_items_new RENAME TO story_items"))
            conn.commit()
            print("Migrated story_items table to use start_time_ms (removed position column)")

    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("story_items")}
    if "track" not in columns:
        print("Migrating story_items: adding track column")
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE story_items ADD COLUMN track INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
            print("Added track column to story_items")

    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("story_items")}
    if "trim_start_ms" not in columns:
        print("Migrating story_items: adding trim_start_ms column")
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE story_items ADD COLUMN trim_start_ms INTEGER NOT NULL DEFAULT 0")
            )
            conn.commit()
            print("Added trim_start_ms column to story_items")

    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("story_items")}
    if "trim_end_ms" not in columns:
        print("Migrating story_items: adding trim_end_ms column")
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE story_items ADD COLUMN trim_end_ms INTEGER NOT NULL DEFAULT 0")
            )
            conn.commit()
            print("Added trim_end_ms column to story_items")

    if "profiles" in inspector.get_table_names():
        columns = {col["name"] for col in inspector.get_columns("profiles")}
        if "avatar_path" not in columns:
            print("Migrating profiles: adding avatar_path column")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE profiles ADD COLUMN avatar_path VARCHAR"))
                conn.commit()
                print("Added avatar_path column to profiles")
