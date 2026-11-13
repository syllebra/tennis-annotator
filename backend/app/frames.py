"""Frame-accurate decoding from the *original* file (never from a proxy).

Everything displayed while paused comes from here, so the annotation time axis
can never drift relative to the source video.
"""

from __future__ import annotations

import subprocess
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .probe import FrameTable


class FrameError(RuntimeError):
    pass


def _rotation_filter(rotation: int) -> str | None:
    rotation %= 360
    if rotation == 90:
        return "transpose=clock"
    if rotation == 180:
        return "hflip,vflip"
    if rotation == 270:
        return "transpose=cclock"
    return None


def _decode(
    path: Path,
    table: FrameTable,
    index: int,
    graph: list[str],
    *,
    vcodec: str,
    extra: list[str] | None = None,
) -> bytes:
    if index < 0 or index >= table.frameCount:
        raise FrameError(f"frame {index} out of range 0..{table.frameCount - 1}")
    target = table.pts[index]
    # Accurate input seek: ffmpeg seeks to the previous keyframe then decodes and
    # discards up to the requested timestamp.
    filters = [*("-vf", ",".join(graph))] if graph else []
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-noautorotate",
        "-ss",
        f"{max(0.0, target):.6f}",
        "-i",
        str(path),
        "-frames:v",
        "1",
        "-an",
        "-sn",
        *filters,
        "-c:v",
        vcodec,
        *(extra or []),
        "-f",
        "image2pipe",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        raise FrameError(proc.stderr.decode("utf-8", "replace").strip() or "ffmpeg produced no frame")
    return proc.stdout


def _build_graph(table: FrameTable, extra: list[str] | None = None) -> list[str]:
    graph: list[str] = []
    rot = _rotation_filter(table.rotation)
    if rot:
        graph.append(rot)
    if extra:
        graph.extend(extra)
    return graph


class FrameDecoder:
    """LRU cache + background prefetch around the last requested frame."""

    def __init__(self, path: Path, table: FrameTable, cache_size: int = 240) -> None:
        self.path = path
        self.table = table
        self._cache: OrderedDict[tuple, bytes] = OrderedDict()
        self._lock = threading.Lock()
        self._inflight: set[tuple] = set()
        self._cache_size = cache_size
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="frame")

    # -- keys ---------------------------------------------------------
    @staticmethod
    def _key(index: int, width: int | None, crop: tuple[int, int, int, int] | None, fmt: str) -> tuple:
        return (index, width, crop, fmt)

    def _store(self, key: tuple, data: bytes) -> bytes:
        with self._lock:
            self._cache[key] = data
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return data

    def _render(
        self,
        index: int,
        width: int | None,
        crop: tuple[int, int, int, int] | None,
        fmt: str,
    ) -> bytes:
        graph = _build_graph(self.table)
        if crop is not None:
            w, h, x, y = crop
            graph.append(f"crop={w}:{h}:{x}:{y}")
        if width is not None and (crop is None or width < self.table.width):
            target_w = min(width, self.table.width)
            graph.append(f"scale={target_w}:-2:flags=bicubic")
        if fmt == "png":
            return _decode(self.path, self.table, index, graph, vcodec="png")
        return _decode(self.path, self.table, index, graph, vcodec="mjpeg", extra=["-q:v", "2"])

    def _prefetch(self, index: int, width: int | None) -> None:
        for delta in (1, 2, 3, 4, 5, 6):
            for n in (index + delta, index - delta):
                if 0 <= n < self.table.frameCount:
                    self._warm(n, width, None, "jpeg")

    def _warm(self, index: int, width: int | None, crop, fmt: str) -> None:
        key = self._key(index, width, crop, fmt)
        with self._lock:
            if key in self._cache or key in self._inflight:
                return
            self._inflight.add(key)

        def run() -> None:
            try:
                data = self._render(index, width, crop, fmt)
                self._store(key, data)
            except FrameError:
                pass
            finally:
                with self._lock:
                    self._inflight.discard(key)

        self._pool.submit(run)

    def frame(self, index: int, width: int | None = None) -> bytes:
        key = self._key(index, width, None, "jpeg")
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                data = self._cache[key]
                hit = True
            else:
                hit = False
                data = b""
        if not hit:
            data = self._store(key, self._render(index, width, None, "jpeg"))
        self._prefetch(index, width)
        return data

    def crop_rect(self, x: float, y: float, half: int) -> tuple[int, int, int]:
        """Square crop (size, cx, cy) actually rendered for a loupe request."""
        hw = self.table.width
        hh = self.table.height
        size = max(16, min(half * 2, min(hw, hh)))
        cx = max(0, min(hw - size, int(round(x)) - size // 2))
        cy = max(0, min(hh - size, int(round(y)) - size // 2))
        return size, cx, cy

    def crop(self, index: int, x: int, y: int, half: int) -> bytes:
        size, cx, cy = self.crop_rect(x, y, half)
        crop = (size, size, cx, cy)
        key = self._key(index, None, crop, "png")
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        return self._store(key, self._render(index, None, crop, "png"))

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


def image_size(path: Path) -> tuple[int, int]:
    """Pixel size of an encoded image, via ffprobe."""
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise FrameError(out.stderr.strip() or "ffprobe failed")
    parts = out.stdout.strip().split(",")
    if len(parts) < 2:
        raise FrameError("unreadable image size")
    return int(parts[0]), int(parts[1])


def extract_range(
    path: Path,
    table: FrameTable,
    start: int,
    count: int,
    out_dir: Path,
    *,
    width: int | None = None,
    quality: int = 3,
) -> tuple[list[Path], int, int]:
    """Decode `count` consecutive frames starting at `start` in a single pass.

    Returns (files in frame order, width, height).  Raises FrameError when the
    pass does not produce exactly the expected frames.
    """
    if count <= 0:
        return [], table.width, table.height
    if start < 0 or start + count > table.frameCount:
        raise FrameError("range outside the video")
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.jpg"):
        stale.unlink()

    graph = _build_graph(table)
    if width is not None and width < table.width:
        graph.append(f"scale={width}:-2:flags=bicubic")
    target = table.pts[start]
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-noautorotate",
        "-ss",
        f"{max(0.0, target):.6f}",
        "-i",
        str(path),
        "-frames:v",
        str(count),
        "-q:v",
        str(quality),
        "-start_number",
        "0",
        *(("-vf", ",".join(graph)) if graph else ()),
        str(out_dir / "%06d.jpg"),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    files = sorted(out_dir.glob("*.jpg"))
    if proc.returncode != 0 or len(files) != count:
        raise FrameError(
            proc.stderr.decode("utf-8", "replace").strip()
            or f"expected {count} frames, got {len(files)}"
        )
    out_width, out_height = image_size(files[0])
    return files, out_width, out_height


def frame_to_raw(image_bytes: bytes, width: int, height: int) -> bytes:
    """Decode an encoded image back to rgb24 (used by tests/diagnostics)."""
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        "-",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
    ]
    proc = subprocess.run(cmd, input=image_bytes, capture_output=True)
    if proc.returncode != 0:
        raise FrameError(proc.stderr.decode("utf-8", "replace"))
    return proc.stdout
