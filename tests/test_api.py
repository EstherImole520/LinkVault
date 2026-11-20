from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.database import init_db


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_create_and_get_bookmark(client):
    payload = {
        "title": "MDN",
        "url": "https://developer.mozilla.org",
        "description": "Web platform docs",
        "category": "Documentation",
    }
    created = client.post("/api/bookmarks", json=payload)
    assert created.status_code == 201
    body = created.json()
    assert body["id"] > 0
    assert body["title"] == "MDN"
    assert body["is_favorite"] is False
    assert body["created_at"] and body["updated_at"]

    fetched = client.get(f"/api/bookmarks/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == body


def test_create_defaults_description_category(client):
    response = client.post(
        "/api/bookmarks", json={"title": "Example", "url": "https://example.com"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["description"] == ""
    assert body["category"] == "Uncategorized"


@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "ftp://example.com/file",
        "vbscript:msgbox(1)",
        "example.com",
        "https://",
        "https://exa mple.com",
        "",
    ],
)
def test_rejects_unsafe_or_invalid_urls(client, bad_url):
    response = client.post(
        "/api/bookmarks", json={"title": "Bad", "url": bad_url}
    )
    assert response.status_code == 422
    body = response.json()
    assert "error" in body
    assert body["error"]["message"]


def test_accepts_http_and_https(client):
    for url in ("http://example.com", "https://example.com/path?q=1#frag"):
        response = client.post("/api/bookmarks", json={"title": url, "url": url})
        assert response.status_code == 201, response.text


def test_validation_errors_are_consistent(client):
    response = client.post("/api/bookmarks", json={"title": "   ", "url": "https://a.com"})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["message"] == "Title must not be empty"
    assert body["error"]["details"][0]["field"] == "title"


def test_update_bookmark(client):
    created = client.post(
        "/api/bookmarks", json={"title": "Old", "url": "https://old.example.com"}
    ).json()
    updated = client.put(
        f"/api/bookmarks/{created['id']}",
        json={
            "title": "New title",
            "url": "https://new.example.com",
            "description": "Updated",
            "category": "Work",
            "is_favorite": True,
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["title"] == "New title"
    assert body["url"] == "https://new.example.com"
    assert body["is_favorite"] is True
    assert body["created_at"] == created["created_at"]


def test_update_rejects_bad_url_and_missing_id(client):
    created = client.post(
        "/api/bookmarks", json={"title": "Old", "url": "https://old.example.com"}
    ).json()
    bad = client.put(
        f"/api/bookmarks/{created['id']}",
        json={"title": "X", "url": "javascript:alert(1)"},
    )
    assert bad.status_code == 422
    missing = client.put(
        "/api/bookmarks/9999", json={"title": "X", "url": "https://x.example.com"}
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["message"] == "Bookmark not found"


def test_get_missing_bookmark(client):
    response = client.get("/api/bookmarks/12345")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Bookmark not found"


def test_delete_bookmark(client):
    created = client.post(
        "/api/bookmarks", json={"title": "Temp", "url": "https://temp.example.com"}
    ).json()
    response = client.delete(f"/api/bookmarks/{created['id']}")
    assert response.status_code == 204
    assert client.get(f"/api/bookmarks/{created['id']}").status_code == 404
    assert client.delete(f"/api/bookmarks/{created['id']}").status_code == 404


def test_favorite_toggle_and_explicit_set(client):
    created = client.post(
        "/api/bookmarks", json={"title": "Fav", "url": "https://fav.example.com"}
    ).json()
    toggled = client.patch(f"/api/bookmarks/{created['id']}/favorite")
    assert toggled.status_code == 200
    assert toggled.json()["is_favorite"] is True
    toggled_again = client.patch(f"/api/bookmarks/{created['id']}/favorite")
    assert toggled_again.json()["is_favorite"] is False
    explicit = client.patch(
        f"/api/bookmarks/{created['id']}/favorite", json={"is_favorite": True}
    )
    assert explicit.json()["is_favorite"] is True
    stats = client.get("/api/stats").json()
    assert stats["favorites"] == 1


def test_search_title_url_description(client, sample_bookmarks):
    for query, expected_title in [
        ("zebra", "Zebra Guide"),
        ("api.example", "API Reference"),
        ("beginner", "alpha tutorial"),
    ]:
        response = client.get("/api/bookmarks", params={"q": query})
        assert response.status_code == 200
        titles = [item["title"] for item in response.json()]
        assert titles == [expected_title]


def test_search_is_case_insensitive(client, sample_bookmarks):
    titles = [item["title"] for item in client.get("/api/bookmarks", params={"q": "ZEBRA"}).json()]
    assert titles == ["Zebra Guide"]


def test_search_treats_wildcards_literally(client, sample_bookmarks):
    assert client.get("/api/bookmarks", params={"q": "%"}).json() == []
    assert client.get("/api/bookmarks", params={"q": "_"}).json() == []


def test_search_does_not_allow_sql_injection(client, sample_bookmarks):
    response = client.get(
        "/api/bookmarks", params={"q": "'; DROP TABLE bookmarks; --"}
    )
    assert response.status_code == 200
    assert response.json() == []
    assert len(client.get("/api/bookmarks").json()) == 3


def test_favorite_query_filter(client, sample_bookmarks):
    client.patch(f"/api/bookmarks/{sample_bookmarks[1]['id']}/favorite")
    favorites = client.get("/api/bookmarks", params={"favorite": "true"}).json()
    assert [item["title"] for item in favorites] == ["API Reference"]
    others = client.get("/api/bookmarks", params={"favorite": "false"}).json()
    assert len(others) == 2


def test_category_filter(client, sample_bookmarks):
    response = client.get("/api/bookmarks", params={"category": "documentation"})
    assert [item["title"] for item in response.json()] == ["API Reference"]
    assert client.get("/api/bookmarks", params={"category": "Nope"}).json() == []


def test_combined_search_and_category(client, sample_bookmarks):
    response = client.get(
        "/api/bookmarks", params={"q": "guide", "category": "Reading"}
    )
    assert [item["title"] for item in response.json()] == ["Zebra Guide"]


def test_sort_newest_oldest_alpha(client, sample_bookmarks):
    newest = [item["title"] for item in client.get("/api/bookmarks", params={"sort": "newest"}).json()]
    oldest = [item["title"] for item in client.get("/api/bookmarks", params={"sort": "oldest"}).json()]
    alpha = [item["title"] for item in client.get("/api/bookmarks", params={"sort": "alpha"}).json()]
    assert newest == list(reversed(oldest))
    assert alpha == ["alpha tutorial", "API Reference", "Zebra Guide"]
    assert client.get("/api/bookmarks", params={"sort": "bogus"}).status_code == 422


def test_stats(client, sample_bookmarks):
    client.patch(f"/api/bookmarks/{sample_bookmarks[0]['id']}/favorite")
    stats = client.get("/api/stats").json()
    assert stats["total"] == 3
    assert stats["favorites"] == 1
    assert stats["categories"] == [
        {"category": "Documentation", "count": 1},
        {"category": "Learning", "count": 1},
        {"category": "Reading", "count": 1},
    ]


def test_stats_empty(client):
    assert client.get("/api/stats").json() == {"total": 0, "favorites": 0, "categories": []}


def test_persistence_across_app_restarts(client, db_path):
    client.post(
        "/api/bookmarks",
        json={"title": "Persist", "url": "https://persist.example.com"},
    )
    assert db_path.exists()

    init_db(db_path)  # re-running initialization must not destroy data
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute("SELECT title FROM bookmarks").fetchall()
    finally:
        conn.close()
    assert rows == [("Persist",)]

    from fastapi.testclient import TestClient

    from backend.main import app

    with TestClient(app) as restarted:
        assert [item["title"] for item in restarted.get("/api/bookmarks").json()] == [
            "Persist"
        ]


def test_concurrent_requests_do_not_share_thread_errors(client):
    """FastAPI runs sync dependencies and endpoints on worker threads."""

    def call(path: str):
        return client.get(path)

    paths = ["/api/stats", "/api/bookmarks"] * 8
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(call, paths))

    assert all(response.status_code == 200 for response in responses)


def test_cors_allows_only_configured_origins(client):
    allowed = client.get(
        "/api/health", headers={"Origin": "http://localhost:5173"}
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    blocked = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert blocked.headers.get("access-control-allow-origin") is None
