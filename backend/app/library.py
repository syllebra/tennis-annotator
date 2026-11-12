"""Video library: scan a root folder, stable ids, annotation status."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .config import VIDEO_EXTENSIONS, load_config


def video_id(relative: str) -> str:
    return hashlib.sha1(relative.encode("utf-8")).hexdigest()[:16]


def sidecar_path(video: Path) -> Path:
    return video.with_name(video.name + ".annotations.json")


def root() -> Path:
    return Path(load_config()["videoRoot"]).expanduser()


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS and not path.name.endswith(".annotations.json")


def resolve(vid: str) -> Path | None:
    base = root()
    for entry in scan_paths(base):
        if video_id(entry[0]) == vid:
            return entry[1]
    return None


def scan_paths(base: Path) -> list[tuple[str, Path]]:
    """(relative posix path, absolute path) for every video under base."""
    if not base.is_dir():
        return []
    out: list[tuple[str, Path]] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file() or not is_video(path):
            continue
        # do not descend into the proxy/cache dirs (they live outside the root anyway)
        try:
            rel = path.relative_to(base).as_posix()
        except ValueError:
            continue
        out.append((rel, path))
    return out


def _sidecar_state(video: Path) -> tuple[str, bool, int]:
    sc = sidecar_path(video)
    if not sc.exists():
        return "new", False, 0
    try:
        data = json.loads(sc.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return "corrupt", False, 0
    state = data.get("state") or {}
    completed = bool(state.get("completed"))
    last = int(state.get("lastFrame") or 0)
    if completed:
        return "done", True, last
    has_content = any(
        (seq.get("court", {}).get("keyframes") or []) or (seq.get("trajectories") or [])
        for seq in data.get("sequences") or []
    )
    return ("progress" if has_content or last > 0 else "new"), completed, last


def list_videos() -> dict:
    base = root()
    entries = []
    for rel, path in scan_paths(base):
        status, completed, last = _sidecar_state(path)
        entries.append(
            {
                "id": video_id(rel),
                "relPath": rel,
                "name": path.name,
                "sizeBytes": path.stat().st_size,
                "status": status,
                "completed": completed,
                "lastFrame": last,
            }
        )
    return {"root": str(base), "exists": base.is_dir(), "videos": entries}
