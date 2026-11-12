"""Background H.264 proxy generation for smooth playback of exotic codecs."""

from __future__ import annotations

import re
import subprocess
import threading
from pathlib import Path

from .config import cache_path
from .probe import FrameTable, build_frame_table

BROWSER_CODECS = {"h264", "vp9", "av1", "vp8"}

_PROGRESS = re.compile(r"out_time_us=(\d+)")


class ProxyManager:
    def __init__(self) -> None:
        self._state: dict[str, dict] = {}
        self._lock = threading.Lock()

    def status(self, key: str) -> dict:
        with self._lock:
            return dict(self._state.get(key, {"state": "idle", "progress": 0.0, "error": None}))

    def needs_proxy(self, table: FrameTable) -> bool:
        return table.codec not in BROWSER_CODECS

    def proxy_path(self, fingerprint_key: str) -> Path:
        return cache_path("proxies", f"{fingerprint_key}.mp4")

    def validate(self, proxy: Path, source_table: FrameTable) -> bool:
        try:
            proxied = build_frame_table(proxy, use_cache=False)
        except Exception:
            return False
        return proxied.frameCount == source_table.frameCount

    def start(self, key: str, source: Path, source_table: FrameTable) -> None:
        with self._lock:
            current = self._state.get(key)
            if current and current["state"] in {"running", "done"}:
                return
            self._state[key] = {"state": "running", "progress": 0.0, "error": None}
        thread = threading.Thread(
            target=self._run, args=(key, source, source_table), daemon=True, name=f"proxy-{key}"
        )
        thread.start()

    def _run(self, key: str, source: Path, source_table: FrameTable) -> None:
        out = self.proxy_path(key)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp.mp4")
        duration = max(0.1, source_table.duration)

        def attempt(encoder: list[str]) -> bool:
            cmd = [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(source),
                "-map",
                "0:v:0",
                "-an",
                "-sn",
                "-vf",
                "scale='min(1920,iw)':-2",
                *encoder,
                "-g",
                "60",
                "-fps_mode",
                "passthrough",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
                str(tmp),
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert proc.stdout is not None
            for line in proc.stdout:
                m = _PROGRESS.match(line.strip())
                if m:
                    seconds = int(m.group(1)) / 1_000_000.0
                    with self._lock:
                        state = self._state.get(key)
                        if state is not None:
                            state["progress"] = min(0.99, seconds / duration)
            code = proc.wait()
            if code != 0 or not tmp.exists():
                tmp.unlink(missing_ok=True)
                return False
            return True

        ok = attempt(["-c:v", "h264_nvenc", "-preset", "p1", "-rc", "vbr", "-cq", "23"])
        if not ok:
            ok = attempt(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"])

        if not ok or not self.validate(tmp, source_table):
            tmp.unlink(missing_ok=True)
            with self._lock:
                self._state[key] = {
                    "state": "error",
                    "progress": 0.0,
                    "error": "proxy generation failed (playback falls back to frames only)",
                }
            return

        tmp.replace(out)
        with self._lock:
            self._state[key] = {"state": "done", "progress": 1.0, "error": None}


proxy_manager = ProxyManager()
