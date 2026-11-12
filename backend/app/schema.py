"""Annotation document schema (single source of truth).

JSON is camelCase so the TypeScript frontend consumes it as-is.
Numbers are ratios of the displayed (post-rotation) frame size.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import geometry

Tag = Literal["hand", "racket", "ground", "net", "other", "boundary"]
Kind = Literal["anchor", "path"]
Source = Literal["manual", "auto"]
Preset = Literal["doubles_corners", "singles_corners", "service_boxes"]

SCHEMA_ID = "tennis-annotator/annotations@1"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class XY(Strict):
    x: float
    y: float


class Fingerprint(Strict):
    headSha256: str
    tailSha256: str


class VideoInfo(Strict):
    fileName: str
    sizeBytes: int
    width: int
    height: int
    rotation: int = 0
    fpsNominal: float
    vfr: bool = False
    frameCount: int
    fingerprint: Fingerprint


class DocState(Strict):
    completed: bool = False
    lastFrame: int = 0


class CourtKeyframe(Strict):
    t: int
    source: Source = "manual"
    landmarks: dict[str, XY]

    @model_validator(mode="after")
    def _check(self) -> "CourtKeyframe":
        for key in self.landmarks:
            if key not in geometry.LANDMARKS:
                raise ValueError(f"unknown landmark id: {key}")
        return self


class Court(Strict):
    preset: Preset = "doubles_corners"
    homographyLandmarks: list[str]
    mirrored: bool = False
    keyframes: list[CourtKeyframe] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Court":
        ids = self.homographyLandmarks
        if len(ids) != 4 or len(set(ids)) != 4:
            raise ValueError("homographyLandmarks must contain exactly 4 distinct ids")
        if any(i not in geometry.LANDMARKS for i in ids):
            raise ValueError("homographyLandmarks contains an unknown landmark id")
        for kf in self.keyframes:
            missing = [i for i in ids if i not in kf.landmarks]
            if missing:
                raise ValueError(f"court keyframe at t={kf.t} is missing landmarks {missing}")
        self.keyframes.sort(key=lambda k: k.t)
        if len({k.t for k in self.keyframes}) != len(self.keyframes):
            raise ValueError("duplicate court keyframe times")
        return self


class Occlusion(Strict):
    start: int = Field(alias="from")
    end: int = Field(alias="to")
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class TrajectoryPoint(Strict):
    t: int
    x: float
    y: float
    kind: Kind
    tag: Tag | None = None
    source: Source = "manual"

    @model_validator(mode="after")
    def _check(self) -> "TrajectoryPoint":
        if self.kind == "anchor" and self.tag is None:
            raise ValueError(f"anchor at t={self.t} requires a tag")
        if self.kind == "path" and self.tag is not None:
            raise ValueError(f"path point at t={self.t} must not carry a tag")
        return self


class Trajectory(Strict):
    id: str
    label: str = ""
    needsReview: bool = False
    notes: str = ""
    tStart: int
    tEnd: int
    occlusions: list[Occlusion] = Field(default_factory=list)
    points: list[TrajectoryPoint] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Trajectory":
        if not self.points:
            raise ValueError(f"trajectory {self.id} has no points")
        self.points.sort(key=lambda p: p.t)
        times = [p.t for p in self.points]
        if len(set(times)) != len(times):
            raise ValueError(f"trajectory {self.id} has duplicate frame numbers")
        if self.points[0].kind != "anchor" or self.points[-1].kind != "anchor":
            raise ValueError(f"trajectory {self.id} must start and end with an anchor")
        for i, p in enumerate(self.points):
            if p.tag == "boundary" and i not in (0, len(self.points) - 1):
                raise ValueError(
                    f"trajectory {self.id}: boundary tag only allowed on first/last anchor"
                )
        if times[0] != self.tStart or times[-1] != self.tEnd:
            raise ValueError(
                f"trajectory {self.id}: tStart/tEnd must match first/last point frames"
            )
        prev_end = -1
        for occ in self.occlusions:
            if occ.start > occ.end:
                raise ValueError(f"trajectory {self.id}: occlusion from > to")
            if occ.start < self.tStart or occ.end > self.tEnd:
                raise ValueError(f"trajectory {self.id}: occlusion outside trajectory range")
            if occ.start <= prev_end:
                raise ValueError(f"trajectory {self.id}: occlusions must be sorted and disjoint")
            prev_end = occ.end
        return self


class Sequence(Strict):
    id: str
    label: str = ""
    tStart: int
    tEnd: int
    court: Court
    trajectories: list[Trajectory] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Sequence":
        if self.tStart > self.tEnd:
            raise ValueError(f"sequence {self.id}: tStart > tEnd")
        for kf in self.court.keyframes:
            if not (self.tStart <= kf.t <= self.tEnd):
                raise ValueError(f"sequence {self.id}: court keyframe at t={kf.t} outside range")
        for traj in self.trajectories:
            if traj.tStart < self.tStart or traj.tEnd > self.tEnd:
                raise ValueError(f"sequence {self.id}: trajectory {traj.id} outside range")
        return self


class Document(Strict):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schemaId: str = Field(default=SCHEMA_ID, alias="schema")
    version: int = 1
    video: VideoInfo
    state: DocState = Field(default_factory=DocState)
    sequences: list[Sequence] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Document":
        if self.schemaId != SCHEMA_ID:
            raise ValueError(f"unsupported schema: {self.schemaId}")
        if self.version != 1:
            raise ValueError(f"unsupported version: {self.version}")
        seqs = sorted(self.sequences, key=lambda s: s.tStart)
        seen: set[str] = set()
        prev_end = -1
        for seq in seqs:
            if seq.id in seen:
                raise ValueError(f"duplicate sequence id: {seq.id}")
            seen.add(seq.id)
            if seq.tStart <= prev_end:
                raise ValueError(f"sequence {seq.id} overlaps the previous sequence")
            prev_end = seq.tEnd
        return self


def new_document(video: VideoInfo) -> Document:
    """A fresh document has no sequence: the user draws a time range first."""
    return Document(video=video, sequences=[])


def dump_document(doc: Document) -> dict:
    return doc.model_dump(by_alias=True, exclude_none=False)
