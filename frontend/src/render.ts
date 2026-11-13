import { courtLinesAt, doublesQuadAt, trajectoryPoint } from './derive';
import type { Point } from './math';
import type { Document, Sequence, Tag, Trajectory } from './types';
import type { Selection, WizardState } from './store';

export interface StageView {
  doc: Document;
  sequence: Sequence | null;
  frame: number;
  selection: Selection;
  showCourt: boolean;
  wizard: WizardState | null;
  activeTrajectoryId: string | null;
  occlusionStart: number | null;
  verify: boolean;
}

export const TAG_COLORS: Record<Tag, string> = {
  hand: '#ff7b72',
  racket: '#ffa657',
  ground: '#7ee787',
  net: '#79c0ff',
  other: '#d2a8ff',
  boundary: '#8b949e',
};

export const TAG_LABELS: Record<Tag, string> = {
  hand: 'Main',
  racket: 'Raquette',
  ground: 'Sol',
  net: 'Filet',
  other: 'Autre',
  boundary: 'Bord',
};

const POINT_RADIUS = 4.5;
const HIT_RADIUS = 11;

const finite = (points: Point[]): boolean =>
  points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 50 && Math.abs(p[1]) < 50);

/**
 * Which part of an échange is "current" around a frame.
 *
 * The segment being annotated stays fully visible, the two segments before and
 * after are dimmed, everything else is hidden (points included) so the eye is
 * not pulled by the rest of the rally.
 */
export interface SegmentView {
  anchors: number[];
  index: number;
  count: number;
  from: number;
  to: number;
  opacity: (segment: number) => number;
  pointVisible: (frame: number) => boolean;
}

export function segmentView(traj: Trajectory, frame: number): SegmentView {
  const anchors = traj.points
    .filter((p) => p.kind === 'anchor')
    .map((p) => p.t)
    .sort((a, b) => a - b);
  const count = Math.max(0, anchors.length - 1);
  if (count === 0) {
    const single = anchors[0] ?? traj.tStart;
    return {
      anchors,
      index: -1,
      count: 0,
      from: single,
      to: single,
      opacity: () => 1,
      pointVisible: () => true,
    };
  }
  const clamped = Math.min(Math.max(frame, anchors[0]!), anchors[anchors.length - 1]!);
  let index = 0;
  for (let i = 0; i < count; i++) {
    if (anchors[i]! <= clamped) index = i;
  }
  const from = anchors[Math.max(0, index - 2)]!;
  const to = anchors[Math.min(anchors.length - 1, index + 3)]!;
  return {
    anchors,
    index,
    count,
    from,
    to,
    opacity: (segment) => {
      if (segment < 0 || segment >= count) return 0;
      const distance = Math.abs(segment - index);
      if (distance === 0) return 1;
      if (distance === 1) return 0.42;
      if (distance === 2) return 0.18;
      return 0;
    },
    pointVisible: (t: number) => t >= from && t <= to,
  };
}

export function courtLandmarksOf(view: StageView): Record<string, Point> {
  const court = view.sequence?.court;
  if (!court) return {};
  const kf = court.keyframes.find((k) => k.t === view.frame);
  if (!kf) return {};
  const out: Record<string, Point> = {};
  for (const [id, p] of Object.entries(kf.landmarks)) out[id] = [p.x, p.y];
  return out;
}

export function hitTest(
  view: StageView,
  x: number,
  y: number,
  width: number,
  height: number,
): Selection {
  let best: Selection = null;
  let bestDistance = HIT_RADIUS;

  const consider = (ratio: Point, selection: Selection) => {
    const dx = ratio[0] * width - x;
    const dy = ratio[1] * height - y;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = selection;
    }
  };

  for (const [id, p] of Object.entries(courtLandmarksOf(view))) {
    consider(p, { kind: 'landmark', landmarkId: id });
  }
  if (view.sequence) {
    for (const traj of view.sequence.trajectories) {
      const active = traj.id === view.activeTrajectoryId;
      const segments = active ? segmentView(traj, view.frame) : null;
      for (let i = 0; i < traj.points.length; i++) {
        const p = traj.points[i]!;
        if (segments && !segments.pointVisible(p.t)) continue;
        consider([p.x, p.y], { kind: 'point', trajectoryId: traj.id, index: i });
      }
    }
  }
  return best;
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: StageView,
): void {
  // NOTE: never clear here — the caller composites video/frame underneath.
  const toPx = (p: Point): Point => [p[0] * width, p[1] * height];

  const polyline = (points: Point[], color: string, lineWidth: number, dash: number[] = []) => {
    if (points.length < 2 || !finite(points)) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = toPx(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  };

  if (view.sequence && view.showCourt) {
    const lines = courtLinesAt(view.sequence.court, view.frame);
    if (lines) {
      for (const line of lines) polyline(line, 'rgba(255,214,0,0.85)', 2);
      const quad = doublesQuadAt(view.sequence.court, view.frame);
      if (quad) polyline([...quad, quad[0]!], 'rgba(0,220,255,0.45)', 1, [6, 6]);
    }
  }

  const sampleSegment = (traj: Trajectory, from: number, to: number): Point[] => {
    const points: Point[] = [];
    const span = Math.max(1, to - from);
    const step = Math.max(1, Math.floor(span / 120));
    for (let f = from; f <= to; f += step) {
      const p = trajectoryPoint(traj, f);
      if (p) points.push(p);
    }
    const last = trajectoryPoint(traj, to);
    if (last) points.push(last);
    return points;
  };

  if (view.sequence) {
    for (const traj of view.sequence.trajectories) {
      const active = traj.id === view.activeTrajectoryId;

      if (!active) {
        const samples = sampleSegment(traj, traj.tStart, traj.tEnd);
        polyline(samples, 'rgba(120,220,255,0.28)', 1.5);
        for (let i = 0; i < traj.points.length; i++) {
          const point = traj.points[i]!;
          const [x, y] = toPx([point.x, point.y]);
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          if (point.kind === 'path') {
            ctx.fillStyle = '#ffd166';
            ctx.fillRect(x - 3, y - 3, 6, 6);
          } else {
            ctx.fillStyle = TAG_COLORS[point.tag ?? 'other'];
            ctx.arc(x, y, POINT_RADIUS - 1, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
        continue;
      }

      const segments = segmentView(traj, view.frame);
      for (let i = 0; i < segments.count; i++) {
        const alpha = segments.opacity(i);
        if (alpha <= 0) continue;
        const from = segments.anchors[i]!;
        const to = segments.anchors[i + 1]!;
        ctx.save();
        ctx.globalAlpha = alpha;
        polyline(sampleSegment(traj, from, to), 'rgb(80,255,160)', i === segments.index ? 2.6 : 2);
        ctx.restore();
      }

      for (const occ of traj.occlusions) {
        const points: Point[] = [];
        for (let f = occ.from; f <= occ.to; f++) {
          if (!segments.pointVisible(f)) continue;
          const p = trajectoryPoint(traj, f);
          if (p) points.push(p);
        }
        if (points.length > 1) polyline(points, 'rgba(255,120,120,0.5)', 5, [4, 4]);
      }

      for (let i = 0; i < traj.points.length; i++) {
        const point = traj.points[i]!;
        if (!segments.pointVisible(point.t)) continue;
        const selected =
          view.selection?.kind === 'point' &&
          view.selection.trajectoryId === traj.id &&
          view.selection.index === i;
        const segmentStart = segments.anchors[segments.index] ?? -Infinity;
        const segmentEnd = segments.anchors[segments.index + 1] ?? Infinity;
        const inCurrentSegment = point.t >= segmentStart && point.t <= segmentEnd;
        const faded = inCurrentSegment ? 1 : 0.5;
        const [x, y] = toPx([point.x, point.y]);
        ctx.save();
        ctx.globalAlpha = faded;
        ctx.beginPath();
        if (point.kind === 'path') {
          ctx.fillStyle = '#ffd166';
          ctx.fillRect(x - 3, y - 3, 6, 6);
        } else {
          ctx.fillStyle = TAG_COLORS[point.tag ?? 'other'];
          ctx.arc(x, y, POINT_RADIUS + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (selected) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, POINT_RADIUS + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (view.verify && view.sequence) {
      const active = view.sequence.trajectories.find((t) => t.id === view.activeTrajectoryId);
      const position = active ? trajectoryPoint(active, view.frame) : null;
      if (position) {
        const [x, y] = toPx(position);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 24, y);
        ctx.lineTo(x + 24, y);
        ctx.moveTo(x, y - 24);
        ctx.lineTo(x, y + 24);
        ctx.stroke();
        ctx.restore();
      }
    }

    const landmarks = courtLandmarksOf(view);
    for (const [id, p] of Object.entries(landmarks)) {
      const selected = view.selection?.kind === 'landmark' && view.selection.landmarkId === id;
      const [x, y] = toPx(p);
      ctx.save();
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,220,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, selected ? 8 : 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (view.wizard) {
    for (const [id, p] of Object.entries(view.wizard.taken)) {
      const order = view.wizard.ids.indexOf(id);
      const [x, y] = toPx([p.x, p.y]);
      ctx.save();
      ctx.fillStyle = 'rgba(0,220,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d1117';
      ctx.font = '600 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(order + 1), x, y + 0.5);
      ctx.restore();
    }
  }

  if (view.occlusionStart !== null && view.frame === view.occlusionStart) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,120,120,0.9)';
    ctx.fillRect(0, 0, width, 4);
    ctx.restore();
  }
}
