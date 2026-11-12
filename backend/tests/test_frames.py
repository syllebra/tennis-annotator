import subprocess

import pytest

from conftest import requires_ffmpeg
from app.frames import FrameDecoder, frame_to_raw
from app.probe import build_frame_table


@requires_ffmpeg
def test_frame_table(test_video) -> None:
    path, truth, width, height = test_video
    table = build_frame_table(path, use_cache=False)
    assert (table.width, table.height) == (width, height)
    assert table.frameCount == len(truth) == 60
    assert table.fpsNominal == pytest.approx(30.0, abs=0.01)
    assert table.vfr is False


@requires_ffmpeg
def test_seek_is_frame_exact(test_video) -> None:
    """Every returned frame must equal the same index of a full decode."""
    path, truth, width, height = test_video
    table = build_frame_table(path, use_cache=False)
    decoder = FrameDecoder(path, table)
    for n in (0, 1, 2, 5, 11, 12, 13, 30, 47, 59):
        half = min(width, height) // 2
        image = decoder.crop(n, width / 2, height / 2, half)
        size, cx, cy = decoder.crop_rect(width / 2, height / 2, half)
        raw = frame_to_raw(image, size, size)
        expected = truth[n]
        # rebuild the same crop from the ground truth frame
        crop = b"".join(
            expected[((cy + y) * width + (cx + x)) * 3 : ((cy + y) * width + (cx + x)) * 3 + 3]
            for y in range(size)
            for x in range(size)
        )
        assert raw == crop, f"frame {n} mismatch"


@requires_ffmpeg
def test_rgb_clip_is_lossless(test_video) -> None:
    path, truth, width, height = test_video
    table = build_frame_table(path, use_cache=False)
    decoder = FrameDecoder(path, table)
    image = decoder.crop(59, width / 2, height / 2, min(width, height) // 2)
    assert image[:4] == b"\x89PNG"


@requires_ffmpeg
def test_out_of_range_rejected(test_video) -> None:
    from app.frames import FrameError

    path, truth, width, height = test_video
    table = build_frame_table(path, use_cache=False)
    decoder = FrameDecoder(path, table)
    with pytest.raises(FrameError):
        decoder.frame(60)


@requires_ffmpeg
def test_jpeg_frame_has_right_size(test_video) -> None:
    path, truth, width, height = test_video
    table = build_frame_table(path, use_cache=False)
    decoder = FrameDecoder(path, table)
    data = decoder.frame(10, 80)
    assert data[:2] == b"\xff\xd8"
    raw = frame_to_raw(data, 80, 60)
    assert len(raw) == 80 * 60 * 3
