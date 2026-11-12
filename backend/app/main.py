"""FastAPI application: library, frame server, annotations."""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import annotations, library, probe
from .config import CACHE_DIR, load_config, save_config
from .frames import FrameDecoder, FrameError
from .proxy import proxy_manager
from .schema import Document

app = FastAPI(title="Tennis Annotator", version="0.1.0")

_ROOT = Path(__file__).resolve().parents[2]
_DIST = _ROOT / "frontend" / "dist"


class _Cached:
    __slots__ = ("path", "table", "decoder")

    def __init__(self, path: Path, table: probe.FrameTable, decoder: FrameDecoder) -> None:
        self.path = path
        self.table = table
        self.decoder = decoder


_CACHE: dict[str, _Cached] = {}
_CACHE_LOCK = threading.Lock()


def _key(path: Path, table: probe.FrameTable) -> str:
    stat = path.stat()
    return f"{path}|{table.frameCount}|{stat.st_size}|{int(stat.st_mtime)}"


def _proxy_key(path: Path, table: probe.FrameTable) -> str:
    return hashlib.sha1(_key(path, table).encode("utf-8")).hexdigest()[:24]


def _open(vid: str) -> _Cached:
    path = library.resolve(vid)
    if path is None:
        raise HTTPException(404, "video not found")
    table = probe.build_frame_table(path)
    key = _key(path, table)
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached is None:
            if len(_CACHE) >= 2:
                _, old = _CACHE.popitem()
                old.decoder.close()
            cached = _Cached(path, table, FrameDecoder(path, table))
            _CACHE[key] = cached
    return cached


# --- config ---------------------------------------------------------------


class ConfigPayload(BaseModel):
    videoRoot: str | None = None
    proxy: bool | None = None


@app.get("/api/config")
def get_config() -> dict:
    return load_config()


@app.put("/api/config")
def put_config(payload: ConfigPayload) -> dict:
    cfg = load_config()
    if payload.videoRoot is not None:
        root = Path(payload.videoRoot).expanduser()
        if not root.is_dir():
            raise HTTPException(400, f"not a directory: {root}")
        cfg["videoRoot"] = str(root)
    if payload.proxy is not None:
        cfg["proxy"] = payload.proxy
    save_config(cfg)
    return cfg


@app.get("/api/browse")
def browse(path: str | None = None) -> dict:
    base = Path(path).expanduser() if path else Path.home()
    if not base.is_dir():
        raise HTTPException(400, f"not a directory: {base}")
    dirs = []
    for entry in sorted(base.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            dirs.append({"name": entry.name, "path": str(entry)})
        elif entry.is_file() and library.is_video(entry):
            dirs.append({"name": entry.name, "path": str(entry), "video": True})
    return {"path": str(base), "parent": str(base.parent), "entries": dirs}


# --- library --------------------------------------------------------------


@app.get("/api/videos")
def list_videos() -> dict:
    return library.list_videos()


@app.get("/api/videos/{vid}/meta")
def video_meta(vid: str) -> dict:
    cached = _open(vid)
    table = cached.table
    needs_proxy = proxy_manager.needs_proxy(table)
    return {
        "id": vid,
        "fileName": cached.path.name,
        "dir": str(cached.path.parent),
        "table": table.to_json(),
        "needsProxy": needs_proxy,
        "proxy": proxy_manager.status(_proxy_key(cached.path, table)),
        "anchors": {
            "keyframes": [table.pts[i] for i in table.keyframes[:64]],
            "keyframeFrames": table.keyframes[:64],
        },
    }


@app.post("/api/videos/{vid}/prepare")
def prepare(vid: str) -> dict:
    cached = _open(vid)
    key = _proxy_key(cached.path, table := cached.table)
    if not proxy_manager.needs_proxy(table):
        return {"state": "not-needed", "progress": 1.0, "error": None}
    proxy_manager.start(key, cached.path, table)
    return proxy_manager.status(key)


@app.get("/api/videos/{vid}/proxy")
def proxy_status(vid: str) -> dict:
    cached = _open(vid)
    key = _proxy_key(cached.path, cached.table)
    if not proxy_manager.needs_proxy(cached.table):
        return {"state": "not-needed", "progress": 1.0, "error": None}
    return proxy_manager.status(key)


@app.get("/api/videos/{vid}/media")
def media(vid: str):
    cached = _open(vid)
    key = _proxy_key(cached.path, cached.table)
    if proxy_manager.needs_proxy(cached.table):
        proxy_file = proxy_manager.proxy_path(key)
        if proxy_file.exists():
            return FileResponse(proxy_file, media_type="video/mp4")
    return FileResponse(cached.path, media_type=None)


@app.get("/api/videos/{vid}/frame")
def frame(vid: str, n: int = Query(..., ge=0), w: int | None = Query(None, ge=64, le=4096)):
    cached = _open(vid)
    try:
        data = cached.decoder.frame(n, w)
    except FrameError as exc:
        raise HTTPException(500, str(exc)) from exc
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/videos/{vid}/loupe")
def loupe(
    vid: str,
    n: int = Query(..., ge=0),
    x: float = Query(...),
    y: float = Query(...),
    half: int = Query(120, ge=8, le=800),
):
    cached = _open(vid)
    try:
        data = cached.decoder.crop(n, x, y, half)
    except FrameError as exc:
        raise HTTPException(500, str(exc)) from exc
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# --- annotations ----------------------------------------------------------


@app.get("/api/videos/{vid}/annotations")
def get_annotations(vid: str) -> dict:
    cached = _open(vid)
    try:
        return annotations.load(vid, cached.path, cached.table)
    except annotations.AnnotationError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.put("/api/videos/{vid}/annotations")
async def put_annotations(vid: str, request: Request, force: bool = False) -> dict:
    cached = _open(vid)
    payload = await request.json()
    try:
        return annotations.save(vid, cached.path, payload, force=force)
    except annotations.AnnotationError as exc:
        raise HTTPException(409 if exc.conflict else 422, str(exc)) from exc


@app.post("/api/videos/{vid}/adopt")
async def adopt_video(vid: str, request: Request) -> dict:
    cached = _open(vid)
    payload = await request.json()
    try:
        return annotations.adopt(vid, cached.path, cached.table, payload)
    except annotations.AnnotationError as exc:
        raise HTTPException(409 if exc.conflict else 422, str(exc)) from exc


@app.get("/api/schema")
def schema() -> dict:
    return Document.model_json_schema(by_alias=True)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": "tennis-annotator", "cache": str(CACHE_DIR)}


if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")


@app.exception_handler(probe.ProbeError)
def _probe_error(_: Request, exc: probe.ProbeError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})
