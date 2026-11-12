import os
import tempfile
from pathlib import Path

# Isolate XDG paths *before* the app modules are imported anywhere.
_TEST_HOME = Path(tempfile.mkdtemp(prefix="tennis-test-"))
os.environ["XDG_CONFIG_HOME"] = str(_TEST_HOME / "config")
os.environ["XDG_CACHE_HOME"] = str(_TEST_HOME / "cache")

import subprocess  # noqa: E402

import pytest  # noqa: E402


def _have_ffmpeg() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


requires_ffmpeg = pytest.mark.skipif(not _have_ffmpeg(), reason="ffmpeg not available")


@pytest.fixture(scope="session")
def test_video(tmp_path_factory) -> tuple[Path, list[bytes], int, int]:
    """Lossless testsrc2 clip plus its fully decoded ground-truth frames."""
    folder = tmp_path_factory.mktemp("media")
    path = folder / "clip.mp4"
    width, height, fps, frames = 160, 120, 30, 60
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc2=s={width}x{height}:r={fps}:d={frames / fps}",
            "-c:v",
            "libx264",
            "-qp",
            "0",
            "-g",
            "12",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
    )
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
        check=True,
    ).stdout
    size = width * height * 3
    truth = [raw[i * size : (i + 1) * size] for i in range(len(raw) // size)]
    return path, truth, width, height
