"""Court keypoint detector mapping.

The analyzer model predicts 14 keypoints (see `perception/keypoint_detector.py`).
We keep the 4 doubles corners as landmarks and use the other 10 to score how
well the resulting homography matches the rest of the detected court.
"""

from __future__ import annotations

import math

import numpy as np

from ..geometry import LANDMARKS, apply_homography, image_homography, is_degenerate_quad

CORNERS: dict[int, str] = {
    0: "far_left",
    1: "far_right",
    2: "near_left",
    3: "near_right",
}

EXTRA: dict[int, str] = {
    4: "singles_far_left",
    5: "singles_near_left",
    6: "singles_far_right",
    7: "singles_near_right",
    8: "service_line_far_left",
    9: "service_line_far_right",
    10: "service_line_near_left",
    11: "service_line_near_right",
    12: "service_line_far_center",
    13: "service_line_near_center",
}

HOMOGRAPHY_IDS = ["near_left", "near_right", "far_right", "far_left"]


def landmarks_from_keypoints(
    keypoints: list[list[float]], width: int, height: int
) -> dict[str, tuple[float, float]]:
    if len(keypoints) < 4:
        raise ValueError("le détecteur n'a pas renvoyé 4 coins")
    landmarks: dict[str, tuple[float, float]] = {}
    for index, landmark_id in CORNERS.items():
        x, y = keypoints[index][:2]
        landmarks[landmark_id] = (x / width, y / height)
    return landmarks


def quality(
    landmarks: dict[str, tuple[float, float]],
    keypoints: list[list[float]],
    width: int,
    height: int,
) -> dict:
    """Mean pixel distance between the derived court lines and the 10 extra keypoints."""
    quad = [landmarks[name] for name in HOMOGRAPHY_IDS]
    if is_degenerate_quad(quad):
        raise ValueError("quadrilatère dégénéré")
    matrix = image_homography(landmarks, HOMOGRAPHY_IDS)
    inverse = np.linalg.inv(matrix)
    errors: list[float] = []
    for index, landmark_id in EXTRA.items():
        if index >= len(keypoints):
            continue
        px, py = keypoints[index][:2]
        projected = apply_homography(inverse, LANDMARKS[landmark_id])
        errors.append(math.hypot(projected[0] * width - px, projected[1] * height - py))
    if not errors:
        return {"meanPx": 0.0, "maxPx": 0.0, "points": 0}
    return {
        "meanPx": round(sum(errors) / len(errors), 2),
        "maxPx": round(max(errors), 2),
        "points": len(errors),
    }
