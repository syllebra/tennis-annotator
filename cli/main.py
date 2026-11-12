"""Command line tools: bake, check, render, serve.

Run as:  uv run python -m cli.main <command>
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import numpy as np  # noqa: E402
import typer  # noqa: E402

from app import derive, geometry, library, probe  # noqa: E402
from app.schema import Document  # noqa: E402

app = typer.Typer(no_args_is_help=True, add_completion=False)


def _sidecars(directory: Path) -> list[Path]:
    return sorted(directory.rglob("*.annotations.json"))


def _video_for(sidecar: Path) -> Path:
    name = sidecar.name[: -len(".annotations.json")]
    return sidecar.with_name(name)


@app.command()
def bake(directory: Path, out: Path | None = None) -> None:
    """Sample every trajectory frame by frame into a neutral dataset."""
    directory = directory.expanduser().resolve()
    out = (out or directory / "baked").expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for sidecar in _sidecars(directory):
        video = _video_for(sidecar)
        if not video.exists():
            typer.echo(f"skip (missing video): {sidecar.name}", err=True)
            continue
        doc = Document.model_validate(json.loads(sidecar.read_text(encoding="utf-8")))
        data = doc.model_dump(by_alias=True)
        table = probe.build_frame_table(video)
        arrays = _bake_arrays(data, table)
        target = out / (video.stem + ".npz")
        np.savez_compressed(target, **arrays)
        events = out / (video.stem + ".events.jsonl")
        with events.open("w", encoding="utf-8") as handle:
            for event in _bake_events(data, video.name):
                handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        count += 1
        typer.echo(f"baked {video.name}: {arrays['frame'].shape[0]} samples")
    typer.echo(f"{count} video(s) -> {out}")


def _bake_arrays(data: dict, table) -> dict[str, np.ndarray]:
    frames: list[int] = []
    seq_idx: list[int] = []
    traj_idx: list[int] = []
    xs: list[float] = []
    ys: list[float] = []
    court_x: list[float] = []
    court_y: list[float] = []
    visible: list[int] = []
    occluded: list[int] = []

    for si, seq in enumerate(data.get("sequences") or []):
        court = seq.get("court") or {}
        for ti, traj in enumerate(seq.get("trajectories") or []):
            span = range(int(traj["tStart"]), int(traj["tEnd"]) + 1)
            flags = derive.occlusion_mask(traj, span)
            for f in span:
                point = derive.trajectory_point(traj, f)
                if point is None:
                    continue
                frames.append(f)
                seq_idx.append(si)
                traj_idx.append(ti)
                xs.append(point[0])
                ys.append(point[1])
                world = derive.ball_court_position(court, f, point)
                court_x.append(world[0] if world else float("nan"))
                court_y.append(world[1] if world else float("nan"))
                visible.append(int(0.0 <= point[0] <= 1.0 and 0.0 <= point[1] <= 1.0))
                occluded.append(int(flags.get(f, False)))

    return {
        "frame": np.asarray(frames, dtype=np.int32),
        "sequence": np.asarray(seq_idx, dtype=np.int32),
        "trajectory": np.asarray(traj_idx, dtype=np.int32),
        "x": np.asarray(xs, dtype=np.float32),
        "y": np.asarray(ys, dtype=np.float32),
        "court_x": np.asarray(court_x, dtype=np.float32),
        "court_y": np.asarray(court_y, dtype=np.float32),
        "visible": np.asarray(visible, dtype=np.uint8),
        "occluded": np.asarray(occluded, dtype=np.uint8),
        "frame_count": np.asarray([table.frameCount], dtype=np.int32),
        "width": np.asarray([table.width], dtype=np.int32),
        "height": np.asarray([table.height], dtype=np.int32),
    }


def _bake_events(data: dict, file_name: str) -> list[dict]:
    events: list[dict] = []
    for seq in data.get("sequences") or []:
        court = seq.get("court") or {}
        for traj in seq.get("trajectories") or []:
            for point in traj["points"]:
                if point["kind"] != "anchor" or point.get("tag") == "boundary":
                    continue
                world = derive.ball_court_position(court, point["t"], (point["x"], point["y"]))
                events.append(
                    {
                        "video": file_name,
                        "sequence": seq["id"],
                        "trajectory": traj["id"],
                        "frame": point["t"],
                        "tag": point["tag"],
                        "x": round(point["x"], 6),
                        "y": round(point["y"], 6),
                        "courtX": round(world[0], 4) if world else None,
                        "courtY": round(world[1], 4) if world else None,
                        "side": derive.court_side(court, point["t"], (point["x"], point["y"])),
                    }
                )
    return events


@app.command()
def check(directory: Path) -> None:
    """Validate every sidecar: schema, invariants, and video fingerprint."""
    directory = directory.expanduser().resolve()
    problems = 0
    for sidecar in _sidecars(directory):
        video = _video_for(sidecar)
        try:
            raw = json.loads(sidecar.read_text(encoding="utf-8"))
            doc = Document.model_validate(raw)
            if not video.exists():
                raise ValueError("video file missing")
            table = probe.build_frame_table(video)
            stored = doc.video
            if stored.frameCount != table.frameCount:
                raise ValueError(
                    f"frameCount drift: annotations {stored.frameCount} vs video {table.frameCount}"
                )
            size, head, tail = probe.fingerprint(video)
            if head != stored.fingerprint.headSha256 or tail != stored.fingerprint.tailSha256:
                typer.echo(f"WARN {video.name}: content fingerprint differs (metadata only)", err=True)
            typer.echo(f"OK   {video.name}: {len(doc.sequences)} sequence(s)")
        except Exception as exc:  # noqa: BLE001 - report every problem
            problems += 1
            typer.echo(f"FAIL {sidecar.name}: {exc}", err=True)
    if problems:
        raise typer.Exit(code=1)


# --- render ---------------------------------------------------------------


def _draw_polyline(canvas: np.ndarray, points: list[tuple[float, float]], color, thickness: int = 2) -> None:
    h, w = canvas.shape[:2]
    r = max(1, thickness)
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            u = i / max(1, n)
            x = int(round(x0 + (x1 - x0) * u))
            y = int(round(y0 + (y1 - y0) * u))
            if 0 <= x < w and 0 <= y < h:
                canvas[max(0, y - r) : min(h, y + r + 1), max(0, x - r) : min(w, x + r + 1)] = color


def _draw_disc(canvas: np.ndarray, cx: float, cy: float, radius: int, color) -> None:
    h, w = canvas.shape[:2]
    x0, x1 = int(cx - radius), int(cx + radius) + 1
    y0, y1 = int(cy - radius), int(cy + radius) + 1
    ys, xs = np.mgrid[y0:y1, x0:x1]
    mask = (xs - cx) ** 2 + (ys - cy) ** 2 <= radius * radius
    ys = ys.clip(0, h - 1)
    xs = xs.clip(0, w - 1)
    canvas[ys[mask], xs[mask]] = color


@app.command()
def render(
    video: Path,
    out: Path | None = None,
    start: int = 0,
    end: int = -1,
    overlay_only: bool = False,
) -> None:
    """Burn a verification overlay (court lines + ball) over the video.

    Assumes constant frame rate; a QC tool, not a deliverable.
    """
    video = video.expanduser().resolve()
    sidecar = library.sidecar_path(video)
    if not sidecar.exists():
        typer.echo(f"no annotations next to {video.name}", err=True)
        raise typer.Exit(code=1)
    doc = Document.model_validate(json.loads(sidecar.read_text(encoding="utf-8")))
    data = doc.model_dump(by_alias=True)
    table = probe.build_frame_table(video)
    last = table.frameCount - 1 if end < 0 else min(end, table.frameCount - 1)
    fps = table.fpsNominal if table.fpsNominal > 0 else 30.0
    width, height = table.width, table.height
    total = last - start + 1
    target = out or video.with_name(video.stem + ".overlay.mp4")

    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-ss",
        f"{table.pts[start]:.6f}",
        "-i",
        str(video),
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        f"{width}x{height}",
        "-framerate",
        f"{fps}",
        "-i",
        "-",
        "-filter_complex",
        "[0:v]format=yuv420p[base];[1:v]format=rgba[ov];[base][ov]overlay=0:0",
        "-frames:v",
        str(total),
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p1",
        "-cq",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        str(target),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None

    sequences = data.get("sequences") or []
    for frame in range(start, last + 1):
        canvas = np.zeros((height, width, 4), dtype=np.uint8)
        seq = next((s for s in sequences if s["tStart"] <= frame <= s["tEnd"]), None)
        if seq is not None:
            court = seq.get("court") or {}
            lines = derive.project_court_lines(court, frame)
            if lines:
                for line in lines:
                    pts = [(p[0] * width, p[1] * height) for p in line]
                    if all(np.isfinite([p[0], p[1]]).all() for p in pts):
                        _draw_polyline(canvas, pts, (255, 220, 0, 255), 2)
            for traj in seq.get("trajectories") or []:
                point = derive.trajectory_point(traj, frame)
                if point is None:
                    continue
                color = (0, 255, 128, 255) if traj["tStart"] <= frame else (255, 0, 0, 255)
                _draw_disc(canvas, point[0] * width, point[1] * height, 6, color)
        try:
            proc.stdin.write(canvas.tobytes())
        except BrokenPipeError:
            break
    proc.stdin.close()
    proc.wait()
    if proc.returncode != 0:
        typer.echo("ffmpeg failed", err=True)
        raise typer.Exit(code=1)
    typer.echo(f"wrote {target}")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8001, reload: bool = False) -> None:
    """Run the local web application."""
    import uvicorn

    uvicorn.run("app.main:app", host=host, port=port, reload=reload, app_dir="backend")


if __name__ == "__main__":
    app()
