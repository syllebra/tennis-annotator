"""Court geometry: landmark catalogue, splines, homography.

This module is the *Python side* of the math that also exists in
`frontend/src/math.ts`. Parity is locked by golden fixtures
(`scripts/gen-golden-fixtures.ts` -> `tests/fixtures/conformance.json`).

Coordinates are always (x, y) in metres in the court frame:
  origin = centre of the net on the ground, +Y towards the far baseline,
  +Z up, X = Y x Z.
Image coordinates are ratios of the *displayed* (post-rotation) width/height.
"""

from __future__ import annotations

import math
from typing import Iterable, Literal, Sequence

import numpy as np

Point = tuple[float, float]
Kind = Literal["anchor", "path"]

# --- landmark catalogue ---------------------------------------------------

COURT_LENGTH = 23.77
COURT_HALF_LENGTH = COURT_LENGTH / 2
DOUBLES_HALF_WIDTH = 10.97 / 2
SINGLES_HALF_WIDTH = 8.23 / 2
SERVICE_LINE_DISTANCE = 6.40
NET_POST_HALF_WIDTH = 6.40

LANDMARKS: dict[str, Point] = {
    "near_left": (-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH),
    "near_right": (DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH),
    "far_left": (-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH),
    "far_right": (DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH),
    "singles_near_left": (-SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH),
    "singles_near_right": (SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH),
    "singles_far_left": (-SINGLES_HALF_WIDTH, COURT_HALF_LENGTH),
    "singles_far_right": (SINGLES_HALF_WIDTH, COURT_HALF_LENGTH),
    "service_line_near_left": (-SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE),
    "service_line_near_right": (SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE),
    "service_line_far_left": (-SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE),
    "service_line_far_right": (SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE),
    "service_line_near_center": (0.0, -SERVICE_LINE_DISTANCE),
    "service_line_far_center": (0.0, SERVICE_LINE_DISTANCE),
    "net_center": (0.0, 0.0),
    "net_line_left": (-SINGLES_HALF_WIDTH, 0.0),
    "net_line_right": (SINGLES_HALF_WIDTH, 0.0),
    "net_post_left": (-NET_POST_HALF_WIDTH, 0.0),
    "net_post_right": (NET_POST_HALF_WIDTH, 0.0),
}

PRESETS: dict[str, list[str]] = {
    # ids are listed in ring order (polygon traversal), which the UI uses as click order
    "doubles_corners": ["near_left", "near_right", "far_right", "far_left"],
    "singles_corners": [
        "singles_near_left",
        "singles_near_right",
        "singles_far_right",
        "singles_far_left",
    ],
    "service_boxes": [
        "net_center",
        "net_line_left",
        "service_line_near_left",
        "service_line_near_center",
    ],
}

# polylines in court metres, in drawing order
COURT_LINES: list[list[Point]] = [
    # doubles outline (baselines + doubles sidelines)
    [
        (-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH),
        (DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH),
        (DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH),
        (-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH),
        (-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH),
    ],
    # singles sidelines
    [(-SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH), (-SINGLES_HALF_WIDTH, COURT_HALF_LENGTH)],
    [(SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH), (SINGLES_HALF_WIDTH, COURT_HALF_LENGTH)],
    # service lines
    [(-SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE), (SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE)],
    [(-SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE), (SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE)],
    # centre service line
    [(0.0, -SERVICE_LINE_DISTANCE), (0.0, SERVICE_LINE_DISTANCE)],
    # net
    [(-NET_POST_HALF_WIDTH, 0.0), (NET_POST_HALF_WIDTH, 0.0)],
    # centre marks (10 cm inside each baseline)
    [(0.0, -COURT_HALF_LENGTH), (0.0, -COURT_HALF_LENGTH + 0.10)],
    [(0.0, COURT_HALF_LENGTH), (0.0, COURT_HALF_LENGTH - 0.10)],
]


# --- splines --------------------------------------------------------------


def _sub(a: Point, b: Point) -> Point:
    return (a[0] - b[0], a[1] - b[1])


def _add(a: Point, b: Point) -> Point:
    return (a[0] + b[0], a[1] + b[1])


def _scale(a: Point, k: float) -> Point:
    return (a[0] * k, a[1] * k)


def _div(a: Point, k: float) -> Point:
    return (a[0] / k, a[1] / k)


Knot = tuple[int, float, float, Kind]  # (t, x, y, kind)


def _central(knots: Sequence[Knot], i: int) -> Point:
    """Shared (smooth) tangent at a path point."""
    t = knots[i][0]
    p = (knots[i][1], knots[i][2])
    if i > 0 and i < len(knots) - 1:
        tp, pp = knots[i - 1][0], (knots[i - 1][1], knots[i - 1][2])
        tn, pn = knots[i + 1][0], (knots[i + 1][1], knots[i + 1][2])
        return _div(_sub(pn, pp), float(tn - tp))
    if i == 0 and len(knots) > 1:
        tn, pn = knots[1][0], (knots[1][1], knots[1][2])
        return _div(_sub(pn, p), float(tn - t))
    if i == len(knots) - 1 and i > 0:
        tp, pp = knots[i - 1][0], (knots[i - 1][1], knots[i - 1][2])
        return _div(_sub(p, pp), float(t - tp))
    return (0.0, 0.0)


def _outgoing(knots: Sequence[Knot], i: int) -> Point:
    t = knots[i][0]
    p = (knots[i][1], knots[i][2])
    if knots[i][3] == "path":
        return _central(knots, i)
    if i == len(knots) - 1:
        return _central(knots, i)
    tn, pn = knots[i + 1][0], (knots[i + 1][1], knots[i + 1][2])
    return _div(_sub(pn, p), float(tn - t))


def _incoming(knots: Sequence[Knot], i: int) -> Point:
    t = knots[i][0]
    p = (knots[i][1], knots[i][2])
    if knots[i][3] == "path":
        return _central(knots, i)
    if i == 0:
        return _central(knots, i)
    tp, pp = knots[i - 1][0], (knots[i - 1][1], knots[i - 1][2])
    return _div(_sub(p, pp), float(t - tp))


def hermite(p0: Point, m0: Point, p1: Point, m1: Point, u: float) -> Point:
    """Cubic Hermite (== cubic Bezier) evaluation on a normalised parameter."""
    u2 = u * u
    u3 = u2 * u
    h00 = 2 * u3 - 3 * u2 + 1
    h10 = u3 - 2 * u2 + u
    h01 = -2 * u3 + 3 * u2
    h11 = u3 - u2
    return (
        h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0],
        h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1],
    )


def sample_knots(knots: Sequence[Knot], t: float) -> Point:
    """Position at time t (frame). Knots must be sorted by t and unique."""
    if not knots:
        raise ValueError("cannot sample an empty curve")
    if len(knots) == 1:
        return (knots[0][1], knots[0][2])
    if t <= knots[0][0]:
        return (knots[0][1], knots[0][2])
    if t >= knots[-1][0]:
        return (knots[-1][1], knots[-1][2])

    lo, hi = 0, len(knots) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if knots[mid][0] <= t:
            lo = mid
        else:
            hi = mid

    t0, x0, y0, _ = knots[lo]
    t1, x1, y1, _ = knots[hi]
    h = float(t1 - t0)
    u = (t - t0) / h
    p0 = (x0, y0)
    p1 = (x1, y1)
    # Hermite tangents are derivatives in units-per-frame; scale by segment width.
    m0 = _scale(_outgoing(knots, lo), h)
    m1 = _scale(_incoming(knots, hi), h)
    return hermite(p0, m0, p1, m1, u)


def sample_knots_range(knots: Sequence[Knot], frames: Iterable[int]) -> list[Point]:
    return [sample_knots(knots, float(f)) for f in frames]


# --- homography -----------------------------------------------------------


def _normalise(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    centroid = points.mean(axis=0)
    shifted = points - centroid
    dist = np.sqrt((shifted**2).sum(axis=1)).mean()
    scale = math.sqrt(2) / dist if dist > 1e-12 else 1.0
    T = np.array(
        [[scale, 0.0, -scale * centroid[0]], [0.0, scale, -scale * centroid[1]], [0.0, 0.0, 1.0]]
    )
    hom = np.column_stack([shifted * scale, np.ones(len(points))])
    return hom, T


def homography(src: Sequence[Point], dst: Sequence[Point]) -> np.ndarray:
    """Normalised DLT. Returns a 3x3 matrix mapping src -> dst."""
    if len(src) != 4 or len(dst) != 4:
        raise ValueError("homography requires exactly 4 correspondences")
    s = np.asarray(src, dtype=float)
    d = np.asarray(dst, dtype=float)
    sn, Ts = _normalise(s)
    dn, Td = _normalise(d)

    A = []
    for (x, y, _), (u, v, _) in zip(sn, dn):
        A.append([-x, -y, -1.0, 0.0, 0.0, 0.0, u * x, u * y, u])
        A.append([0.0, 0.0, 0.0, -x, -y, -1.0, v * x, v * y, v])
    A = np.asarray(A)
    _, _, vt = np.linalg.svd(A)
    Hn = vt[-1].reshape(3, 3)
    H = np.linalg.inv(Td) @ Hn @ Ts
    if abs(H[2, 2]) > 1e-12:
        H = H / H[2, 2]
    return H


def apply_homography(H: np.ndarray, p: Point) -> Point:
    v = H @ np.array([p[0], p[1], 1.0])
    if abs(v[2]) < 1e-12:
        return (float("inf"), float("inf"))
    return (float(v[0] / v[2]), float(v[1] / v[2]))


def project_polyline(H: np.ndarray, line: Sequence[Point]) -> list[Point]:
    return [apply_homography(H, p) for p in line]


def _ring_order(points: Sequence[Point]) -> list[Point]:
    """Order points around their centroid so area/polygon tests are order-insensitive."""
    if len(points) < 3:
        return list(points)
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    return sorted(points, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))


def quadrilateral_area(points: Sequence[Point]) -> float:
    ring = _ring_order(points)
    area = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def is_degenerate_quad(points: Sequence[Point], min_area: float = 1e-6) -> bool:
    if len(points) != 4:
        return True
    ring = _ring_order(points)
    if quadrilateral_area(ring) < min_area:
        return True
    # duplicate / near-duplicate points
    for i in range(4):
        for j in range(i + 1, 4):
            if math.dist(ring[i], ring[j]) < 1e-4:
                return True
    # no three points nearly collinear
    for i in range(4):
        a = ring[i]
        b = ring[(i + 1) % 4]
        c = ring[(i + 2) % 4]
        ab = (b[0] - a[0], b[1] - a[1])
        bc = (c[0] - b[0], c[1] - b[1])
        cross = abs(ab[0] * bc[1] - ab[1] * bc[0])
        na = math.hypot(*ab)
        nb = math.hypot(*bc)
        if na > 0 and nb > 0 and cross / (na * nb) < 1e-4:
            return True
    return False


def image_homography(landmarks: dict[str, Point], ids: Sequence[str]) -> np.ndarray:
    """Homography image(ratio) -> court(metres) from landmark image positions."""
    src = [landmarks[i] for i in ids]
    dst = [LANDMARKS[i] for i in ids]
    return homography(src, dst)


def precision_ratio(landmarks: dict[str, Point], ids: Sequence[str]) -> float:
    """Annotated quad area / projected full doubles court area (image space)."""
    H = image_homography(landmarks, ids)
    Hinv = np.linalg.inv(H)
    full = [
        apply_homography(Hinv, (-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH)),
        apply_homography(Hinv, (DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH)),
        apply_homography(Hinv, (DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH)),
        apply_homography(Hinv, (-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH)),
    ]
    annotated = [landmarks[i] for i in ids]
    full_area = quadrilateral_area(full)
    if full_area <= 1e-12:
        return 0.0
    return quadrilateral_area(annotated) / full_area
