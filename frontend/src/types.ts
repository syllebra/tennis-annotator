export type Tag = 'hand' | 'racket' | 'ground' | 'net' | 'other' | 'boundary';
export type Kind = 'anchor' | 'path';
export type Source = 'manual' | 'auto';

export interface XY {
  x: number;
  y: number;
}

export interface Fingerprint {
  headSha256: string;
  tailSha256: string;
}

export interface VideoInfo {
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
  rotation: number;
  fpsNominal: number;
  vfr: boolean;
  frameCount: number;
  fingerprint: Fingerprint;
}

export interface DocState {
  completed: boolean;
  lastFrame: number;
}

export interface CourtKeyframe {
  t: number;
  source: Source;
  landmarks: Record<string, XY>;
}

export interface Court {
  preset: 'doubles_corners' | 'singles_corners' | 'service_boxes';
  homographyLandmarks: string[];
  mirrored: boolean;
  keyframes: CourtKeyframe[];
}

export interface Occlusion {
  from: number;
  to: number;
}

export interface TrajectoryPoint {
  t: number;
  x: number;
  y: number;
  kind: Kind;
  tag?: Tag | null;
  source: Source;
}

export interface Trajectory {
  id: string;
  label: string;
  needsReview: boolean;
  notes: string;
  tStart: number;
  tEnd: number;
  occlusions: Occlusion[];
  points: TrajectoryPoint[];
}

export interface Sequence {
  id: string;
  label: string;
  tStart: number;
  tEnd: number;
  court: Court;
  trajectories: Trajectory[];
}

export interface Document {
  schema: string;
  version: number;
  video: VideoInfo;
  state: DocState;
  sequences: Sequence[];
}

export interface FrameTable {
  width: number;
  height: number;
  rotation: number;
  fpsNominal: number;
  vfr: boolean;
  frameCount: number;
  pts: number[];
  keyframes: number[];
  codec: string;
  duration: number;
}

export interface ProxyStatus {
  state: 'idle' | 'running' | 'done' | 'error' | 'not-needed';
  progress: number;
  error: string | null;
}

export interface VideoMeta {
  id: string;
  fileName: string;
  dir: string;
  table: FrameTable;
  needsProxy: boolean;
  proxy: ProxyStatus;
}

export interface VideoSummary {
  id: string;
  relPath: string;
  name: string;
  sizeBytes: number;
  status: 'new' | 'progress' | 'done' | 'corrupt';
  completed: boolean;
  lastFrame: number;
}

export interface VideoList {
  root: string;
  exists: boolean;
  videos: VideoSummary[];
}

export interface Mismatch {
  matches: boolean;
  reasons: string[];
  blocking: boolean;
}

export interface LoadedAnnotations {
  source: 'new' | 'sidecar';
  document: Document;
  mismatch: Mismatch | null;
  videoInfo?: VideoInfo;
}

export interface BrowseEntry {
  name: string;
  path: string;
  video?: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string;
  entries: BrowseEntry[];
}

export interface DetectorWorker {
  state: 'idle' | 'starting' | 'ready' | 'error' | 'unavailable';
  message: string;
  pid: number | null;
  configured: boolean;
}

export interface DetectorSettings {
  analyzerPath?: string;
  ballThreshold?: number;
  tolerancePx?: number;
  maxPoints?: number;
}

export interface DetectorStatus {
  available: boolean;
  path: string | null;
  source: string;
  checks: Record<string, boolean>;
  models: { court: string | null; ball: string | null };
  interpreter: { command: string[] | null; note: string | null };
  message: string;
  worker: DetectorWorker;
  settings: DetectorSettings;
}

export interface AutoCourtResult {
  frame: number;
  width: number;
  height: number;
  landmarks: Record<string, XY>;
  quality: { meanPx: number; maxPx: number; points: number };
  keypoints: [number, number][];
}

export interface AutoBallResult {
  points: { t: number; x: number; y: number; kind: 'path'; source: 'auto' }[];
  stats: {
    added: number;
    max_error_px: number;
    rms_error_px: number;
    frames_used: number;
    tolerance_px: number;
    max_points: number;
    reached_tolerance: boolean;
    detections: number;
    rejected: number;
    coverage: number;
    displacement_px: number;
  };
  detections: number;
}
