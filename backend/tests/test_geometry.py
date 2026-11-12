import math

import pytest

from app import geometry
from app.geometry import Knot


def test_single_knot_is_constant() -> None:
    knots: list[Knot] = [(10, 0.2, 0.3, "anchor")]
    for f in (0, 10, 999):
        assert geometry.sample_knots(knots, f) == pytest.approx((0.2, 0.3))


def test_curve_passes_through_knots() -> None:
    knots: list[Knot] = [
        (0, 0.1, 0.1, "anchor"),
        (10, 0.4, 0.2, "path"),
        (20, 0.3, 0.8, "anchor"),
        (35, 0.9, 0.9, "anchor"),
    ]
    for t, x, y, _ in knots:
        assert geometry.sample_knots(knots, float(t)) == pytest.approx((x, y), abs=1e-12)


def test_kink_at_anchor_path_smooth() -> None:
    knots: list[Knot] = [
        (0, 0.0, 0.0, "anchor"),
        (10, 1.0, 0.0, "anchor"),  # sharp direction change
        (20, 1.0, 1.0, "anchor"),
    ]
    # derivative just before/after t=10 must differ: we probe tiny steps
    eps = 1e-4
    before = geometry.sample_knots(knots, 10 - eps)
    after = geometry.sample_knots(knots, 10 + eps)
    d_before = ((1.0 - before[0]) / eps, (0.0 - before[1]) / eps)
    d_after = ((after[0] - 1.0) / eps, (after[1] - 0.0) / eps)
    # segment 0 spans 10 frames for dx=1 => 0.1 per frame; segment 1 goes straight up
    assert d_before[0] == pytest.approx(0.1, abs=1e-3) and abs(d_before[1]) < 1e-2
    assert abs(d_after[0]) < 1e-2 and d_after[1] == pytest.approx(0.1, abs=1e-3)


def test_sampling_is_finite_everywhere() -> None:
    knots: list[Knot] = [
        (0, 0.5, 0.5, "anchor"),
        (3, 0.2, 0.9, "path"),
        (4, 0.7, 0.1, "path"),
        (9, 0.5, 0.5, "anchor"),
    ]
    for f in range(0, 10):
        x, y = geometry.sample_knots(knots, float(f))
        assert math.isfinite(x) and math.isfinite(y)


def test_homography_round_trip() -> None:
    src = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    dst = [(-5.485, -11.885), (5.485, -11.885), (5.485, 11.885), (-5.485, 11.885)]
    H = geometry.homography(src, dst)
    for s, d in zip(src, dst):
        assert geometry.apply_homography(H, s) == pytest.approx(d, abs=1e-9)
    Hinv = __import__("numpy").linalg.inv(H)
    for s, d in zip(src, dst):
        assert geometry.apply_homography(Hinv, d) == pytest.approx(s, abs=1e-9)


def test_degenerate_quad_detected() -> None:
    assert geometry.is_degenerate_quad([(0, 0), (1, 0), (2, 0), (3, 0)])
    assert geometry.is_degenerate_quad([(0, 0), (0, 0), (1, 1), (0, 1)])
    assert not geometry.is_degenerate_quad([(0, 0), (1, 0), (1, 1), (0, 1)])


def test_precision_ratio_doubles_corners_is_one() -> None:
    ids = geometry.PRESETS["doubles_corners"]
    # camera-like mapping: near baseline at the bottom of the frame
    image_quad = [(0.2, 0.9), (0.8, 0.9), (0.35, 0.25), (0.65, 0.25)]
    H_court_to_image = geometry.homography(
        [geometry.LANDMARKS[i] for i in ids], image_quad
    )
    image = {i: geometry.apply_homography(H_court_to_image, geometry.LANDMARKS[i]) for i in ids}
    assert geometry.precision_ratio(image, ids) == pytest.approx(1.0, abs=1e-9)


def test_precision_ratio_singles_corners_below_one() -> None:
    ids = geometry.PRESETS["singles_corners"]
    image_quad = [(0.2, 0.9), (0.8, 0.9), (0.35, 0.25), (0.65, 0.25)]
    H_court_to_image = geometry.homography(
        [geometry.LANDMARKS[i] for i in ids], image_quad
    )
    image = {i: geometry.apply_homography(H_court_to_image, geometry.LANDMARKS[i]) for i in ids}
    ratio = geometry.precision_ratio(image, ids)
    assert 0.5 < ratio < 0.8


def test_landmark_scale_consistency() -> None:
    width = geometry.LANDMARKS["near_right"][0] - geometry.LANDMARKS["near_left"][0]
    assert width == pytest.approx(10.97)
    length = geometry.LANDMARKS["far_left"][1] - geometry.LANDMARKS["near_left"][1]
    assert length == pytest.approx(23.77)
