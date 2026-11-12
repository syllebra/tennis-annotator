import copy

import pytest
from pydantic import ValidationError

from app.schema import Document


def video_info(frame_count: int = 600) -> dict:
    return {
        "fileName": "clip.mp4",
        "sizeBytes": 123,
        "width": 1920,
        "height": 1080,
        "rotation": 0,
        "fpsNominal": 30.0,
        "vfr": False,
        "frameCount": frame_count,
        "fingerprint": {"headSha256": "a", "tailSha256": "b"},
    }


def point(t: int, kind: str = "anchor", tag: str | None = "hand", x: float = 0.5, y: float = 0.5):
    return {"t": t, "x": x, "y": y, "kind": kind, "tag": tag, "source": "manual"}


def trajectory(t_start: int = 10, t_end: int = 30) -> dict:
    return {
        "id": "traj_01",
        "label": "",
        "needsReview": False,
        "notes": "",
        "tStart": t_start,
        "tEnd": t_end,
        "occlusions": [],
        "points": [point(t_start), point(t_end, tag="ground")],
    }


def court() -> dict:
    ids = ["near_left", "near_right", "far_left", "far_right"]
    quad = [(0.2, 0.8), (0.8, 0.8), (0.35, 0.3), (0.65, 0.3)]
    return {
        "preset": "doubles_corners",
        "homographyLandmarks": ids,
        "mirrored": False,
        "keyframes": [
            {
                "t": 0,
                "source": "manual",
                "landmarks": {i: {"x": p[0], "y": p[1]} for i, p in zip(ids, quad)},
            }
        ],
    }


def document() -> dict:
    return {
        "schema": "tennis-annotator/annotations@1",
        "version": 1,
        "video": video_info(),
        "state": {"completed": False, "lastFrame": 0},
        "sequences": [
            {
                "id": "seq_01",
                "label": "S1",
                "tStart": 0,
                "tEnd": 100,
                "court": court(),
                "trajectories": [trajectory()],
            }
        ],
    }


def test_valid_document() -> None:
    doc = Document.model_validate(document())
    assert doc.sequences[0].trajectories[0].tEnd == 30


def test_unsorted_points_are_sorted() -> None:
    data = document()
    data["sequences"][0]["trajectories"][0]["points"] = [
        point(10),
        point(20, kind="path", tag=None),
        point(30, tag="ground"),
    ]
    data["sequences"][0]["trajectories"][0]["points"].reverse()
    doc = Document.model_validate(data)
    assert [p.t for p in doc.sequences[0].trajectories[0].points] == [10, 20, 30]


def test_duplicate_frames_rejected() -> None:
    data = document()
    data["sequences"][0]["trajectories"][0]["points"] = [point(10), point(10, tag="ground")]
    data["sequences"][0]["trajectories"][0]["tEnd"] = 10
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_boundary_must_be_edge() -> None:
    data = document()
    traj = data["sequences"][0]["trajectories"][0]
    traj["points"] = [point(10), point(20, tag="boundary"), point(30, tag="ground")]
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_anchor_requires_tag() -> None:
    data = document()
    data["sequences"][0]["trajectories"][0]["points"] = [point(10, tag=None), point(30)]
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_path_point_forbids_tag() -> None:
    data = document()
    data["sequences"][0]["trajectories"][0]["points"] = [
        point(10),
        point(20, kind="path", tag="hand"),
        point(30),
    ]
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_trajectory_outside_sequence_rejected() -> None:
    data = document()
    data["sequences"][0]["trajectories"][0] = trajectory(10, 200)
    data["sequences"][0]["trajectories"][0]["points"] = [point(10), point(200)]
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_overlapping_sequences_rejected() -> None:
    data = document()
    second = copy.deepcopy(data["sequences"][0])
    second["id"] = "seq_02"
    second["tStart"] = 50
    second["tEnd"] = 200
    second["trajectories"][0]["tStart"] = 50
    second["trajectories"][0]["tEnd"] = 60
    second["trajectories"][0]["points"] = [point(50), point(60)]
    data["sequences"].append(second)
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_occlusions_must_be_sorted_and_disjoint() -> None:
    data = document()
    traj = data["sequences"][0]["trajectories"][0]
    traj["occlusions"] = [{"from": 15, "to": 20}, {"from": 18, "to": 22}]
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_missing_homography_landmark_rejected() -> None:
    data = document()
    del data["sequences"][0]["court"]["keyframes"][0]["landmarks"]["far_right"]
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_tstart_must_match_first_point() -> None:
    data = document()
    data["sequences"][0]["trajectories"][0]["tStart"] = 5
    with pytest.raises(ValidationError):
        Document.model_validate(data)
