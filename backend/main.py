"""LinkVault FastAPI application: bookmark CRUD, search, stats.

The API is intended to run on localhost only; it has no authentication.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator, Iterator, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.database import connection, init_db
from backend.models import (
    Bookmark,
    BookmarkCreate,
    BookmarkUpdate,
    FavoriteUpdate,
    Health,
    Stats,
)

VERSION = "0.1.0"
SORT_ORDERS = {
    "newest": "created_at DESC, id DESC",
    "oldest": "created_at ASC, id ASC",
    "alpha": "LOWER(title) ASC, id ASC",
}

DEFAULT_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _row_to_bookmark(row: sqlite3.Row) -> Bookmark:
    data = dict(row)
    data["is_favorite"] = bool(data["is_favorite"])
    return Bookmark(**data)


def get_conn() -> Iterator[sqlite3.Connection]:
    with connection() as conn:
        yield conn


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(
    title="LinkVault API",
    version=VERSION,
    description="Local-only bookmark manager API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get("CORS_ORIGINS", DEFAULT_ORIGINS).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"message": str(exc.detail)}},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request, exc: RequestValidationError
) -> JSONResponse:
    details = [
        {
            "field": ".".join(str(part) for part in error["loc"][1:]) or "body",
            "message": error["msg"].removeprefix("Value error, "),
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": {"message": details[0]["message"] if details else "Invalid input", "details": details},
        },
    )


def _fetch(conn: sqlite3.Connection, bookmark_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM bookmarks WHERE id = ?", (bookmark_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return row


@app.get("/api/health", response_model=Health)
def health() -> Health:
    return Health(status="ok", version=VERSION)


@app.get("/api/bookmarks", response_model=list[Bookmark])
def list_bookmarks(
    conn: sqlite3.Connection = Depends(get_conn),
    q: str | None = Query(default=None, max_length=200),
    category: str | None = Query(default=None, max_length=60),
    favorite: bool | None = Query(default=None),
    sort: Literal["newest", "oldest", "alpha"] = "newest",
) -> list[Bookmark]:
    clauses: list[str] = []
    params: list[object] = []

    term = (q or "").strip()
    if term:
        escaped = (
            term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        pattern = f"%{escaped}%"
        clauses.append(
            "(title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' "
            "OR description LIKE ? ESCAPE '\\')"
        )
        params.extend([pattern, pattern, pattern])

    category_value = (category or "").strip()
    if category_value:
        clauses.append("category = ? COLLATE NOCASE")
        params.append(category_value)

    if favorite is not None:
        clauses.append("is_favorite = ?")
        params.append(int(favorite))

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    order = SORT_ORDERS[sort]
    rows = conn.execute(
        f"SELECT * FROM bookmarks {where} ORDER BY {order}", params
    ).fetchall()
    return [_row_to_bookmark(row) for row in rows]


@app.get("/api/bookmarks/{bookmark_id}", response_model=Bookmark)
def get_bookmark(
    bookmark_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> Bookmark:
    return _row_to_bookmark(_fetch(conn, bookmark_id))


@app.post("/api/bookmarks", response_model=Bookmark, status_code=201)
def create_bookmark(
    payload: BookmarkCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> Bookmark:
    now = _now()
    cursor = conn.execute(
        "INSERT INTO bookmarks (title, url, description, category, is_favorite, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            payload.title,
            payload.url,
            payload.description,
            payload.category,
            int(payload.is_favorite),
            now,
            now,
        ),
    )
    return _row_to_bookmark(_fetch(conn, int(cursor.lastrowid)))


@app.put("/api/bookmarks/{bookmark_id}", response_model=Bookmark)
def update_bookmark(
    bookmark_id: int,
    payload: BookmarkUpdate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Bookmark:
    _fetch(conn, bookmark_id)
    conn.execute(
        "UPDATE bookmarks SET title = ?, url = ?, description = ?, category = ?, "
        "is_favorite = ?, updated_at = ? WHERE id = ?",
        (
            payload.title,
            payload.url,
            payload.description,
            payload.category,
            int(payload.is_favorite),
            _now(),
            bookmark_id,
        ),
    )
    return _row_to_bookmark(_fetch(conn, bookmark_id))


@app.delete("/api/bookmarks/{bookmark_id}", status_code=204)
def delete_bookmark(
    bookmark_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> Response:
    _fetch(conn, bookmark_id)
    conn.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,))
    return Response(status_code=204)


@app.patch("/api/bookmarks/{bookmark_id}/favorite", response_model=Bookmark)
def set_favorite(
    bookmark_id: int,
    payload: FavoriteUpdate | None = None,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Bookmark:
    row = _fetch(conn, bookmark_id)
    new_value = (
        payload.is_favorite
        if payload is not None and payload.is_favorite is not None
        else not bool(row["is_favorite"])
    )
    conn.execute(
        "UPDATE bookmarks SET is_favorite = ?, updated_at = ? WHERE id = ?",
        (int(bool(new_value)), _now(), bookmark_id),
    )
    return _row_to_bookmark(_fetch(conn, bookmark_id))


@app.get("/api/stats", response_model=Stats)
def stats(conn: sqlite3.Connection = Depends(get_conn)) -> Stats:
    total = conn.execute("SELECT COUNT(*) FROM bookmarks").fetchone()[0]
    favorites = conn.execute(
        "SELECT COUNT(*) FROM bookmarks WHERE is_favorite = 1"
    ).fetchone()[0]
    rows = conn.execute(
        "SELECT category, COUNT(*) AS count FROM bookmarks "
        "GROUP BY category ORDER BY category COLLATE NOCASE ASC"
    ).fetchall()
    return Stats(
        total=total,
        favorites=favorites,
        categories=[{"category": r["category"], "count": r["count"]} for r in rows],
    )
