"""Generate the cross-language conformance fixtures.

The Python implementation is the reference (it drives export and the CLI);
`frontend/tests/math.test.ts` replays every case through the TypeScript copy.

Run: uv run python scripts/gen_fixtures.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import geometry  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "conformance.json"


def curve_cases() -> list[dict]:
    knot_sets = [
        [(0, 0.5, 0.5, "anchor"), (30, 0.6, 0.4, "anchor")],
        [
            (0, 0.10, 0.90, "anchor"),
            (12, 0.30, 0.70, "path"),
            (20, 0.55, 0.45, "anchor"),
            (27, 0.62, 0.30, "path"),
            (45, 0.90, 0.10, "anchor"),
        ],
        [
            (5, 0.2, 0.2, "anchor"),
            (6, 0.8, 0.8, "anchor"),
            (7, 0.2, 0.8, "anchor"),
        ],
        [(-3, 0.4, 0.6, "path"), (0, 0.3, 0.5, "anchor"), (100, 0.7, 0.2, "anchor")],
    ]
    cases = []
    for knots in knot_sets:
        first = knots[0][0]
        last = knots[-1][0]
        frames = sorted({first + i for i in range(last - first + 1)})
        samples = [[f, *geometry.sample_knots(knots, float(f))] for f in frames]
        cases.append({"knots": [list(k) for k in knots], "samples": samples})
    return cases


def linear_cases() -> list[dict]:
    knot_sets = [
        [(0, 0.10, 0.90, "path"), (20, 0.50, 0.40, "path")],
        [(0, 0.20, 0.80, "path"), (10, 0.40, 0.60, "path"), (25, 0.90, 0.30, "path")],
        [(5, 0.30, 0.30, "path")],
    ]
    cases = []
    for knots in knot_sets:
        first, last = knots[0][0], knots[-1][0]
        samples = []
        frame = float(first)
        while frame <= last + 1e-9:
            samples.append([frame, *geometry.sample_linear(knots, frame)])
            frame += 2.5
        cases.append({"knots": [list(k) for k in knots], "samples": samples})
    return cases


def homography_cases() -> list[dict]:
    image_quads = [
        [(0.20, 0.90), (0.80, 0.90), (0.65, 0.25), (0.35, 0.25)],
        [(0.05, 0.95), (0.95, 0.95), (0.70, 0.10), (0.30, 0.10)],
        [(0.40, 0.98), (0.60, 0.98), (0.55, 0.20), (0.45, 0.20)],
        [(0.12, 0.70), (0.88, 0.78), (0.70, 0.42), (0.30, 0.34)],
    ]
    court_quad = [
        geometry.LANDMARKS["near_left"],
        geometry.LANDMARKS["near_right"],
        geometry.LANDMARKS["far_right"],
        geometry.LANDMARKS["far_left"],
    ]
    cases = []
    for quad in image_quads:
        H = geometry.homography(quad, court_quad)
        cases.append(
            {
                "image": [list(p) for p in quad],
                "court": [list(p) for p in court_quad],
                "check": [[0.5, 0.5], [0.3, 0.7], [0.7, 0.3], [0.45, 0.55]],
                "mapped": [list(geometry.apply_homography(H, p)) for p in [(0.5, 0.5), (0.3, 0.7), (0.7, 0.3), (0.45, 0.55)]],
            }
        )
    return cases


def precision_cases() -> list[dict]:
    cases = []
    for preset, image_quad in (
        ("doubles_corners", [(0.2, 0.9), (0.8, 0.9), (0.65, 0.25), (0.35, 0.25)]),
        ("singles_corners", [(0.2, 0.9), (0.8, 0.9), (0.65, 0.25), (0.35, 0.25)]),
        ("service_boxes", [(0.2, 0.9), (0.8, 0.9), (0.65, 0.25), (0.35, 0.25)]),
    ):
        ids = geometry.PRESETS[preset]
        H = geometry.homography([geometry.LANDMARKS[i] for i in ids], image_quad)
        landmarks = {
            i: list(geometry.apply_homography(H, geometry.LANDMARKS[i])) for i in ids
        }
        cases.append(
            {
                "ids": ids,
                "landmarks": landmarks,
                "ratio": geometry.precision_ratio(
                    {k: tuple(v) for k, v in landmarks.items()}, ids
                ),
            }
        )
    return cases


def main() -> None:
    fixtures = {
        "landmarks": {k: list(v) for k, v in geometry.LANDMARKS.items()},
        "presets": geometry.PRESETS,
        "court_lines": [[list(p) for p in line] for line in geometry.COURT_LINES],
        "curves": curve_cases(),
        "linear": linear_cases(),
        "homographies": homography_cases(),
        "precision": precision_cases(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixtures, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
