/**
 * Court geometry, mirrored from `backend/app/geometry.py`.
 * Parity is enforced by the conformance fixture test (tests/math.test.ts).
 */

export type Point = [number, number];
export type Knot = [t: number, x: number, y: number, kind: 'anchor' | 'path'];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const COURT_HALF_LENGTH = 23.77 / 2;
export const DOUBLES_HALF_WIDTH = 10.97 / 2;
export const SINGLES_HALF_WIDTH = 8.23 / 2;
export const SERVICE_LINE_DISTANCE = 6.4;
export const NET_POST_HALF_WIDTH = 6.4;

export const LANDMARKS: Record<string, Point> = {
  near_left: [-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH],
  near_right: [DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH],
  far_left: [-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH],
  far_right: [DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH],
  singles_near_left: [-SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH],
  singles_near_right: [SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH],
  singles_far_left: [-SINGLES_HALF_WIDTH, COURT_HALF_LENGTH],
  singles_far_right: [SINGLES_HALF_WIDTH, COURT_HALF_LENGTH],
  service_line_near_left: [-SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE],
  service_line_near_right: [SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE],
  service_line_far_left: [-SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE],
  service_line_far_right: [SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE],
  service_line_near_center: [0, -SERVICE_LINE_DISTANCE],
  service_line_far_center: [0, SERVICE_LINE_DISTANCE],
  net_center: [0, 0],
  net_line_left: [-SINGLES_HALF_WIDTH, 0],
  net_line_right: [SINGLES_HALF_WIDTH, 0],
  net_post_left: [-NET_POST_HALF_WIDTH, 0],
  net_post_right: [NET_POST_HALF_WIDTH, 0],
};

export const LANDMARK_LABELS: Record<string, string> = {
  near_left: 'Coin double gauche (proche)',
  near_right: 'Coin double droit (proche)',
  far_left: 'Coin double gauche (loin)',
  far_right: 'Coin double droit (loin)',
  singles_near_left: 'Coin simple gauche (proche)',
  singles_near_right: 'Coin simple droit (proche)',
  singles_far_left: 'Coin simple gauche (loin)',
  singles_far_right: 'Coin simple droit (loin)',
  service_line_near_left: 'Ligne service gauche (proche)',
  service_line_near_right: 'Ligne service droite (proche)',
  service_line_far_left: 'Ligne service gauche (loin)',
  service_line_far_right: 'Ligne service droite (loin)',
  service_line_near_center: 'Ligne service centre (proche)',
  service_line_far_center: 'Ligne service centre (loin)',
  net_center: 'Centre du filet',
  net_line_left: 'Filet / ligne simple gauche',
  net_line_right: 'Filet / ligne simple droite',
  net_post_left: 'Poteau gauche',
  net_post_right: 'Poteau droit',
};

export const PRESETS: Record<string, string[]> = {
  doubles_corners: ['near_left', 'near_right', 'far_right', 'far_left'],
  singles_corners: ['singles_near_left', 'singles_near_right', 'singles_far_right', 'singles_far_left'],
  service_boxes: ['net_center', 'net_line_left', 'service_line_near_left', 'service_line_near_center'],
};

export const COURT_LINES: Point[][] = [
  [
    [-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH],
    [DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH],
    [DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH],
    [-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH],
    [-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH],
  ],
  [
    [-SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH],
    [-SINGLES_HALF_WIDTH, COURT_HALF_LENGTH],
  ],
  [
    [SINGLES_HALF_WIDTH, -COURT_HALF_LENGTH],
    [SINGLES_HALF_WIDTH, COURT_HALF_LENGTH],
  ],
  [
    [-SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE],
    [SINGLES_HALF_WIDTH, -SERVICE_LINE_DISTANCE],
  ],
  [
    [-SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE],
    [SINGLES_HALF_WIDTH, SERVICE_LINE_DISTANCE],
  ],
  [
    [0, -SERVICE_LINE_DISTANCE],
    [0, SERVICE_LINE_DISTANCE],
  ],
  [
    [-NET_POST_HALF_WIDTH, 0],
    [NET_POST_HALF_WIDTH, 0],
  ],
  [
    [0, -COURT_HALF_LENGTH],
    [0, -COURT_HALF_LENGTH + 0.1],
  ],
  [
    [0, COURT_HALF_LENGTH],
    [0, COURT_HALF_LENGTH - 0.1],
  ],
];

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const div = (a: Point, k: number): Point => [a[0] / k, a[1] / k];

function pointOf(knots: Knot[], i: number): Point {
  return [knots[i]![1], knots[i]![2]];
}

function central(knots: Knot[], i: number): Point {
  const t = knots[i]![0];
  const p = pointOf(knots, i);
  if (i > 0 && i < knots.length - 1) {
    const prev = knots[i - 1]!;
    const next = knots[i + 1]!;
    return div(sub([next[1], next[2]], [prev[1], prev[2]]), next[0] - prev[0]);
  }
  if (i === 0 && knots.length > 1) {
    const next = knots[1]!;
    return div(sub([next[1], next[2]], p), next[0] - t);
  }
  if (i === knots.length - 1 && i > 0) {
    const prev = knots[i - 1]!;
    return div(sub(p, [prev[1], prev[2]]), t - prev[0]);
  }
  return [0, 0];
}

function outgoing(knots: Knot[], i: number): Point {
  if (knots[i]![3] === 'path' || i === knots.length - 1) return central(knots, i);
  const next = knots[i + 1]!;
  return div(sub([next[1], next[2]], pointOf(knots, i)), next[0] - knots[i]![0]);
}

function incoming(knots: Knot[], i: number): Point {
  if (knots[i]![3] === 'path' || i === 0) return central(knots, i);
  const prev = knots[i - 1]!;
  return div(sub(pointOf(knots, i), [prev[1], prev[2]]), knots[i]![0] - prev[0]);
}

export function hermite(p0: Point, m0: Point, p1: Point, m1: Point, u: number): Point {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return [
    h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0],
    h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1],
  ];
}

export function sampleKnots(knots: Knot[], t: number): Point {
  if (knots.length === 0) throw new Error('empty curve');
  if (knots.length === 1) return pointOf(knots, 0);
  if (t <= knots[0]![0]) return pointOf(knots, 0);
  if (t >= knots[knots.length - 1]![0]) return pointOf(knots, knots.length - 1);

  let lo = 0;
  let hi = knots.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = knots[lo]![0];
  const t1 = knots[hi]![0];
  const h = t1 - t0;
  const u = (t - t0) / h;
  const m0 = scale(outgoing(knots, lo), h);
  const m1 = scale(incoming(knots, hi), h);
  return hermite(pointOf(knots, lo), m0, pointOf(knots, hi), m1, u);
}

/**
 * Straight-line interpolation between knots.
 * Used for court poses: camera motion must not overshoot between two poses.
 */
export function sampleLinear(knots: Knot[], t: number): Point {
  if (knots.length === 0) throw new Error('empty curve');
  if (knots.length === 1) return pointOf(knots, 0);
  if (t <= knots[0]![0]) return pointOf(knots, 0);
  if (t >= knots[knots.length - 1]![0]) return pointOf(knots, knots.length - 1);

  let lo = 0;
  let hi = knots.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = knots[lo]![0];
  const t1 = knots[hi]![0];
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const p0 = pointOf(knots, lo);
  const p1 = pointOf(knots, hi);
  return [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u];
}

// --- homography -----------------------------------------------------------

function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]![col]!;
    for (let j = col; j <= n; j++) a[col]![j] = a[col]![j]! / p;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) a[row]![j] = a[row]![j]! - factor * a[col]![j]!;
    }
  }
  return a.map((row) => row[n]!);
}

function normalise(points: Point[]): { pts: Point[]; T: Mat3 } {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const meanDist =
    points.reduce((sum, p) => sum + Math.hypot(p[0] - cx, p[1] - cy), 0) / points.length;
  const s = meanDist > 1e-12 ? Math.SQRT2 / meanDist : 1;
  return {
    pts: points.map(([x, y]) => [s * (x - cx), s * (y - cy)]),
    T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1],
  };
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[r * 3 + k]! * b[k * 3 + c]!;
      out[r * 3 + c] = sum;
    }
  }
  return out;
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) throw new Error('singular matrix');
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

export function homography(src: Point[], dst: Point[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('homography needs 4 points');
  const s = normalise(src);
  const d = normalise(dst);
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = s.pts[k]!;
    const [u, v] = d.pts[k]!;
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y]);
    rhs.push(-u);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y]);
    rhs.push(-v);
  }
  const h = solve(A, rhs);
  if (!h) throw new Error('degenerate homography');
  const Hn: Mat3 = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
  const H = multiply(multiply(invert3(d.T), Hn), s.T);
  const w = H[8];
  return Math.abs(w) > 1e-12 ? (H.map((v) => v / w) as Mat3) : H;
}

export function applyH(H: Mat3, p: Point): Point {
  const x = H[0] * p[0] + H[1] * p[1] + H[2];
  const y = H[3] * p[0] + H[4] * p[1] + H[5];
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  if (Math.abs(w) < 1e-12) return [Infinity, Infinity];
  return [x / w, y / w];
}

export function ringOrder(points: Point[]): Point[] {
  if (points.length < 3) return [...points];
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

export function quadArea(points: Point[]): number {
  const ring = ringOrder(points);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function isDegenerateQuad(points: Point[], minArea = 1e-6): boolean {
  if (points.length !== 4) return true;
  const ring = ringOrder(points);
  if (quadArea(ring) < minArea) return true;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(ring[i]![0] - ring[j]![0], ring[i]![1] - ring[j]![1]) < 1e-4) return true;
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % 4]!;
    const c = ring[(i + 2) % 4]!;
    const ab: Point = [b[0] - a[0], b[1] - a[1]];
    const bc: Point = [c[0] - b[0], c[1] - b[1]];
    const cross = Math.abs(ab[0] * bc[1] - ab[1] * bc[0]);
    const na = Math.hypot(ab[0], ab[1]);
    const nb = Math.hypot(bc[0], bc[1]);
    if (na > 0 && nb > 0 && cross / (na * nb) < 1e-4) return true;
  }
  return false;
}

export function imageHomography(landmarks: Record<string, Point>, ids: string[]): Mat3 {
  const src = ids.map((id) => landmarks[id]!);
  const dst = ids.map((id) => LANDMARKS[id]!);
  return homography(src, dst);
}

/** Court-image annotation quality: annotated quad / whole doubles court, in image space. */
export function precisionRatio(landmarks: Record<string, Point>, ids: string[]): number {
  const H = imageHomography(landmarks, ids);
  const Hi = invert3(H);
  const full: Point[] = [
    applyH(Hi, [-DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH]),
    applyH(Hi, [DOUBLES_HALF_WIDTH, -COURT_HALF_LENGTH]),
    applyH(Hi, [DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH]),
    applyH(Hi, [-DOUBLES_HALF_WIDTH, COURT_HALF_LENGTH]),
  ];
  const fullArea = quadArea(full);
  if (fullArea <= 1e-12) return 0;
  return quadArea(ids.map((id) => landmarks[id]!)) / fullArea;
}
