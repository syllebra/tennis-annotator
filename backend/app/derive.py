"""Derived geometry: curves and per-frame homographies from an annotation document."""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

from . import geometry
from .geometry import Knot, Point


def court_knots(court: dict, landmark_id: str) -> list[Knot]:
    keys = sorted(court.get("keyframes") or [], key=lambda k: k["t"])
    out: list[Knot] = []
    for kf in keys:
        lm = kf["landmarks"].get(landmark_id)
        if lm is None:
            continue
        out.append((int(kf["t"]), float(lm["x"]), float(lm["y"]), "path"))
    return out


def landmarks_at(court: dict, frame: int) -> dict[str, Point]:
    ids = court.get("homographyLandmarks") or []
    out: dict[str, Point] = {}
    for lid in ids:
        knots = court_knots(court, lid)
        if knots:
            out[lid] = geometry.sample_knots(knots, float(frame))
    return out


def homography_at(court: dict, frame: int) -> np.ndarray | None:
    ids = court.get("homographyLandmarks") or []
    lm = landmarks_at(court, frame)
    if len(lm) != 4:
        return None
    quad = [lm[i] for i in ids]
    if geometry.is_degenerate_quad(quad):
        return None
    return geometry.image_homography(lm, ids)


def trajectory_knots(traj: dict) -> list[Knot]:
    return [
        (int(p["t"]), float(p["x"]), float(p["y"]), p["kind"]) for p in traj["points"]
    ]


def trajectory_point(traj: dict, frame: int) -> Point | None:
    if frame < traj["tStart"] or frame > traj["tEnd"]:
        return None
    return geometry.sample_knots(trajectory_knots(traj), float(frame))


def occlusion_mask(traj: dict, frames: Iterable[int]) -> dict[int, bool]:
    spans = [(int(o["from"]), int(o["to"])) for o in traj.get("occlusions") or []]
    return {f: any(a <= f <= b for a, b in spans) for f in frames}


def ball_court_position(court: dict, frame: int, point: Point) -> Point | None:
    H = homography_at(court, frame)
    if H is None:
        return None
    return geometry.apply_homography(H, point)


def project_court_lines(court: dict, frame: int) -> list[list[Point]] | None:
    """Court polylines in image ratio space (already projected)."""
    H = homography_at(court, frame)
    if H is None:
        return None
    # image -> court is what we need inverted: we build court -> image instead
    Hi = np.linalg.inv(H)
    return [geometry.project_polyline(Hi, line) for line in geometry.COURT_LINES]


def full_doubles_quad(court: dict, frame: int) -> list[Point] | None:
    H = homography_at(court, frame)
    if H is None:
        return None
    Hi = np.linalg.inv(H)
    return [
        geometry.apply_homography(Hi, (-geometry.DOUBLES_HALF_WIDTH, -geometry.COURT_HALF_LENGTH)),
        geometry.apply_homography(Hi, (geometry.DOUBLES_HALF_WIDTH, -geometry.COURT_HALF_LENGTH)),
        geometry.apply_homography(Hi, (geometry.DOUBLES_HALF_WIDTH, geometry.COURT_HALF_LENGTH)),
        geometry.apply_homography(Hi, (-geometry.DOUBLES_HALF_WIDTH, geometry.COURT_HALF_LENGTH)),
    ]


def precision_ratio(court: dict, frame: int) -> float:
    lm = landmarks_at(court, frame)
    ids = court.get("homographyLandmarks") or []
    if len(lm) != 4:
        return 0.0
    projected = full_doubles_quad(court, frame)
    if not projected:
        return 0.0
    full = geometry.quadrilateral_area(projected)
    annotated = geometry.quadrilateral_area([lm[i] for i in ids])
    return annotated / full if full > 1e-12 else 0.0


def court_side(court: dict, frame: int, point: Point) -> str | None:
    """'near' / 'far' / None, derived from the court frame (Y sign)."""
    pos = ball_court_position(court, frame, point)
    if pos is None or not math.isfinite(pos[0]) or not math.isfinite(pos[1]):
        return None
    if abs(pos[1]) < 0.2:
        return None
    return "near" if pos[1] < 0 else "far"


def iter_sequence_frames(seq: dict) -> Sequence[int]:
    return range(int(seq["tStart"]), int(seq["tEnd"]) + 1)
