import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import app
from conftest import requires_ffmpeg
from test_schema import document

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        response = test_client.post("/api/auth/login", json={"token": "test-token"})
        assert response.status_code == 200
        yield test_client


@requires_ffmpeg
def test_library_and_frames(client, test_video, tmp_path) -> None:
    path, _, width, height = test_video
    root = tmp_path / "videos"
    root.mkdir()
    shutil.copy(path, root / "clip.mp4")

    assert client.put("/api/config", json={"videoRoot": str(root)}).status_code == 200
    listing = client.get("/api/videos").json()
    assert listing["exists"] is True
    assert [v["name"] for v in listing["videos"]] == ["clip.mp4"]
    vid = listing["videos"][0]["id"]
    assert listing["videos"][0]["status"] == "new"

    meta = client.get(f"/api/videos/{vid}/meta").json()
    assert meta["table"]["frameCount"] == 60
    assert (meta["table"]["width"], meta["table"]["height"]) == (width, height)

    frame = client.get(f"/api/videos/{vid}/frame", params={"n": 5, "w": 80})
    assert frame.status_code == 200
    assert frame.headers["content-type"] == "image/jpeg"

    loupe = client.get(f"/api/videos/{vid}/loupe", params={"n": 5, "x": 80, "y": 60})
    assert loupe.status_code == 200
    assert loupe.headers["content-type"] == "image/png"


@requires_ffmpeg
def test_annotation_roundtrip(client, test_video, tmp_path) -> None:
    path, _, _, _ = test_video
    root = tmp_path / "videos2"
    root.mkdir()
    shutil.copy(path, root / "clip.mp4")
    client.put("/api/config", json={"videoRoot": str(root)})
    vid = client.get("/api/videos").json()["videos"][0]["id"]

    loaded = client.get(f"/api/videos/{vid}/annotations").json()
    assert loaded["source"] == "new"
    doc = loaded["document"]
    assert doc["sequences"] == []

    payload = document()
    payload["video"] = loaded["document"]["video"]
    payload["video"]["frameCount"] = 60
    assert client.put(f"/api/videos/{vid}/annotations", json=payload).status_code == 200

    again = client.get(f"/api/videos/{vid}/annotations").json()
    assert again["source"] == "sidecar"
    assert len(again["document"]["sequences"]) == 1

    status = client.get("/api/videos").json()["videos"][0]["status"]
    assert status == "progress"


def test_schema_endpoint(client) -> None:
    body = client.get("/api/schema").json()
    assert body["title"] == "Document"
    assert "sequences" in body["properties"]


def test_health(client) -> None:
    assert client.get("/api/health").json()["ok"] is True
