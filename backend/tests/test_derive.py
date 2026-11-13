import pytest

from app import derive, geometry


def court(keys: list[tuple[int, float]]) -> dict:
    """Two court poses where every landmark moves by (dx, dy) over the range."""
    ids = ["near_left", "near_right", "far_right", "far_left"]
    base = {
        "near_left": (0.20, 0.90),
        "near_right": (0.80, 0.90),
        "far_right": (0.65, 0.30),
        "far_left": (0.35, 0.30),
    }
    keyframes = []
    for index, (frame, shift) in enumerate(keys):
        keyframes.append(
            {
                "t": frame,
                "source": "manual",
                "landmarks": {
                    landmark: {"x": base[landmark][0] + shift, "y": base[landmark][1]}
                    for landmark in ids
                },
            }
        )
    return {"preset": "doubles_corners", "homographyLandmarks": ids, "mirrored": False, "keyframes": keyframes}


def test_court_landmarks_are_linear() -> None:
    data = court([(0, 0.0), (10, 0.2)])
    at_0 = derive.landmarks_at(data, 0)["near_left"]
    at_10 = derive.landmarks_at(data, 10)["near_left"]
    at_5 = derive.landmarks_at(data, 5)["near_left"]
    assert at_5[0] == pytest.approx((at_0[0] + at_10[0]) / 2)
    assert at_5[1] == pytest.approx((at_0[1] + at_10[1]) / 2)


def test_court_landmarks_do_not_overshoot() -> None:
    data = court([(0, 0.0), (10, 0.2), (20, 0.0)])
    for frame in range(0, 21):
        x = derive.landmarks_at(data, frame)["near_left"][0]
        assert 0.20 - 1e-9 <= x <= 0.40 + 1e-9


def test_court_landmarks_clamp_outside_keyframes() -> None:
    data = court([(5, 0.0), (15, 0.2)])
    before = derive.landmarks_at(data, 0)["near_left"]
    after = derive.landmarks_at(data, 99)["near_left"]
    assert before[0] == pytest.approx(0.20)
    assert after[0] == pytest.approx(0.40)


def test_static_court_is_constant() -> None:
    data = court([(0, 0.1)])
    for frame in (0, 50, 200):
        assert derive.landmarks_at(data, frame)["near_left"][0] == pytest.approx(0.30)


def test_homography_follows_linear_motion() -> None:
    data = court([(0, 0.0), (10, 0.1)])
    h0 = derive.homography_at(data, 0)
    h5 = derive.homography_at(data, 5)
    assert h0 is not None and h5 is not None
    # the mid pose is the linear blend of the landmark positions, not a spline
    mid = derive.precision_ratio(data, 5)
    assert 0 < mid <= 1.05


def test_sample_linear_bounds() -> None:
    knots = [(0, 0.2, 0.8, "path"), (10, 0.6, 0.2, "path")]
    assert geometry.sample_linear(knots, 5) == pytest.approx((0.4, 0.5))
    for frame in range(0, 11):
        x, y = geometry.sample_linear(knots, float(frame))
        assert 0.2 <= x <= 0.6
        assert 0.2 <= y <= 0.8
