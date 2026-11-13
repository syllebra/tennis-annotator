import os
import sys
from pathlib import Path

import pytest

import app.detectors.discovery as discovery_module
from app.detectors.client import DetectorClient, DetectorError

FAKE_WORKER = """
import json, sys, time

def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\\n")
    sys.stdout.flush()

emit({"event": "ready"})
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    request = json.loads(line)
    command = request.get("command")
    if command == "shutdown":
        emit({"id": request["id"], "ok": True})
        break
    if command == "fail":
        emit({"id": request["id"], "ok": False, "error": "boom"})
        continue
    if command == "slow":
        time.sleep(5)
        continue
    emit({"id": request["id"], "ok": True, "echo": command})
"""


def make_client(tmp_path: Path) -> DetectorClient:
    script = tmp_path / "fake_worker.py"
    script.write_text(FAKE_WORKER, encoding="utf-8")
    client = DetectorClient(worker_path=script)
    client.configure(
        root=tmp_path,
        court_model=tmp_path / "court.trt",
        ball_model=tmp_path / "ball.trt",
        command=[sys.executable],
        env=os.environ.copy(),
    )
    return client


def test_request_starts_worker_and_round_trips(tmp_path) -> None:
    client = make_client(tmp_path)
    try:
        assert client.status()["state"] == "idle"
        reply = client.request({"command": "ping"})
        assert reply["ok"] is True and reply["echo"] == "ping"
        assert client.status()["state"] == "ready"
    finally:
        client.stop()


def test_worker_error_is_raised(tmp_path) -> None:
    client = make_client(tmp_path)
    try:
        with pytest.raises(DetectorError):
            client.request({"command": "fail"})
        # the worker stays usable after a request-level failure
        assert client.request({"command": "ping"})["ok"] is True
    finally:
        client.stop()


def test_timeout_kills_the_worker(tmp_path) -> None:
    client = make_client(tmp_path)
    try:
        client.ensure_started()
        with pytest.raises(DetectorError):
            client.request({"command": "slow"}, timeout=0.3)
        assert client.status()["state"] == "error"
    finally:
        client.stop()


def test_stop_and_restart(tmp_path) -> None:
    client = make_client(tmp_path)
    client.request({"command": "ping"})
    client.stop()
    assert client.request({"command": "ping"})["ok"] is True
    client.stop()


def test_reconfigure_restarts(tmp_path) -> None:
    client = make_client(tmp_path)
    try:
        client.request({"command": "ping"})
        client.configure(
            root=tmp_path,
            court_model=tmp_path / "court2.trt",
            ball_model=tmp_path / "ball.trt",
            command=[sys.executable],
            env=os.environ.copy(),
        )
        assert client.request({"command": "ping"})["ok"] is True
    finally:
        client.stop()


def test_discovery_rejects_invalid_path(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("TENNIS_ANALYZER_DIR", str(tmp_path / "missing"))
    root, reason = discovery_module.resolve_root({"detectors": {"analyzerPath": ""}})
    assert root is None
    assert "env" in reason


def test_discovery_accepts_valid_path(monkeypatch, tmp_path) -> None:
    target = tmp_path / "analyzer"
    (target / "perception").mkdir(parents=True)
    for name in discovery_module.CODE_FILES:
        (target / name).write_text("", encoding="utf-8")
    monkeypatch.setenv("TENNIS_ANALYZER_DIR", str(target))
    root, source = discovery_module.resolve_root({"detectors": {"analyzerPath": ""}})
    assert root == target and source == "env"


def test_model_paths(tmp_path) -> None:
    models = tmp_path / "models"
    models.mkdir()
    (models / "keypoint_detector.trt").write_bytes(b"x")
    (models / "rtdetrv2_r50vd_6x_coco_ema.trt").write_bytes(b"x")
    found = discovery_module.model_paths(tmp_path)
    assert found["court"] is not None and found["court"].name == "keypoint_detector.trt"
    assert found["ball"] is not None and "rtdetr" in found["ball"].name
