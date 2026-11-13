"""Locate the optional analyzer project and a Python interpreter able to run it.

The detectors live in a separate repository with its own Python 3.11
environment (torch + TensorRT).  We never import them in this process: we only
probe for a usable interpreter and model files, then hand off to `worker.py`.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

CODE_FILES = ("perception/keypoint_detector.py", "perception/object_detector.py")
CACHE_TTL = 30.0


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _is_analyzer_dir(path: Path) -> bool:
    return path.is_dir() and all((path / name).is_file() for name in CODE_FILES)


def resolve_root(config: dict[str, Any]) -> tuple[Path | None, str]:
    """Return (analyzer root, how it was found): env, config, auto or none."""
    from_env = os.environ.get("TENNIS_ANALYZER_DIR", "").strip()
    if from_env:
        candidate = Path(from_env).expanduser().resolve()
        if _is_analyzer_dir(candidate):
            return candidate, "env"
        return None, f"env: {candidate} n'est pas un dépôt d'analyseur valide"

    configured = str((config.get("detectors") or {}).get("analyzerPath") or "").strip()
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if _is_analyzer_dir(candidate):
            return candidate, "config"
        return None, f"config: {candidate} n'est pas un dépôt d'analyseur valide"

    base = repo_root().parent
    preferred = base / "live-tennis-analyzer"
    if _is_analyzer_dir(preferred):
        return preferred, "auto"
    if base.is_dir():
        for child in sorted(base.iterdir()):
            if child.is_dir() and _is_analyzer_dir(child):
                return child, "auto"
    return None, "dépôt de l'analyseur introuvable"


def _runs(command: list[str], env: dict[str, str] | None = None, timeout: float = 8.0) -> bool:
    try:
        result = subprocess.run(
            [*command, "-c", "print(1)"],
            capture_output=True,
            timeout=timeout,
            env=env,
            text=True,
        )
        return result.returncode == 0 and result.stdout.strip() == "1"
    except (OSError, subprocess.SubprocessError):
        return False


def resolve_interpreter(root: Path) -> tuple[list[str], dict[str, str], str] | None:
    """Find a Python that can import torch/tensorrt.

    The checkout may carry a WSL-created venv whose `bin/python` is a Windows
    symlink; in that case the uv-managed interpreter plus the intact
    site-packages still work.
    """
    base_env = os.environ.copy()
    base_env.setdefault("CUDA_MODULE_LOADING", "LAZY")

    venv_python = root / ".venv" / "bin" / "python"
    if venv_python.is_file() and _runs([str(venv_python)], base_env):
        return [str(venv_python)], base_env, "venv du dépôt"

    site_packages = sorted((root / ".venv" / "lib").glob("python3.*/site-packages"))
    uv_pythons = sorted((root / ".uv-python").glob("*/bin/python3.1*"))
    uv_pythons = [p for p in uv_pythons if p.is_file() and os.access(p, os.X_OK)]
    if uv_pythons and site_packages:
        env = base_env.copy()
        env["PYTHONPATH"] = os.pathsep.join(
            [str(path) for path in [*site_packages, root]] + [env.get("PYTHONPATH", "")]
        ).strip(os.pathsep)
        for candidate in reversed(uv_pythons):
            if _runs([str(candidate)], env):
                return [str(candidate)], env, "interpréteur uv + site-packages du venv"
    return None


def model_paths(root: Path) -> dict[str, Path | None]:
    models = root / "models"
    court = None
    candidates = sorted(models.glob("*keypoint*.trt"))
    if candidates:
        court = candidates[0]

    ball = None
    manifest = models / "models.json"
    if manifest.is_file():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            raw = (data.get("rtdetr") or {}).get("trt")
            if raw:
                candidate = models / Path(raw).name
                if candidate.is_file():
                    ball = candidate
        except (json.JSONDecodeError, OSError, TypeError):
            pass
    if ball is None:
        others = [p for p in sorted(models.glob("*.trt")) if p != court]
        if len(others) == 1:
            ball = others[0]
        elif others:
            preferred = [p for p in others if "rtdetr" in p.name]
            ball = (preferred or others)[0]
    return {"court": court, "ball": ball}


def _cache_key(root: Path | None) -> tuple:
    if root is None:
        return ("none",)
    stamps = []
    for relative in ("perception/keypoint_detector.py", "models"):
        path = root / relative
        try:
            stamps.append(path.stat().st_mtime)
        except OSError:
            stamps.append(0)
    return (str(root), *stamps)


class Discovery:
    """Small cached view of what the analyzer checkout can offer."""

    def __init__(self) -> None:
        self._cache: tuple[float, tuple, dict[str, Any]] | None = None

    def status(self, config: dict[str, Any], refresh: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        root, source = resolve_root(config)
        key = _cache_key(root)
        if (
            not refresh
            and self._cache is not None
            and self._cache[1] == key
            and now - self._cache[0] < CACHE_TTL
        ):
            return self._cache[2]

        payload: dict[str, Any] = {
            "available": False,
            "path": str(root) if root else None,
            "source": source,
            "checks": {"directory": False, "code": False, "models": False, "interpreter": False},
            "models": {"court": None, "ball": None},
            "interpreter": {"command": None, "note": None},
            "message": "",
        }
        if root is None:
            payload["message"] = source
            self._cache = (now, key, payload)
            return payload

        payload["checks"]["directory"] = True
        payload["checks"]["code"] = all((root / name).is_file() for name in CODE_FILES)
        models = model_paths(root)
        payload["models"] = {
            "court": str(models["court"]) if models["court"] else None,
            "ball": str(models["ball"]) if models["ball"] else None,
        }
        payload["checks"]["models"] = bool(models["court"] and models["ball"])

        interpreter = resolve_interpreter(root)
        if interpreter:
            command, _env, note = interpreter
            payload["checks"]["interpreter"] = True
            payload["interpreter"] = {"command": command, "note": note}
        else:
            payload["interpreter"] = {
                "command": None,
                "note": "aucun interpréteur Python 3.11 avec torch/TensorRT",
            }

        payload["available"] = all(payload["checks"].values())
        if payload["available"]:
            payload["message"] = "détecteurs prêts"
        else:
            missing = [name for name, ok in payload["checks"].items() if not ok]
            payload["message"] = "manquant : " + ", ".join(missing)
        self._cache = (now, key, payload)
        return payload

    def interpreter(self, root: Path) -> tuple[list[str], dict[str, str], str] | None:
        return resolve_interpreter(root)


discovery = Discovery()
