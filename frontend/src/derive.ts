import type { Court, Trajectory } from './types';
import {
  COURT_HALF_LENGTH,
  DOUBLES_HALF_WIDTH,
  COURT_LINES,
  applyH,
  imageHomography,
  invert3,
  isDegenerateQuad,
  precisionRatio,
  sampleKnots,
  type Knot,
  type Mat3,
  type Point,
} from './math';

export function courtKnots(court: Court, landmarkId: string): Knot[] {
  const keys = [...court.keyframes].sort((a, b) => a.t - b.t);
  const out: Knot[] = [];
  for (const kf of keys) {
    const lm = kf.landmarks[landmarkId];
    if (!lm) continue;
    out.push([kf.t, lm.x, lm.y, 'path']);
  }
  return out;
}

export function landmarksAt(court: Court, frame: number): Record<string, Point> {
  const out: Record<string, Point> = {};
  for (const id of court.homographyLandmarks) {
    const knots = courtKnots(court, id);
    if (knots.length) out[id] = sampleKnots(knots, frame);
  }
  return out;
}

export function homographyAt(court: Court, frame: number): Mat3 | null {
  const lm = landmarksAt(court, frame);
  if (Object.keys(lm).length !== 4) return null;
  const quad = court.homographyLandmarks.map((id) => lm[id]!);
  if (quad.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  if (isDegenerateQuad(quad)) return null;
  return imageHomography(lm, court.homographyLandmarks);
}

export function courtLinesAt(court: Court, frame: number): Point[][] | null {
  const H = homographyAt(court, frame);
  if (!H) return null;
  try {
    const Hi = invert3(H);
    return COURT_LINES.map((line) => line.map((p) => applyH(Hi, p)));
  } catch {
    return null;
  }
}

export function doublesQuadAt(court: Court, frame: number): Point[] | null {
  const H = homographyAt(court, frame);
  if (!H) return null;
  try {
    const Hi = invert3(H);
    return [
      applyH(Hi, [-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH]),
      applyH(Hi, [DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH]),
      applyH(Hi, [DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH]),
      applyH(Hi, [-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH]),
    ];
  } catch {
    return null;
  }
}

export function precisionAt(court: Court, frame: number): number {
  const lm = landmarksAt(court, frame);
  if (Object.keys(lm).length !== 4) return 0;
  if (isDegenerateQuad(court.homographyLandmarks.map((id) => lm[id]!))) return 0;
  try {
    return precisionRatio(lm, court.homographyLandmarks);
  } catch {
    return 0;
  }
}

export function trajectoryKnots(traj: Trajectory): Knot[] {
  return traj.points.map((p) => [p.t, p.x, p.y, p.kind] as Knot);
}

export function trajectoryPoint(traj: Trajectory, frame: number): Point | null {
  if (frame < traj.tStart || frame > traj.tEnd || traj.points.length === 0) return null;
  return sampleKnots(trajectoryKnots(traj), frame);
}

export function isOccluded(traj: Trajectory, frame: number): boolean {
  return traj.occlusions.some((o) => frame >= o.from && frame <= o.to);
}

export function keyframeAt(court: Court, frame: number) {
  return court.keyframes.find((kf) => kf.t === frame) ?? null;
}
