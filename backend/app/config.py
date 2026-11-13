"""Local configuration and cache locations (XDG)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "tennis-annotator"
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "tennis-annotator"
STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "tennis-annotator"
CONFIG_FILE = CONFIG_DIR / "config.json"

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".ts", ".mts"}


def default_config() -> dict[str, Any]:
    return {
        "videoRoot": str(Path.home() / "Videos"),
        "proxy": True,
        "detectors": {
            "analyzerPath": "",
            "ballThreshold": 0.35,
            "tolerancePx": 2.0,
            "maxPoints": 8,
        },
    }


def _merge(base: dict[str, Any], extra: dict[str, Any]) -> None:
    """Recursive merge so new nested defaults survive older config files."""
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        else:
            base[key] = value


def load_config() -> dict[str, Any]:
    cfg = default_config()
    if CONFIG_FILE.exists():
        try:
            _merge(cfg, json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


def save_config(cfg: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, sort_keys=True), encoding="utf-8")


def cache_path(*parts: str) -> Path:
    p = CACHE_DIR.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p
