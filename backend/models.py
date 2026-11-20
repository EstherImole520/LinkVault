"""Pydantic schemas and input validation for LinkVault."""

from __future__ import annotations

from datetime import datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

MAX_URL_LENGTH = 2048
ALLOWED_SCHEMES = {"http", "https"}


def validate_http_url(value: str) -> str:
    """Accept only absolute http(s) URLs with a hostname.

    Rejects javascript:, data:, file:, vbscript: and similar schemes so the
    stored value is always safe to render into an anchor href.
    """
    url = value.strip()
    if not url:
        raise ValueError("URL must not be empty")
    if len(url) > MAX_URL_LENGTH:
        raise ValueError(f"URL must be at most {MAX_URL_LENGTH} characters")
    if any(ord(char) < 32 or ord(char) == 127 for char in url):
        raise ValueError("URL must not contain control characters")
    if any(char.isspace() for char in url):
        raise ValueError("URL must not contain whitespace")

    try:
        parts = urlsplit(url)
    except ValueError as exc:  # malformed brackets / ports
        raise ValueError("URL is not valid") from exc

    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise ValueError("URL must start with http:// or https://")
    if not parts.netloc or not parts.hostname:
        raise ValueError("URL must include a hostname")
    if "." not in parts.hostname and parts.hostname != "localhost":
        raise ValueError("URL hostname is not valid")
    return url


def _clean_text(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field} must not be empty")
    return cleaned


class BookmarkCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    url: str
    description: str = Field(default="", max_length=1000)
    category: str = Field(default="Uncategorized", max_length=60)
    is_favorite: bool = False

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        return _clean_text(value, "Title")

    @field_validator("url")
    @classmethod
    def check_url(cls, value: str) -> str:
        return validate_http_url(value)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("category")
    @classmethod
    def clean_category(cls, value: str) -> str:
        cleaned = value.strip()
        return cleaned or "Uncategorized"


class BookmarkUpdate(BookmarkCreate):
    """PUT replaces the editable fields of a bookmark."""


class FavoriteUpdate(BaseModel):
    is_favorite: bool | None = None


class Bookmark(BaseModel):
    id: int
    title: str
    url: str
    description: str
    category: str
    is_favorite: bool
    created_at: datetime
    updated_at: datetime


class CategoryCount(BaseModel):
    category: str
    count: int


class Stats(BaseModel):
    total: int
    favorites: int
    categories: list[CategoryCount]


class Health(BaseModel):
    status: str
    version: str
