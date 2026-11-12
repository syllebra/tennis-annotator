import { courtLinesAt, doublesQuadAt, trajectoryPoint } from './derive';
import type { Point } from './math';
import type { Document, Sequence, Tag } from './types';
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

export function courtLandmarksOf(view: StageView): Record<string, Point> {
  const court = view.sequence?.court;
  if (!court) return {};
  const kf = court.keyframes.find((k) => k.t === view.frame);
  if (!kf) return {};
  const out: Record<string, Point> = {};
  for (const [id, p] of Object.entries(kf.landmarks)) out[id] = [p.x, p.y];
  return out;
}

export function hitTest(view: StageView, x: number, y: number, width: number, height: number): Selection {
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
      for (let i = 0; i < traj.points.length; i++) {
        const p = traj.points[i]!;
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

  if (view.sequence) {
    for (const traj of view.sequence.trajectories) {
      const active = traj.id === view.activeTrajectoryId;
      const samples: Point[] = [];
      const step = Math.max(1, Math.floor((traj.tEnd - traj.tStart) / 800));
      for (let f = traj.tStart; f <= traj.tEnd; f += step) {
        const p = trajectoryPoint(traj, f);
        if (p) samples.push(p);
      }
      const last = trajectoryPoint(traj, traj.tEnd);
      if (last) samples.push(last);
      polyline(
        samples,
        active ? 'rgba(80,255,160,0.95)' : 'rgba(120,220,255,0.35)',
        active ? 2.5 : 1.5,
      );
      for (const occ of traj.occlusions) {
        const points: Point[] = [];
        for (let f = occ.from; f <= occ.to; f++) {
          const p = trajectoryPoint(traj, f);
          if (p) points.push(p);
        }
        polyline(points, 'rgba(255,120,120,0.5)', 5, [4, 4]);
      }
    }

    for (const traj of view.sequence.trajectories) {
      const active = traj.id === view.activeTrajectoryId;
      for (let i = 0; i < traj.points.length; i++) {
        const point = traj.points[i]!;
        const selected =
          view.selection?.kind === 'point' &&
          view.selection.trajectoryId === traj.id &&
          view.selection.index === i;
        const [x, y] = toPx([point.x, point.y]);
        ctx.save();
        ctx.globalAlpha = active || selected ? 1 : 0.45;
        ctx.beginPath();
        if (point.kind === 'path') {
          ctx.fillStyle = '#ffd166';
          ctx.fillRect(x - 3, y - 3, 6, 6);
        } else {
          ctx.fillStyle = TAG_COLORS[point.tag ?? 'other'];
          ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
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
    const nextId = view.wizard.ids[view.wizard.index];
    for (const [id, p] of Object.entries(view.wizard.taken)) {
      const [x, y] = toPx([p.x, p.y]);
      ctx.save();
      ctx.fillStyle = id === nextId ? '#ffd166' : 'rgba(0,220,255,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
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
