import json

import pytest

from app import annotations, library, probe
from conftest import requires_ffmpeg
from test_schema import document


@requires_ffmpeg
def test_save_load_roundtrip(test_video, tmp_path) -> None:
    path, _, _, _ = test_video
    video = tmp_path / path.name
    video.write_bytes(path.read_bytes())
    table = probe.build_frame_table(video, use_cache=False)
    payload = document()
    payload["video"]["frameCount"] = table.frameCount

    saved = annotations.save("vid1", video, payload)
    assert saved["saved"]
    sidecar = library.sidecar_path(video)
    assert sidecar.exists()
    raw = json.loads(sidecar.read_text(encoding="utf-8"))
    assert raw["schema"] == "tennis-annotator/annotations@1"

    loaded = annotations.load("vid1", video, table)
    assert loaded["source"] == "sidecar"
    assert loaded["mismatch"]["matches"] is False  # fake fingerprint in payload
    assert "fingerprint" in loaded["mismatch"]["reasons"]
    assert loaded["mismatch"]["blocking"] is False


@requires_ffmpeg
def test_external_edit_detected(test_video, tmp_path) -> None:
    path, _, _, _ = test_video
    video = tmp_path / path.name
    video.write_bytes(path.read_bytes())
    table = probe.build_frame_table(video, use_cache=False)
    payload = document()
    payload["video"]["frameCount"] = table.frameCount
    annotations.save("vid2", video, payload)

    sidecar = library.sidecar_path(video)
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    data["state"]["lastFrame"] = 42
    sidecar.write_text(json.dumps(data), encoding="utf-8")

    with pytest.raises(annotations.AnnotationError) as exc:
        annotations.save("vid2", video, payload)
    assert exc.value.conflict is True

    annotations.save("vid2", video, payload, force=True)


@requires_ffmpeg
def test_invalid_document_refused(test_video, tmp_path) -> None:
    path, _, _, _ = test_video
    video = tmp_path / path.name
    video.write_bytes(path.read_bytes())
    payload = document()
    payload["sequences"][0]["tStart"] = -5
    with pytest.raises(annotations.AnnotationError):
        annotations.save("vid3", video, payload)


@requires_ffmpeg
def test_adopt_updates_video_block(test_video, tmp_path) -> None:
    path, _, _, _ = test_video
    video = tmp_path / path.name
    video.write_bytes(path.read_bytes())
    table = probe.build_frame_table(video, use_cache=False)
    payload = document()
    payload["video"]["frameCount"] = table.frameCount
    result = annotations.adopt("vid4", video, table, payload)
    assert result["saved"]
    raw = json.loads(library.sidecar_path(video).read_text(encoding="utf-8"))
    assert raw["video"]["frameCount"] == table.frameCount
    assert raw["video"]["width"] == table.width
