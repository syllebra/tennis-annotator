"""ffprobe metadata, frame table and content fingerprint."""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

from .config import cache_path


class ProbeError(RuntimeError):
    pass


def _run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise ProbeError(proc.stderr.strip() or "ffprobe failed")
    return proc.stdout


def fingerprint(path: Path) -> tuple[int, str, str]:
    size = path.stat().st_size
    chunk = 8 * 1024 * 1024
    head = hashlib.sha256()
    with path.open("rb") as f:
        head.update(f.read(chunk))
    tail = hashlib.sha256()
    with path.open("rb") as f:
        if size > chunk:
            f.seek(size - chunk)
        tail.update(f.read(chunk))
    return size, head.hexdigest(), tail.hexdigest()


@dataclass
class FrameTable:
    width: int  # displayed width (after rotation)
    height: int  # displayed height (after rotation)
    rotation: int
    fpsNominal: float
    vfr: bool
    frameCount: int
    pts: list[float]
    keyframes: list[int]
    codec: str
    duration: float

    def to_json(self) -> dict:
        return asdict(self)


def _stream_info(path: Path) -> dict:
    raw = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,avg_frame_rate,codec_name,duration",
            "-show_streams",
            "-of",
            "json",
            str(path),
        ]
    )
    data = json.loads(raw)
    streams = data.get("streams") or []
    if not streams:
        raise ProbeError("no video stream")
    return streams[0]


def _rotation(stream: dict) -> int:
    for sd in stream.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                return int(round(float(sd["rotation"]))) % 360
            except (TypeError, ValueError):
                pass
    tags = stream.get("tags") or {}
    if "rotate" in tags:
        try:
            return int(float(tags["rotate"])) % 360
        except ValueError:
            pass
    return 0


def _frame_times(path: Path) -> tuple[list[float], list[int]]:
    raw = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=best_effort_timestamp_time,key_frame",
            "-of",
            "csv=p=0",
            str(path),
        ]
    )
    pts: list[float] = []
    keys: list[int] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(",")
        if len(parts) < 2:
            continue
        key_s, ts_s = parts[0], parts[1]
        try:
            ts = float(ts_s)
            key = int(float(key_s))
        except ValueError:
            continue
        pts.append(ts)
        keys.append(key)
    return pts, keys


def build_frame_table(path: Path, use_cache: bool = True) -> FrameTable:
    size, head, tail = fingerprint(path)
    cache_file = cache_path("frametables", f"{head[:16]}-{tail[:16]}-{size}.json")
    if use_cache and cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            return FrameTable(**data)
        except (json.JSONDecodeError, TypeError, OSError):
            pass

    stream = _stream_info(path)
    pts, keys = _frame_times(path)
    if not pts:
        raise ProbeError("no decodable frames")

    rotation = _rotation(stream)
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if rotation % 180 == 90:
        width, height = height, width

    rate_s = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1"
    try:
        num, den = rate_s.split("/")
        fps = float(num) / float(den) if float(den) else 0.0
    except (ValueError, ZeroDivisionError):
        fps = 0.0

    # VFR detection: spread of inter-frame deltas
    vfr = False
    if len(pts) > 3:
        deltas = [b - a for a, b in zip(pts, pts[1:]) if b > a]
        if deltas:
            mean = sum(deltas) / len(deltas)
            var = sum((d - mean) ** 2 for d in deltas) / len(deltas)
            sd = var**0.5
            vfr = mean > 0 and (sd / mean) > 0.02
            if not vfr and fps > 0:
                vfr = abs(mean - 1.0 / fps) > 0.05 * (1.0 / fps)

    duration = 0.0
    try:
        duration = float(stream.get("duration") or 0.0)
    except ValueError:
        duration = 0.0
    if duration <= 0:
        duration = pts[-1] + (pts[-1] - pts[-2] if len(pts) > 1 else 0.0)

    table = FrameTable(
        width=width,
        height=height,
        rotation=rotation,
        fpsNominal=fps,
        vfr=vfr,
        frameCount=len(pts),
        pts=pts,
        keyframes=[i for i, k in enumerate(keys) if k],
        codec=str(stream.get("codec_name") or ""),
        duration=duration,
    )
    try:
        cache_file.write_text(json.dumps(table.to_json()), encoding="utf-8")
    except OSError:
        pass
    return table
