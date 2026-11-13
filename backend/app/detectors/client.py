"""Persistent client around `worker.py` (drives the analyzer's GPU process)."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from ..config import STATE_DIR

IDLE_TIMEOUT = 900.0
READY_TIMEOUT = 240.0
DEFAULT_TIMEOUT = 300.0


class DetectorError(RuntimeError):
    pass


class DetectorClient:
    def __init__(self, worker_path: Path | None = None) -> None:
        self.worker_path = worker_path or Path(__file__).with_name("worker.py")
        self._proc: subprocess.Popen[str] | None = None
        self._reader: threading.Thread | None = None
        self._queue: queue.Queue[dict | None] = queue.Queue()
        self._log = None
        self._lock = threading.Lock()
        self._start_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._state = "idle"
        self._message = ""
        self._last_used = 0.0
        self._next_id = 0
        self._watchdog: threading.Thread | None = None
        self._config: dict[str, Any] | None = None
        self._config_key: tuple | None = None

    # -- configuration -------------------------------------------------
    def configure(self, root: Path, court_model: Path, ball_model: Path, command: list[str], env: dict[str, str]) -> None:
        key = (str(root), str(court_model), str(ball_model), tuple(command))
        with self._state_lock:
            if key == self._config_key:
                return
            self._config_key = key
            self._config = {
                "root": str(root),
                "court": str(court_model),
                "ball": str(ball_model),
                "command": list(command),
                "env": dict(env),
            }
            if self._proc is not None:
                self.stop()

    @property
    def configured(self) -> bool:
        return self._config is not None

    # -- lifecycle -----------------------------------------------------
    def _set_state(self, state: str, message: str = "") -> None:
        with self._state_lock:
            self._state = state
            self._message = message

    def status(self) -> dict[str, Any]:
        with self._state_lock:
            proc = self._proc
            alive = proc is not None and proc.poll() is None
            state = self._state
            message = self._message
            if state == "ready" and not alive:
                state, message = "error", "worker arrêté"
            return {
                "state": state,
                "message": message,
                "pid": proc.pid if alive else None,
                "configured": self._config is not None,
            }

    def _spawn(self) -> None:
        config = self._config
        if config is None:
            self._set_state("unavailable", "détecteurs non configurés")
            raise DetectorError("détecteurs non configurés")

        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            self._log = (STATE_DIR / "detectors.log").open("a", encoding="utf-8")
        except OSError:
            self._log = None

        self._queue = queue.Queue()
        self._set_state("starting", "chargement des modèles…")
        self._last_used = time.monotonic()
        try:
            proc = subprocess.Popen(
                [
                    *config["command"],
                    str(self.worker_path),
                    config["root"],
                    config["court"],
                    config["ball"],
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self._log or subprocess.DEVNULL,
                text=True,
                bufsize=1,
                env=config["env"],
            )
        except OSError as exc:
            self._set_state("error", f"lancement impossible : {exc}")
            raise DetectorError(str(exc)) from exc

        self._proc = proc
        reader = threading.Thread(target=self._read_loop, args=(proc,), daemon=True, name="detectors-reader")
        reader.start()
        self._reader = reader

        first = self._get_message(READY_TIMEOUT)
        if first is None or first.get("event") != "ready":
            detail = ""
            if first and first.get("error"):
                detail = str(first["error"]).strip().splitlines()[-1]
            self.stop()
            self._set_state("error", f"chargement des détecteurs impossible. {detail}".strip())
            raise DetectorError(self._message)
        self._set_state("ready", "modèles chargés")
        self._start_watchdog()

    def _read_loop(self, proc: subprocess.Popen[str]) -> None:
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._queue.put(message)
        finally:
            self._queue.put(None)

    def _get_message(self, timeout: float) -> dict | None:
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def _start_watchdog(self) -> None:
        if self._watchdog is not None and self._watchdog.is_alive():
            return

        def run() -> None:
            while True:
                time.sleep(30.0)
                with self._state_lock:
                    if self._proc is None:
                        return
                if time.monotonic() - self._last_used < IDLE_TIMEOUT:
                    continue
                if self._lock.acquire(blocking=False):
                    try:
                        if time.monotonic() - self._last_used >= IDLE_TIMEOUT:
                            self.stop()
                            self._set_state("idle", "worker arrêté après inactivité")
                            return
                    finally:
                        self._lock.release()

        self._watchdog = threading.Thread(target=run, daemon=True, name="detectors-watchdog")
        self._watchdog.start()

    def stop(self) -> None:
        with self._state_lock:
            proc = self._proc
            self._proc = None
        if proc is not None and proc.poll() is None:
            try:
                if proc.stdin:
                    proc.stdin.write(json.dumps({"id": -1, "command": "shutdown"}) + "\n")
                    proc.stdin.flush()
            except (OSError, ValueError):
                pass
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        if self._log is not None:
            try:
                self._log.close()
            except OSError:
                pass
            self._log = None
        if self._state == "starting":
            self._set_state("idle", "")

    # -- requests ------------------------------------------------------
    def ensure_started(self) -> None:
        with self._start_lock:
            proc = self._proc
            if proc is not None and proc.poll() is None and self._state == "ready":
                return
            self._spawn()

    def request(self, payload: dict[str, Any], timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
        if not self.configured:
            raise DetectorError("détecteurs non configurés")
        with self._lock:
            self.ensure_started()
            proc = self._proc
            if proc is None or proc.stdin is None:
                raise DetectorError(self._message or "worker indisponible")
            self._next_id += 1
            request_id = self._next_id
            message = {"id": request_id, **payload}
            try:
                proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
                proc.stdin.flush()
            except (OSError, ValueError) as exc:
                self.stop()
                self._set_state("error", "worker interrompu")
                raise DetectorError(str(exc)) from exc

            self._last_used = time.monotonic()
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.stop()
                    self._set_state("error", "délai dépassé")
                    raise DetectorError("délai dépassé pendant le calcul")
                reply = self._get_message(remaining)
                if reply is None:
                    self.stop()
                    self._set_state("error", "worker terminé de façon inattendue")
                    raise DetectorError("worker terminé de façon inattendue")
                if reply.get("id") != request_id:
                    continue
                if not reply.get("ok"):
                    raise DetectorError(str(reply.get("error") or "échec du détecteur"))
                self._last_used = time.monotonic()
                return reply


client = DetectorClient()
