from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402


@pytest.fixture()
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "test-linkvault.db"
    monkeypatch.setenv("LINKVAULT_DB", str(path))
    return path


@pytest.fixture()
def client(db_path):
    with TestClient(app) as test_client:
        yield test_client


def make_bookmark(**overrides):
    payload = {
        "title": "Python Docs",
        "url": "https://docs.python.org/3/",
        "description": "Official Python documentation",
        "category": "Documentation",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def bookmark_payload():
    return make_bookmark


@pytest.fixture()
def sample_bookmarks(client):
    items = [
        make_bookmark(title="Zebra Guide", url="https://zebra.example.com", category="Reading"),
        make_bookmark(
            title="API Reference",
            url="https://api.example.com/docs",
            description="REST endpoints",
            category="Documentation",
        ),
        make_bookmark(
            title="alpha tutorial",
            url="https://alpha.example.com/learn",
            description="Beginner guide",
            category="Learning",
        ),
    ]
    created = []
    for item in items:
        response = client.post("/api/bookmarks", json=item)
        assert response.status_code == 201, response.text
        created.append(response.json())
    return created
