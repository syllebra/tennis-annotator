"""Robust fitting of a detected ball trajectory to a few path points.

Two stages:
1. RANSAC on a quadratic per coordinate, to discard detections that belong to
   players, lines or spectators.
2. Greedy knot insertion against the *real* spline: while the worst residual is
   above the tolerance, add the worst frame as a path point.  This yields the
   smallest set of path points that reproduces the trajectory.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..geometry import Knot, sample_knots


@dataclass
class Detection:
    frame: int
    x: float  # ratio of the (displayed) frame width
    y: float  # ratio of the (displayed) frame height
    score: float = 1.0


@dataclass
class FitResult:
    points: list[dict]
    stats: dict


class FitError(RuntimeError):
    pass


def _residuals(frames: np.ndarray, xs: np.ndarray, ys: np.ndarray, coefficients: np.ndarray) -> np.ndarray:
    design = np.stack([np.ones_like(frames), frames, frames**2], axis=1)
    predicted_x = design @ coefficients[0]
    predicted_y = design @ coefficients[1]
    return np.hypot(predicted_x - xs, predicted_y - ys)


def ransac_quadratic(
    detections: list[Detection],
    width: int,
    height: int,
    tolerance_px: float,
    *,
    iterations: int = 300,
    seed: int = 0,
) -> list[Detection]:
    """Keep detections consistent with a smooth flight (quadratic in time)."""
    if len(detections) <= 6:
        return list(detections)

    frames = np.array([d.frame for d in detections], dtype=float)
    xs = np.array([d.x * width for d in detections], dtype=float)
    ys = np.array([d.y * height for d in detections], dtype=float)
    inlier_threshold = max(4.0, tolerance_px * 3.0)

    rng = np.random.default_rng(seed)
    best_mask: np.ndarray | None = None
    best_inliers = 0
    best_cost = float("inf")
    count = len(detections)
    sample_size = 4

    for _ in range(iterations):
        sample = rng.choice(count, size=sample_size, replace=False)
        design = np.stack([np.ones(sample_size), frames[sample], frames[sample] ** 2], axis=1)
        try:
            coef_x, *_ = np.linalg.lstsq(design, xs[sample], rcond=None)
            coef_y, *_ = np.linalg.lstsq(design, ys[sample], rcond=None)
        except np.linalg.LinAlgError:
            continue
        coefficients = np.stack([coef_x, coef_y])
        residuals = _residuals(frames, xs, ys, coefficients)
        mask = residuals <= inlier_threshold
        inliers = int(mask.sum())
        if inliers < sample_size:
            continue
        cost = float(residuals[mask].mean())
        if inliers > best_inliers or (inliers == best_inliers and cost < best_cost):
            best_mask = mask
            best_inliers = inliers
            best_cost = cost

    if best_mask is None or best_mask.sum() < 4:
        # Nothing smooth enough: keep the highest-confidence detections only.
        ranked = sorted(detections, key=lambda d: d.score, reverse=True)
        return ranked[: max(4, len(ranked) // 3)]

    # Refit on all inliers for a tighter model, then keep the inliers.
    design = np.stack([np.ones(count), frames, frames**2], axis=1)
    try:
        coef_x, *_ = np.linalg.lstsq(design[best_mask], xs[best_mask], rcond=None)
        coef_y, *_ = np.linalg.lstsq(design[best_mask], ys[best_mask], rcond=None)
        coefficients = np.stack([coef_x, coef_y])
        residuals = _residuals(frames, xs, ys, coefficients)
        final_mask = residuals <= inlier_threshold
        if final_mask.sum() >= 4:
            best_mask = final_mask
    except np.linalg.LinAlgError:
        pass

    return [detection for detection, keep in zip(detections, best_mask) if keep]


def select_knots(
    anchor_a: Knot,
    anchor_b: Knot,
    detections: list[Detection],
    *,
    width: int,
    height: int,
    tolerance_px: float = 2.0,
    max_points: int = 8,
) -> FitResult:
    """Add path points until the spline fits the detections within tolerance."""
    if anchor_b[0] <= anchor_a[0]:
        raise FitError("les deux ancres doivent être ordonnées")
    usable = [d for d in detections if anchor_a[0] < d.frame < anchor_b[0]]
    if not usable:
        raise FitError("aucune détection entre les deux ancres")

    usable.sort(key=lambda d: d.frame)
    knots: list[Knot] = [anchor_a, anchor_b]
    added: list[Knot] = []

    def errors() -> list[tuple[float, Detection]]:
        out = []
        for detection in usable:
            sx, sy = sample_knots(knots, float(detection.frame))
            dx = (sx - detection.x) * width
            dy = (sy - detection.y) * height
            out.append((float(np.hypot(dx, dy)), detection))
        return out

    current = errors()
    for _ in range(max_points):
        worst_error, worst = max(current, key=lambda item: item[0])
        if worst_error <= tolerance_px:
            break
        knot: Knot = (worst.frame, worst.x, worst.y, "path")
        knots = sorted([*knots, knot], key=lambda item: item[0])
        added.append(knot)
        current = errors()

    values = np.array([error for error, _ in current], dtype=float)
    stats = {
        "added": len(added),
        "max_error_px": round(float(values.max()), 3),
        "rms_error_px": round(float(np.sqrt((values**2).mean())), 3),
        "frames_used": len(usable),
        "tolerance_px": tolerance_px,
        "max_points": max_points,
        "reached_tolerance": bool(values.max() <= tolerance_px),
    }
    points = [
        {"t": int(t), "x": round(float(x), 6), "y": round(float(y), 6), "kind": "path", "source": "auto"}
        for t, x, y, _ in sorted(added, key=lambda item: item[0])
    ]
    return FitResult(points=points, stats=stats)


def fit_segment(
    anchor_a: Knot,
    anchor_b: Knot,
    detections: list[Detection],
    *,
    width: int,
    height: int,
    tolerance_px: float = 2.0,
    max_points: int = 8,
    seed: int = 0,
) -> FitResult:
    """RANSAC filtering followed by minimal knot selection."""
    kept = ransac_quadratic(detections, width, height, tolerance_px, seed=seed)
    result = select_knots(
        anchor_a,
        anchor_b,
        kept,
        width=width,
        height=height,
        tolerance_px=tolerance_px,
        max_points=max_points,
    )
    result.stats["detections"] = len(detections)
    result.stats["rejected"] = len(detections) - len(kept)
    segment_frames = max(1, anchor_b[0] - anchor_a[0] - 1)
    result.stats["coverage"] = round(len(kept) / segment_frames, 3)
    if kept:
        xs = [item.x for item in kept]
        ys = [item.y for item in kept]
        result.stats["displacement_px"] = round(
            float(np.hypot((max(xs) - min(xs)) * width, (max(ys) - min(ys)) * height)), 1
        )
    else:
        result.stats["displacement_px"] = 0.0
    return result
