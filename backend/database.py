"""SQLite connection helpers and schema initialization for LinkVault."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "linkvault.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'Uncategorized',
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks (category);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks (created_at);
"""


def get_db_path() -> Path | str:
    """Resolve the database location (env override makes tests isolated)."""
    override = os.environ.get("LINKVAULT_DB")
    if override:
        if override == ":memory:":
            return override
        return Path(override).expanduser()
    return DEFAULT_DB_PATH


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open a connection with safe defaults and dict-like rows."""
    path = get_db_path() if db_path is None else db_path
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # Each request gets its own connection, so allow FastAPI's threadpool to
    # move it between worker threads within that request.
    conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def connection(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | str | None = None) -> None:
    """Create tables and indexes if they do not exist."""
    with connection(db_path) as conn:
        conn.executescript(SCHEMA)
