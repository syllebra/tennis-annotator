"""Sidecar persistence: validation, atomic writes, drift detection."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

from pydantic import ValidationError

from .library import sidecar_path
from .probe import FrameTable, fingerprint
from .schema import Document, VideoInfo, dump_document


class AnnotationError(RuntimeError):
    def __init__(self, message: str, *, conflict: bool = False) -> None:
        super().__init__(message)
        self.conflict = conflict


_LOCK = threading.Lock()
_MTIMES: dict[str, float] = {}


def _video_info(path: Path, table: FrameTable) -> VideoInfo:
    size, head, tail = fingerprint(path)
    return VideoInfo(
        fileName=path.name,
        sizeBytes=size,
        width=table.width,
        height=table.height,
        rotation=table.rotation,
        fpsNominal=table.fpsNominal,
        vfr=table.vfr,
        frameCount=table.frameCount,
        fingerprint={"headSha256": head, "tailSha256": tail},
    )


def current_video_info(path: Path, table: FrameTable) -> VideoInfo:
    return _video_info(path, table)


def comparison(doc: Document, video: VideoInfo) -> dict:
    """How does the stored video block compare to the file on disk?"""
    reasons = []
    if doc.video.frameCount != video.frameCount:
        reasons.append("frameCount")
    if doc.video.width != video.width or doc.video.height != video.height:
        reasons.append("dimensions")
    if doc.video.rotation != video.rotation:
        reasons.append("rotation")
    if (
        doc.video.fingerprint.headSha256 != video.fingerprint.headSha256
        or doc.video.fingerprint.tailSha256 != video.fingerprint.tailSha256
        or doc.video.sizeBytes != video.sizeBytes
    ):
        reasons.append("fingerprint")
    blocking = bool({"frameCount"} & set(reasons))
    return {"matches": not reasons, "reasons": reasons, "blocking": blocking}


def load(vid: str, path: Path, table: FrameTable) -> dict:
    sc = sidecar_path(path)
    video = _video_info(path, table)
    if not sc.exists():
        from .schema import new_document

        return {"source": "new", "document": dump_document(new_document(video)), "mismatch": None}
    try:
        raw = json.loads(sc.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise AnnotationError(f"unreadable sidecar: {exc}") from exc
    try:
        doc = Document.model_validate(raw)
    except ValidationError as exc:
        raise AnnotationError(f"invalid sidecar: {exc.errors()[:3]}") from exc
    with _LOCK:
        _MTIMES[vid] = sc.stat().st_mtime
    cmp = comparison(doc, video)
    return {
        "source": "sidecar",
        "document": dump_document(doc),
        "mismatch": None if cmp["matches"] else cmp,
        "videoInfo": video.model_dump(),
    }


def save(vid: str, path: Path, payload: dict, *, force: bool = False) -> dict:
    sc = sidecar_path(path)
    try:
        doc = Document.model_validate(payload)
    except ValidationError as exc:
        raise AnnotationError(f"refusing to save invalid document: {exc.errors()[:5]}")

    with _LOCK:
        known = _MTIMES.get(vid)
        if sc.exists():
            disk_mtime = sc.stat().st_mtime
            if not force and known is not None and abs(disk_mtime - known) > 1e-6:
                raise AnnotationError("sidecar changed on disk", conflict=True)
        data = json.dumps(dump_document(doc), indent=2, ensure_ascii=False, sort_keys=False)
        fd, tmp_name = tempfile.mkstemp(dir=str(sc.parent), prefix=".annot-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(data)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, sc)
        except OSError:
            Path(tmp_name).unlink(missing_ok=True)
            raise
        _MTIMES[vid] = sc.stat().st_mtime
    return {"saved": True, "mtime": _MTIMES[vid]}


def adopt(vid: str, path: Path, table: FrameTable, payload: dict) -> dict:
    """Accept a video file change by refreshing the video block (frame count must match)."""
    video = _video_info(path, table)
    payload = dict(payload)
    stored = payload.get("video") or {}
    if int(stored.get("frameCount") or -1) != video.frameCount:
        raise AnnotationError(
            "frame count changed: annotations cannot be re-anchored automatically", conflict=True
        )
    payload["video"] = video.model_dump()
    return save(vid, path, payload, force=True)


def reset(vid: str) -> None:
    with _LOCK:
        _MTIMES.pop(vid, None)
