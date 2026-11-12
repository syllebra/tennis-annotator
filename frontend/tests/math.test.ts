import { describe, expect, it } from 'vitest';
import fixtures from '../../tests/fixtures/conformance.json';
import {
  COURT_LINES,
  LANDMARKS,
  PRESETS,
  applyH,
  homography,
  precisionRatio,
  sampleKnots,
  type Knot,
  type Point,
} from '../src/math';
import { courtKnots, homographyAt, trajectoryPoint } from '../src/derive';
import type { Court, Trajectory } from '../src/types';

const data = fixtures as unknown as {
  landmarks: Record<string, [number, number]>;
  presets: Record<string, string[]>;
  court_lines: [number, number][][];
  curves: { knots: [number, number, number, string][]; samples: [number, number, number][] }[];
  homographies: {
    image: [number, number][];
    court: [number, number][];
    check: [number, number][];
    mapped: [number, number][];
  }[];
  precision: { ids: string[]; landmarks: Record<string, [number, number]>; ratio: number }[];
};

describe('court catalogue', () => {
  it('matches the python landmark table', () => {
    expect(LANDMARKS).toEqual(data.landmarks);
  });

  it('matches the presets', () => {
    expect(PRESETS).toEqual(data.presets);
  });

  it('matches the court line polylines', () => {
    expect(COURT_LINES).toEqual(data.court_lines);
  });
});

describe('spline parity', () => {
  it.each(data.curves.map((c, i) => [i, c] as const))('curve %i', (_index, curve) => {
    const knots = curve.knots as unknown as Knot[];
    for (const [frame, x, y] of curve.samples) {
      const [sx, sy] = sampleKnots(knots, frame);
      expect(sx).toBeCloseTo(x, 12);
      expect(sy).toBeCloseTo(y, 12);
    }
  });
});

describe('homography parity', () => {
  it.each(data.homographies.map((c, i) => [i, c] as const))('case %i', (_index, item) => {
    const H = homography(item.image as Point[], item.court as Point[]);
    item.check.forEach((point, index) => {
      const [x, y] = applyH(H, point as Point);
      expect(x).toBeCloseTo(item.mapped[index]![0], 6);
      expect(y).toBeCloseTo(item.mapped[index]![1], 6);
    });
  });

  it.each(data.precision.map((c, i) => [i, c] as const))('precision case %i', (_index, item) => {
    const landmarks: Record<string, Point> = {};
    for (const [id, point] of Object.entries(item.landmarks)) landmarks[id] = point as Point;
    expect(precisionRatio(landmarks, item.ids)).toBeCloseTo(item.ratio, 9);
  });
});

describe('derive helpers', () => {
  const court: Court = {
    preset: 'doubles_corners',
    homographyLandmarks: PRESETS.doubles_corners!,
    mirrored: false,
    keyframes: [
      {
        t: 0,
        source: 'manual',
        landmarks: {
          near_left: { x: 0.2, y: 0.9 },
          near_right: { x: 0.8, y: 0.9 },
          far_right: { x: 0.65, y: 0.25 },
          far_left: { x: 0.35, y: 0.25 },
        },
      },
    ],
  };

  it('interpolates a static court', () => {
    const H0 = homographyAt(court, 0);
    const H100 = homographyAt(court, 100);
    expect(H0).not.toBeNull();
    expect(H100).not.toBeNull();
    expect(H0![0]).toBeCloseTo(H100![0], 9);
  });

  it('samples a trajectory only inside its range', () => {
    const traj = {
      id: 't1',
      label: '',
      needsReview: false,
      notes: '',
      tStart: 10,
      tEnd: 20,
      occlusions: [],
      points: [
        { t: 10, x: 0.1, y: 0.1, kind: 'anchor', tag: 'other', source: 'manual' },
        { t: 20, x: 0.9, y: 0.9, kind: 'anchor', tag: 'ground', source: 'manual' },
      ],
    } as Trajectory;
    expect(trajectoryPoint(traj, 9)).toBeNull();
    expect(trajectoryPoint(traj, 10)).toEqual([0.1, 0.1]);
    expect(trajectoryPoint(traj, 21)).toBeNull();
    expect(courtKnots(court, 'near_left')).toEqual([[0, 0.2, 0.9, 'path']]);
  });
});
