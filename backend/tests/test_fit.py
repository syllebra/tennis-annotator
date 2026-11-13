import numpy as np
import pytest

from app.detectors.fit import Detection, FitError, ransac_quadratic, select_knots

WIDTH, HEIGHT = 1280, 720
FIRST, LAST = 0, 60


def parabola(t: float) -> tuple[float, float]:
    return (0.20 + 0.004 * t, 0.80 - 0.010 * t + 0.00008 * t * t)


def detections(outlier_ratio: float = 0.2, seed: int = 1) -> list[Detection]:
    rng = np.random.default_rng(seed)
    out = []
    for frame in range(FIRST, LAST + 1):
        x, y = parabola(frame)
        if 3 < frame < LAST - 3 and rng.random() < outlier_ratio:
            out.append(Detection(frame, float(rng.random()), float(rng.random()), 0.4))
        else:
            out.append(Detection(frame, x, y, 0.8))
    return out


def anchors() -> tuple[tuple, tuple]:
    return (
        (FIRST, *parabola(FIRST), "anchor"),
        (LAST, *parabola(LAST), "anchor"),
    )


def test_ransac_rejects_outliers() -> None:
    data = detections()
    kept = ransac_quadratic(data, WIDTH, HEIGHT, 2.0, seed=3)
    assert 0.7 < len(kept) / len(data) < 0.95
    # rejected points are the ones far from the parabola
    for detection in kept:
        x, y = parabola(detection.frame)
        assert abs(detection.x - x) * WIDTH < 20
        assert abs(detection.y - y) * HEIGHT < 20


def test_minimal_knots_reach_tolerance() -> None:
    a, b = anchors()
    kept = ransac_quadratic(detections(), WIDTH, HEIGHT, 2.0, seed=3)
    fit = select_knots(a, b, kept, width=WIDTH, height=HEIGHT, tolerance_px=2.0, max_points=8)
    assert fit.stats["reached_tolerance"] is True
    assert fit.stats["max_error_px"] <= 2.0
    assert 1 <= fit.stats["added"] <= 5
    assert all(a[0] < point["t"] < b[0] for point in fit.points)
    assert [point["t"] for point in fit.points] == sorted(point["t"] for point in fit.points)
    assert all(point["kind"] == "path" and point["source"] == "auto" for point in fit.points)


def test_tolerance_trades_points_for_error() -> None:
    a, b = anchors()
    kept = ransac_quadratic(detections(), WIDTH, HEIGHT, 2.0, seed=3)
    tight = select_knots(a, b, kept, width=WIDTH, height=HEIGHT, tolerance_px=1.0, max_points=8)
    loose = select_knots(a, b, kept, width=WIDTH, height=HEIGHT, tolerance_px=14.0, max_points=8)
    assert loose.stats["added"] < tight.stats["added"]
    assert loose.stats["max_error_px"] <= 14.0


def test_max_points_is_a_hard_cap() -> None:
    a, b = anchors()
    kept = ransac_quadratic(detections(), WIDTH, HEIGHT, 2.0, seed=3)
    fit = select_knots(a, b, kept, width=WIDTH, height=HEIGHT, tolerance_px=0.01, max_points=2)
    assert fit.stats["added"] == 2
    assert fit.stats["reached_tolerance"] is False


def test_single_detection_is_used() -> None:
    a, b = anchors()
    x, y = parabola(30)
    fit = select_knots(
        a, b, [Detection(30, x, y)], width=WIDTH, height=HEIGHT, tolerance_px=2.0, max_points=8
    )
    assert fit.stats["added"] == 1
    assert fit.points[0]["t"] == 30


def test_no_detection_between_anchors_fails() -> None:
    a, b = anchors()
    with pytest.raises(FitError):
        select_knots(a, b, [Detection(0, 0.5, 0.5)], width=WIDTH, height=HEIGHT)


def test_ransac_with_only_outliers_still_returns_something() -> None:
    rng = np.random.default_rng(5)
    data = [Detection(frame, float(rng.random()), float(rng.random()), 0.5) for frame in range(20)]
    kept = ransac_quadratic(data, WIDTH, HEIGHT, 2.0, seed=1)
    assert len(kept) >= 4


def test_short_segments_skip_ransac() -> None:
    data = [Detection(frame, 0.5, 0.5, 0.5) for frame in range(5)]
    assert len(ransac_quadratic(data, WIDTH, HEIGHT, 2.0)) == 5
