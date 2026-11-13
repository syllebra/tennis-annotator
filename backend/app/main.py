"""FastAPI application: library, frame server, annotations."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import shutil
import tempfile
import threading
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from . import annotations, library, probe
from .auth import COOKIE_NAME, auth, login_page
from .config import CACHE_DIR, load_config, save_config
from .detectors import court as court_detector
from .detectors import detector_discovery
from .detectors import fit as detector_fit
from .detectors.client import DetectorError
from .detectors.client import client as detector_client
from .detectors.fit import Detection
from .frames import FrameDecoder, FrameError, extract_range
from .proxy import proxy_manager
from .schema import Document

app = FastAPI(title="Tennis Annotator", version="0.1.0")

# Liveness probe stays public: the launcher uses it to decide whether an
# instance is already running, and it exposes no annotation data.
PUBLIC_API = {"/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/logout"}


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    """Token gate: the SPA, its assets and every API route require a session."""
    path = request.url.path
    token = request.query_params.get("token")
    if token is not None and not path.startswith("/api/"):
        if auth.check_token(token):
            response = RedirectResponse(url=path or "/", status_code=303)
            auth.attach(response)
            return response
        return HTMLResponse(login_page("Token invalide."), status_code=401)
    if path in PUBLIC_API:
        return await call_next(request)
    if auth.valid_session(request.cookies.get(COOKIE_NAME)):
        return await call_next(request)
    if path.startswith("/api/"):
        return JSONResponse({"detail": "authentification requise"}, status_code=401)
    if path in ("/", "/index.html"):
        return HTMLResponse(login_page())
    return Response(status_code=401)


@app.on_event("startup")
def _announce_auth() -> None:
    if auth.created:
        print(f"[auth] nouveau token d'accès : {auth.token}")
        print(f"[auth] il est enregistré dans {auth.path}")
    else:
        print(f"[auth] interface protégée — token dans {auth.path}")


@app.get("/api/auth/status")
def auth_status(request: Request) -> dict:
    return {
        "required": auth.required,
        "authenticated": auth.valid_session(request.cookies.get(COOKIE_NAME)),
    }


@app.post("/api/auth/login")
async def auth_login(request: Request):
    content_type = request.headers.get("content-type", "")
    token: str | None = None
    wants_html = True
    if "application/json" in content_type:
        wants_html = "text/html" in request.headers.get("accept", "")
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001 - malformed body means "no token"
            body = {}
        if isinstance(body, dict):
            token = body.get("token")
    else:
        form = await request.form()
        value = form.get("token")
        token = str(value) if value is not None else None

    if not auth.check_token(token):
        await asyncio.sleep(0.2)
        if wants_html:
            return HTMLResponse(login_page("Token invalide."), status_code=401)
        raise HTTPException(401, "token invalide")

    if wants_html:
        response: Response = RedirectResponse(url="/", status_code=303)
    else:
        response = JSONResponse({"ok": True})
    auth.attach(response)
    return response


@app.post("/api/auth/logout")
def auth_logout() -> Response:
    response = JSONResponse({"ok": True})
    auth.clear(response)
    return response

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


class DetectorSettings(BaseModel):
    analyzerPath: str | None = None
    ballThreshold: float | None = None
    tolerancePx: float | None = None
    maxPoints: int | None = None


class ConfigPayload(BaseModel):
    videoRoot: str | None = None
    proxy: bool | None = None
    detectors: DetectorSettings | None = None


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
    if payload.detectors is not None:
        detectors = dict(cfg.get("detectors") or {})
        for key, value in payload.detectors.model_dump(exclude_none=True).items():
            detectors[key] = value
        cfg["detectors"] = detectors
    save_config(cfg)
    detector_client.stop()
    detector_discovery.status(cfg, refresh=True)
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


# --- optional ML detectors ------------------------------------------------


class AutoCourtPayload(BaseModel):
    frame: int


class TrajectoryAnchor(BaseModel):
    t: int
    x: float
    y: float


class FrameRange(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    start: int = Field(alias="from")
    end: int = Field(alias="to")


class AutoBallPayload(BaseModel):
    trajectoryId: str
    anchorA: TrajectoryAnchor
    anchorB: TrajectoryAnchor
    tolerancePx: float | None = None
    maxPoints: int | None = None
    threshold: float | None = None
    occlusions: list[FrameRange] = Field(default_factory=list)


_BALL_CACHE: dict[tuple, list[dict]] = {}
_BALL_CACHE_LIMIT = 24


def _detector_status(refresh: bool = False) -> dict:
    config = load_config()
    status = detector_discovery.status(config, refresh=refresh)
    status["worker"] = detector_client.status()
    status["settings"] = config.get("detectors") or {}
    return status


def _configure_detectors(refresh: bool = False) -> dict:
    config = load_config()
    status = detector_discovery.status(config, refresh=refresh)
    if not status["available"]:
        raise HTTPException(409, f"détecteurs indisponibles : {status['message']}")
    root = Path(status["path"])
    models = status["models"]
    resolved = detector_discovery.interpreter(root)
    if resolved is None:
        raise HTTPException(409, "aucun interpréteur Python 3.11 avec torch/TensorRT")
    command, env, _note = resolved
    detector_client.configure(root, Path(models["court"]), Path(models["ball"]), command, env)
    return status


@app.get("/api/detectors")
def detectors(refresh: bool = False) -> dict:
    return _detector_status(refresh=refresh)


@app.post("/api/detectors/warmup")
def detectors_warmup() -> dict:
    _configure_detectors()

    def start() -> None:
        try:
            detector_client.ensure_started()
        except DetectorError:
            pass

    threading.Thread(target=start, daemon=True, name="detectors-warmup").start()
    return _detector_status()


@app.post("/api/videos/{vid}/auto/court")
def auto_court(vid: str, payload: AutoCourtPayload) -> dict:
    cached = _open(vid)
    _configure_detectors()
    frame = payload.frame
    if not (0 <= frame < cached.table.frameCount):
        raise HTTPException(400, "frame hors de la vidéo")
    try:
        image = cached.decoder.frame(frame)
    except FrameError as exc:
        raise HTTPException(500, str(exc)) from exc
    try:
        reply = detector_client.request(
            {"command": "court", "image": base64.b64encode(image).decode("ascii")}, timeout=180
        )
    except DetectorError as exc:
        raise HTTPException(502, f"détecteur de court : {exc}") from exc
    width = int(reply.get("width") or cached.table.width)
    height = int(reply.get("height") or cached.table.height)
    keypoints = reply.get("keypoints") or []
    try:
        corners = court_detector.landmarks_from_keypoints(keypoints, width, height)
        landmarks = court_detector.all_landmarks(keypoints, width, height) or corners
        quality = court_detector.quality(corners, keypoints, width, height)
    except (ValueError, np.linalg.LinAlgError) as exc:
        raise HTTPException(422, f"court inutilisable : {exc}") from exc
    return {
        "frame": frame,
        "width": width,
        "height": height,
        "landmarks": {
            key: {"x": round(value[0], 6), "y": round(value[1], 6)}
            for key, value in landmarks.items()
        },
        "quality": quality,
        "keypoints": keypoints,
    }


def _detect_segment(
    cached: _Cached, payload: AutoBallPayload, threshold: float
) -> list[dict]:
    table = cached.table
    start = payload.anchorA.t + 1
    end = payload.anchorB.t - 1
    count = end - start + 1
    if count <= 0:
        raise HTTPException(400, "aucune frame entre les deux ancres")
    if count > 900:
        raise HTTPException(400, "segment trop long : 900 frames maximum")
    skipped: set[int] = set()
    for occlusion in payload.occlusions:
        skipped.update(range(occlusion.start, occlusion.end + 1))

    tmp = Path(tempfile.mkdtemp(prefix="auto-ball-", dir=CACHE_DIR))
    try:
        try:
            files, det_width, det_height = extract_range(
                cached.path, table, start, count, tmp, width=min(960, table.width)
            )
        except FrameError as exc:
            raise HTTPException(500, f"extraction des frames impossible : {exc}") from exc

        frames = []
        for offset, file in enumerate(files):
            frame = start + offset
            if frame in skipped:
                continue
            frames.append(
                {
                    "frame": frame,
                    "image": base64.b64encode(file.read_bytes()).decode("ascii"),
                }
            )
        detections: list[dict] = []
        chunk = 48
        for index in range(0, len(frames), chunk):
            try:
                reply = detector_client.request(
                    {
                        "command": "ball",
                        "threshold": threshold,
                        "frames": frames[index : index + chunk],
                    },
                    timeout=240,
                )
            except DetectorError as exc:
                raise HTTPException(502, f"détecteur de balle : {exc}") from exc
            for item in reply.get("detections") or []:
                if not item.get("found"):
                    continue
                detections.append(
                    {
                        "frame": int(item["frame"]),
                        "x": float(item["x"]) / det_width,
                        "y": float(item["y"]) / det_height,
                        "score": float(item.get("score") or 0.0),
                    }
                )
        detections.sort(key=lambda item: item["frame"])
        return detections
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.post("/api/videos/{vid}/auto/ball")
def auto_ball(vid: str, payload: AutoBallPayload) -> dict:
    cached = _open(vid)
    config = load_config()
    settings = config.get("detectors") or {}
    _configure_detectors()

    threshold = float(
        payload.threshold if payload.threshold is not None else settings.get("ballThreshold", 0.35)
    )
    tolerance = float(
        payload.tolerancePx if payload.tolerancePx is not None else settings.get("tolerancePx", 2.0)
    )
    max_points = int(
        payload.maxPoints if payload.maxPoints is not None else settings.get("maxPoints", 8)
    )

    first, last = payload.anchorA, payload.anchorB
    if not (0 <= first.t < last.t < cached.table.frameCount):
        raise HTTPException(400, "les ancres doivent être ordonnées et dans la vidéo")

    key = (
        vid,
        payload.trajectoryId,
        first.t,
        round(first.x, 6),
        round(first.y, 6),
        last.t,
        round(last.x, 6),
        round(last.y, 6),
        round(threshold, 3),
    )
    stored = _BALL_CACHE.get(key)
    if stored is None:
        stored = _detect_segment(cached, payload, threshold)
        _BALL_CACHE[key] = stored
        while len(_BALL_CACHE) > _BALL_CACHE_LIMIT:
            _BALL_CACHE.pop(next(iter(_BALL_CACHE)))
    if not stored:
        raise HTTPException(422, "aucune détection de balle sur ce segment")

    detections = [
        Detection(item["frame"], item["x"], item["y"], item["score"]) for item in stored
    ]
    try:
        result = detector_fit.fit_segment(
            (first.t, first.x, first.y, "anchor"),
            (last.t, last.x, last.y, "anchor"),
            detections,
            width=cached.table.width,
            height=cached.table.height,
            tolerance_px=tolerance,
            max_points=max_points,
        )
    except detector_fit.FitError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "points": result.points,
        "stats": result.stats,
        "detections": len(detections),
    }


@app.get("/api/schema")
def schema() -> dict:
    return Document.model_json_schema(by_alias=True)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "app": "tennis-annotator"}


if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")


@app.exception_handler(probe.ProbeError)
def _probe_error(_: Request, exc: probe.ProbeError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})
