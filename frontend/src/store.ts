import { create } from 'zustand';
import { api } from './api';
import { PRESETS } from './math';
import type {
  Document,
  Mismatch,
  Sequence,
  Tag,
  Trajectory,
  TrajectoryPoint,
  VideoMeta,
  VideoSummary,
  XY,
} from './types';

export type Tool = 'select' | 'court' | 'anchor' | 'path';

export type Selection =
  | { kind: 'point'; trajectoryId: string; index: number }
  | { kind: 'landmark'; landmarkId: string }
  | null;

export interface WizardState {
  ids: string[];
  taken: Record<string, XY>;
  index: number;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'dirty' | 'error' | 'conflict';

/** Last pointer position over the stage, in image ratios (not reactive on purpose). */
export const hoverState: XY = { x: 0.5, y: 0.5 };

const MAX_UNDO = 100;
let saveTimer: number | null = null;
let proxyTimer: number | null = null;
let dragBase: Document | null = null;
let dragMoved = false;
let pendingFrame: number | null = null;
let frameRaf = 0;

interface AppState {
  ready: boolean;
  root: string;
  libraryExists: boolean;
  videos: VideoSummary[];

  activeId: string | null;
  meta: VideoMeta | null;
  doc: Document | null;
  mismatch: Mismatch | null;

  currentFrame: number;
  selection: Selection;
  activeTrajectoryId: string | null;
  tool: Tool;
  wizard: WizardState | null;
  pendingIn: number | null;
  pendingOut: number | null;
  occlusionStart: number | null;

  undo: Document[];
  redo: Document[];
  saveState: SaveState;
  saveError: string | null;
  toast: string | null;
  busy: string | null;

  playing: boolean;
  showCourt: boolean;
  verify: boolean;
  loupeZoom: number;
  loupeFocused: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  setRoot: (path: string) => Promise<void>;
  openVideo: (id: string) => Promise<void>;
  closeVideo: () => void;
  notify: (message: string | null) => void;

  setFrame: (frame: number) => void;
  stepFrame: (delta: number) => void;
  syncFrame: (frame: number) => void;
  setTool: (tool: Tool) => void;
  select: (selection: Selection) => void;
  setActiveTrajectory: (id: string | null) => void;
  setPlaying: (playing: boolean) => void;
  toggleCourt: () => void;
  toggleVerify: () => void;
  setLoupeZoom: (zoom: number) => void;
  setLoupeFocused: (focused: boolean) => void;

  setIn: () => void;
  setOut: () => void;
  clearRange: () => void;
  createSequence: () => void;
  deleteSequence: () => void;

  startCourtWizard: () => void;
  cancelWizard: () => void;
  wizardClick: (point: XY) => void;
  deleteCourtKeyframe: () => void;
  setCourtPreset: (preset: Sequence['court']['preset']) => void;
  toggleMirror: () => void;

  newTrajectory: (at?: XY) => void;
  deleteTrajectory: () => void;
  addAnchor: (tag: Tag | null, at?: XY) => void;
  addPathPoint: (at?: XY) => void;
  setPointTag: (tag: Tag) => void;
  moveSelected: (point: XY) => void;
  beginDrag: () => void;
  dragTo: (point: XY) => void;
  endDrag: () => void;
  deleteSelected: () => void;
  toggleOcclusion: () => void;
  toggleNeedsReview: () => void;
  toggleCompleted: () => void;

  undoDoc: () => void;
  redoDoc: () => void;
  saveNow: (force?: boolean) => Promise<void>;
}

function activeSequenceOf(state: { doc: Document | null; currentFrame: number }): Sequence | null {
  if (!state.doc) return null;
  return (
    state.doc.sequences.find(
      (s) => state.currentFrame >= s.tStart && state.currentFrame <= s.tEnd,
    ) ?? null
  );
}

function findTrajectory(doc: Document, id: string): { seq: Sequence; traj: Trajectory } | null {
  for (const seq of doc.sequences) {
    const traj = seq.trajectories.find((t) => t.id === id);
    if (traj) return { seq, traj };
  }
  return null;
}

function nextId(prefix: string, existing: string[]): string {
  let n = 1;
  while (existing.includes(`${prefix}_${String(n).padStart(2, '0')}`)) n++;
  return `${prefix}_${String(n).padStart(2, '0')}`;
}

function mirrorLandmark(id: string): string {
  if (id.includes('_left')) return id.replace('_left', '_right');
  if (id.includes('_right')) return id.replace('_right', '_left');
  return id;
}

/** Keep the document inside the schema invariants after every edit. */
function normalise(doc: Document): void {
  doc.sequences.sort((a, b) => a.tStart - b.tStart);
  for (const seq of doc.sequences) {
    seq.court.keyframes.sort((a, b) => a.t - b.t);
    for (const traj of seq.trajectories) {
      traj.points.sort((a, b) => a.t - b.t);
      if (traj.points.length === 0) continue;
      traj.tStart = traj.points[0]!.t;
      traj.tEnd = traj.points[traj.points.length - 1]!.t;
      for (let i = 0; i < traj.points.length; i++) {
        const p = traj.points[i]!;
        if (p.kind === 'path') {
          p.tag = null;
        } else if (p.tag === 'boundary' && i !== 0 && i !== traj.points.length - 1) {
          p.tag = 'other';
        }
      }
      traj.occlusions = traj.occlusions
        .map((o) => ({ from: Math.min(o.from, o.to), to: Math.max(o.from, o.to) }))
        .filter((o) => o.from >= traj.tStart && o.to <= traj.tEnd)
        .sort((a, b) => a.from - b.from);
    }
    seq.trajectories = seq.trajectories.filter((t) => t.points.length > 0);
  }
}

export const useStore = create<AppState>((set, get) => {
  const commit = (mutator: (doc: Document) => void, options?: { select?: Selection }) => {
    const state = get();
    if (!state.doc) return;
    const next = structuredClone(state.doc);
    mutator(next);
    normalise(next);
    set({
      doc: next,
      undo: [...state.undo.slice(-(MAX_UNDO - 1)), state.doc],
      redo: [],
      selection: options?.select ?? state.selection,
      saveState: 'dirty',
      toast: null,
    });
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void get().saveNow();
    }, 900);
  };

  const sanitiseSelection = () => {
    const state = get();
    if (!state.doc || !state.selection) return;
    if (state.selection.kind === 'point') {
      const found = findTrajectory(state.doc, state.selection.trajectoryId);
      const index = state.selection.index;
      if (!found || !found.traj.points[index]) {
        set({ selection: null, activeTrajectoryId: null });
      }
    }
  };

  const frameNow = (): number => {
    const state = get();
    if (pendingFrame === null) return state.currentFrame;
    const value = pendingFrame;
    pendingFrame = null;
    if (frameRaf) {
      window.cancelAnimationFrame(frameRaf);
      frameRaf = 0;
    }
    set({ currentFrame: value });
    return value;
  };

  const scheduleFrame = (value: number, stopPlayback: boolean): void => {
    const state = get();
    const max = Math.max(0, (state.meta?.table.frameCount ?? 1) - 1);
    const next = Math.min(Math.max(0, Math.round(value)), max);
    if (next === (pendingFrame ?? state.currentFrame)) return;
    if (stopPlayback && state.playing) set({ playing: false });
    pendingFrame = next;
    if (!frameRaf) {
      frameRaf = window.requestAnimationFrame(() => {
        frameRaf = 0;
        const pending = pendingFrame;
        pendingFrame = null;
        if (pending !== null) set({ currentFrame: pending });
      });
    }
  };

  return {
    ready: false,
    root: '',
    libraryExists: false,
    videos: [],
    activeId: null,
    meta: null,
    doc: null,
    mismatch: null,
    currentFrame: 0,
    selection: null,
    activeTrajectoryId: null,
    tool: 'select',
    wizard: null,
    pendingIn: null,
    pendingOut: null,
    occlusionStart: null,
    undo: [],
    redo: [],
    saveState: 'idle',
    saveError: null,
    toast: null,
    busy: null,
    playing: false,
    showCourt: true,
    verify: false,
    loupeZoom: 10,
    loupeFocused: false,

    notify: (message) => set({ toast: message }),

    init: async () => {
      try {
        const [config, list] = await Promise.all([api.config(), api.videos()]);
        set({
          ready: true,
          root: config.videoRoot,
          libraryExists: list.exists,
          videos: list.videos,
        });
        // Deep link used by the global launcher: /?video=<relative path>
        const requested = new URLSearchParams(window.location.search).get('video');
        if (requested) {
          const match =
            list.videos.find((video) => video.relPath === requested) ??
            list.videos.find((video) => video.name === requested);
          if (match) void get().openVideo(match.id);
          else set({ toast: `Vidéo introuvable dans ce dossier : ${requested}` });
        }
      } catch (error) {
        set({ ready: true, toast: (error as Error).message });
      }
    },

    refresh: async () => {
      try {
        const list = await api.videos();
        set({ videos: list.videos, root: list.root, libraryExists: list.exists });
      } catch (error) {
        set({ toast: (error as Error).message });
      }
    },

    setRoot: async (path) => {
      try {
        const config = await api.setRoot(path);
        set({ root: config.videoRoot });
        await get().refresh();
      } catch (error) {
        set({ toast: (error as Error).message });
      }
    },

    openVideo: async (id) => {
      set({ busy: 'Chargement de la vidéo…', toast: null });
      try {
        const meta = await api.meta(id);
        const loaded = await api.annotations(id);
        const lastFrame = loaded.document.state.lastFrame ?? 0;
        set({
          activeId: id,
          meta,
          doc: loaded.document,
          mismatch: loaded.mismatch,
          currentFrame: Math.min(Math.max(0, lastFrame), Math.max(0, meta.table.frameCount - 1)),
          selection: null,
          activeTrajectoryId: loaded.document.sequences[0]?.trajectories[0]?.id ?? null,
          undo: [],
          redo: [],
          tool: 'select',
          wizard: null,
          pendingIn: null,
          pendingOut: null,
          saveState: 'saved',
          saveError: null,
          playing: false,
          verify: false,
          busy: null,
        });
        if (meta.needsProxy && meta.proxy.state !== 'done') {
          void api.prepare(id).catch(() => undefined);
          if (proxyTimer !== null) window.clearInterval(proxyTimer);
          proxyTimer = window.setInterval(async () => {
            try {
              const status = await api.proxy(id);
              const current = get().meta;
              if (current && current.id === id) {
                set({ meta: { ...current, proxy: status as VideoMeta['proxy'] } });
              }
              if (status.state === 'done' || status.state === 'error') {
                if (proxyTimer !== null) window.clearInterval(proxyTimer);
                proxyTimer = null;
              }
            } catch {
              if (proxyTimer !== null) window.clearInterval(proxyTimer);
              proxyTimer = null;
            }
          }, 1000);
        }
      } catch (error) {
        set({ busy: null, toast: `Ouverture impossible : ${(error as Error).message}` });
      }
    },

    closeVideo: () => {
      if (proxyTimer !== null) window.clearInterval(proxyTimer);
      proxyTimer = null;
      void get().saveNow();
      set({
        activeId: null,
        meta: null,
        doc: null,
        mismatch: null,
        undo: [],
        redo: [],
        selection: null,
        activeTrajectoryId: null,
        playing: false,
        verify: false,
        wizard: null,
      });
      void get().refresh();
    },

    setFrame: (frame) => scheduleFrame(frame, true),

    stepFrame: (delta) => {
      const state = get();
      scheduleFrame((pendingFrame ?? state.currentFrame) + delta, true);
    },

    syncFrame: (frame) => scheduleFrame(frame, false),

    setTool: (tool) => set({ tool }),

    select: (selection) => {
      if (selection?.kind === 'point') {
        set({ selection, activeTrajectoryId: selection.trajectoryId });
      } else {
        set({ selection });
      }
    },

    setActiveTrajectory: (id) => set({ activeTrajectoryId: id, selection: null }),
    setPlaying: (playing) => set({ playing }),
    toggleCourt: () => set({ showCourt: !get().showCourt }),
    toggleVerify: () => set({ verify: !get().verify, playing: false }),
    setLoupeZoom: (zoom) => set({ loupeZoom: Math.min(24, Math.max(4, zoom)) }),
    setLoupeFocused: (focused) => set({ loupeFocused: focused }),

    setIn: () => {
      frameNow();
      const state = get();
      set({
        pendingIn: state.currentFrame,
        pendingOut:
          state.pendingOut !== null && state.pendingOut <= state.currentFrame
            ? state.currentFrame
            : state.pendingOut,
      });
    },

    setOut: () => {
      frameNow();
      const state = get();
      set({
        pendingOut: state.currentFrame,
        pendingIn:
          state.pendingIn !== null && state.pendingIn >= state.currentFrame
            ? state.currentFrame
            : state.pendingIn,
      });
    },

    clearRange: () => set({ pendingIn: null, pendingOut: null }),

    createSequence: () => {
      frameNow();
      const state = get();
      if (!state.doc) return;
      const a = state.pendingIn ?? state.currentFrame;
      const b = state.pendingOut ?? state.currentFrame;
      const tStart = Math.min(a, b);
      const tEnd = Math.max(a, b);
      if (tEnd <= tStart) {
        set({ toast: 'Sélectionne une plage de frames (I / O) avant de créer une séquence.' });
        return;
      }
      const overlap = state.doc.sequences.find((s) => tStart <= s.tEnd && tEnd >= s.tStart);
      if (overlap) {
        set({ toast: `Chevauchement avec la séquence « ${overlap.label} ».` });
        return;
      }
      const id = nextId('seq', state.doc.sequences.map((s) => s.id));
      const index = state.doc.sequences.length + 1;
      commit(
        (doc) => {
          doc.sequences.push({
            id,
            label: `Séquence ${index}`,
            tStart,
            tEnd,
            court: {
              preset: 'doubles_corners',
              homographyLandmarks: [...PRESETS.doubles_corners!],
              mirrored: false,
              keyframes: [],
            },
            trajectories: [],
          });
        },
        { select: null },
      );
      set({ pendingIn: null, pendingOut: null, currentFrame: tStart, toast: null });
    },

    deleteSequence: () => {
      frameNow();
      const state = get();
      const seq = activeSequenceOf(state);
      if (!seq || !state.doc) return;
      if (!window.confirm(`Supprimer « ${seq.label} » et tout son contenu ?`)) return;
      commit(
        (doc) => {
          doc.sequences = doc.sequences.filter((s) => s.id !== seq.id);
        },
        { select: null },
      );
      set({ activeTrajectoryId: null });
    },

    startCourtWizard: () => {
      frameNow();
      const state = get();
      const seq = activeSequenceOf(state);
      if (!seq) {
        set({ toast: 'Place le playhead dans une séquence pour poser le court.' });
        return;
      }
      set({
        wizard: { ids: [...PRESETS[seq.court.preset]!], taken: {}, index: 0 },
        tool: 'court',
        toast: null,
      });
    },

    cancelWizard: () => set({ wizard: null, tool: 'select' }),

    wizardClick: (point) => {
      frameNow();
      const state = get();
      const seq = activeSequenceOf(state);
      if (!state.wizard || !seq) return;
      const ids = state.wizard.ids;
      const rawId = ids[state.wizard.index]!;
      const id = seq.court.mirrored ? mirrorLandmark(rawId) : rawId;
      const taken = { ...state.wizard.taken, [id]: { x: point.x, y: point.y } };
      const index = state.wizard.index + 1;
      if (index < ids.length) {
        set({ wizard: { ...state.wizard, taken, index } });
        return;
      }
      const frame = state.currentFrame;
      commit((doc) => {
        const target = doc.sequences.find((s) => s.id === seq.id)!;
        target.court.keyframes = target.court.keyframes.filter((kf) => kf.t !== frame);
        target.court.keyframes.push({ t: frame, source: 'manual', landmarks: taken });
      });
      set({ wizard: null, tool: 'select' });
    },

    setCourtPreset: (preset) => {
      const state = get();
      const seq = activeSequenceOf(state);
      if (!seq) return;
      if (seq.court.keyframes.length > 0) {
        set({ toast: 'Supprime les keyframes court avant de changer de preset.' });
        return;
      }
      commit((doc) => {
        const target = doc.sequences.find((s) => s.id === seq.id)!;
        target.court.preset = preset;
        target.court.homographyLandmarks = [...PRESETS[preset]!];
      });
    },

    toggleMirror: () => {
      const state = get();
      const seq = activeSequenceOf(state);
      if (!seq) return;
      commit((doc) => {
        const target = doc.sequences.find((s) => s.id === seq.id)!;
        target.court.mirrored = !target.court.mirrored;
      });
    },

    deleteCourtKeyframe: () => {
      frameNow();
      const state = get();
      const seq = activeSequenceOf(state);
      if (!seq) return;
      const frame = state.currentFrame;
      if (!seq.court.keyframes.some((kf) => kf.t === frame)) {
        set({ toast: 'Aucune keyframe court à cette frame.' });
        return;
      }
      commit((doc) => {
        const target = doc.sequences.find((s) => s.id === seq.id)!;
        target.court.keyframes = target.court.keyframes.filter((kf) => kf.t !== frame);
      });
    },

    newTrajectory: (at) => {
      frameNow();
      const state = get();
      const seq = activeSequenceOf(state);
      if (!seq) {
        set({ toast: 'Place le playhead dans une séquence pour créer un trajet.' });
        return;
      }
      const position = at ?? hoverState;
      const id = nextId('traj', seq.trajectories.map((t) => t.id));
      const frame = state.currentFrame;
      const index = seq.trajectories.length + 1;
      commit(
        (doc) => {
          const target = doc.sequences.find((s) => s.id === seq.id)!;
          target.trajectories.push({
            id,
            label: `Trajet ${index}`,
            needsReview: false,
            notes: '',
            tStart: frame,
            tEnd: frame,
            occlusions: [],
            points: [
              { t: frame, x: position.x, y: position.y, kind: 'anchor', tag: 'other', source: 'manual' },
            ],
          });
        },
        { select: { kind: 'point', trajectoryId: id, index: 0 } },
      );
      set({ activeTrajectoryId: id, playing: false });
    },

    deleteTrajectory: () => {
      const state = get();
      const id = state.activeTrajectoryId;
      if (!id) return;
      const found = state.doc ? findTrajectory(state.doc, id) : null;
      if (!found) return;
      if (!window.confirm(`Supprimer le trajet « ${found.traj.label} » ?`)) return;
      commit(
        (doc) => {
          const seq = doc.sequences.find((s) => s.id === found.seq.id)!;
          seq.trajectories = seq.trajectories.filter((t) => t.id !== id);
        },
        { select: null },
      );
      set({ activeTrajectoryId: null });
    },

    addAnchor: (tag, at) => {
      frameNow();
      const state = get();
      const id = state.activeTrajectoryId;
      if (!id || !state.doc) {
        set({ toast: 'Sélectionne ou crée un trajet balle (B) avant d’ajouter une ancre.' });
        return;
      }
      const found = findTrajectory(state.doc, id);
      if (!found) return;
      if (state.currentFrame < found.seq.tStart || state.currentFrame > found.seq.tEnd) {
        set({ toast: 'Cette frame est hors de la séquence du trajet.' });
        return;
      }
      const position = at ?? hoverState;
      const frame = state.currentFrame;
      const existing = found.traj.points.findIndex((p) => p.t === frame);
      commit(
        (doc) => {
          const traj = findTrajectory(doc, id)!.traj;
          const point: TrajectoryPoint = {
            t: frame,
            x: position.x,
            y: position.y,
            kind: 'anchor',
            tag: tag ?? 'other',
            source: 'manual',
          };
          if (existing >= 0) traj.points[existing] = point;
          else traj.points.push(point);
          traj.points.sort((a, b) => a.t - b.t);
        },
        {
          select: {
            kind: 'point',
            trajectoryId: id,
            index: -1,
          },
        },
      );
      // resolve the index after normalisation
      const updated = get().doc ? findTrajectory(get().doc!, id) : null;
      const index = updated ? updated.traj.points.findIndex((p) => p.t === frame) : -1;
      set({ selection: index >= 0 ? { kind: 'point', trajectoryId: id, index } : null });
    },

    addPathPoint: (at) => {
      frameNow();
      const state = get();
      const id = state.activeTrajectoryId;
      if (!id || !state.doc) return;
      const found = findTrajectory(state.doc, id);
      if (!found) return;
      const frame = state.currentFrame;
      if (frame <= found.traj.tStart || frame >= found.traj.tEnd) {
        set({ toast: 'Un path point se place entre la première et la dernière ancre.' });
        return;
      }
      const position = at ?? hoverState;
      commit(
        (doc) => {
          const traj = findTrajectory(doc, id)!.traj;
          traj.points = traj.points.filter((p) => p.t !== frame);
          traj.points.push({
            t: frame,
            x: position.x,
            y: position.y,
            kind: 'path',
            tag: null,
            source: 'manual',
          });
          traj.points.sort((a, b) => a.t - b.t);
        },
        { select: null },
      );
      const updated = get().doc ? findTrajectory(get().doc!, id) : null;
      const index = updated ? updated.traj.points.findIndex((p) => p.t === frame) : -1;
      set({ selection: index >= 0 ? { kind: 'point', trajectoryId: id, index } : null });
    },

    setPointTag: (tag) => {
      const state = get();
      const sel = state.selection;
      if (!sel || sel.kind !== 'point') return;
      commit((doc) => {
        const traj = findTrajectory(doc, sel.trajectoryId)?.traj;
        const point = traj?.points[sel.index];
        if (!point) return;
        point.kind = 'anchor';
        point.tag = tag;
      });
    },

    moveSelected: (point) => {
      frameNow();
      const state = get();
      const sel = state.selection;
      if (!sel) return;
      if (sel.kind === 'point') {
        commit((doc) => {
          const traj = findTrajectory(doc, sel.trajectoryId)?.traj;
          const target = traj?.points[sel.index];
          if (target) {
            target.x = point.x;
            target.y = point.y;
          }
        });
      } else {
        const seq = activeSequenceOf(state);
        if (!seq) return;
        const frame = state.currentFrame;
        if (!seq.court.keyframes.some((kf) => kf.t === frame)) return;
        commit((doc) => {
          const target = doc.sequences.find((s) => s.id === seq.id)!;
          const kf = target.court.keyframes.find((k) => k.t === frame)!;
          kf.landmarks[sel.landmarkId] = { x: point.x, y: point.y };
        });
      }
    },

    beginDrag: () => {
      const state = get();
      dragBase = state.doc ? structuredClone(state.doc) : null;
      dragMoved = false;
    },

    dragTo: (point) => {
      frameNow();
      const state = get();
      const sel = state.selection;
      if (!state.doc || !sel) return;
      const next = structuredClone(state.doc);
      if (sel.kind === 'point') {
        const target = findTrajectory(next, sel.trajectoryId)?.traj.points[sel.index];
        if (target) {
          target.x = point.x;
          target.y = point.y;
        }
      } else {
        const seq = activeSequenceOf(state);
        const kf = seq?.court.keyframes.find((k) => k.t === state.currentFrame);
        if (seq && kf) kf.landmarks[sel.landmarkId] = { x: point.x, y: point.y };
        else return;
      }
      dragMoved = true;
      set({ doc: next, saveState: 'dirty' });
    },

    endDrag: () => {
      const state = get();
      if (dragBase && dragMoved && state.doc) {
        set({ undo: [...state.undo.slice(-(MAX_UNDO - 1)), dragBase], redo: [] });
        state.saveNow();
      }
      dragBase = null;
      dragMoved = false;
    },

    deleteSelected: () => {
      const state = get();
      const sel = state.selection;
      if (!sel) return;
      if (sel.kind === 'landmark') {
        set({ toast: 'Supprime la keyframe court entière avec C puis Suppr, ou re-pose-la.' });
        return;
      }
      commit(
        (doc) => {
          const traj = findTrajectory(doc, sel.trajectoryId)?.traj;
          if (traj) traj.points.splice(sel.index, 1);
        },
        { select: null },
      );
      sanitiseSelection();
    },

    toggleOcclusion: () => {
      frameNow();
      const state = get();
      const id = state.activeTrajectoryId;
      if (!id || !state.doc) return;
      const found = findTrajectory(state.doc, id);
      if (!found) return;
      const frame = state.currentFrame;
      if (frame < found.traj.tStart || frame > found.traj.tEnd) {
        set({ toast: 'Occultation hors de la plage du trajet.' });
        return;
      }
      if (state.occlusionStart === null) {
        set({ occlusionStart: frame, toast: 'Début d’occultation posé — U pour fermer.' });
        return;
      }
      const from = Math.min(state.occlusionStart, frame);
      const to = Math.max(state.occlusionStart, frame);
      commit((doc) => {
        const traj = findTrajectory(doc, id)!.traj;
        traj.occlusions.push({ from, to });
      });
      set({ occlusionStart: null, toast: null });
    },

    toggleNeedsReview: () => {
      const state = get();
      const id = state.activeTrajectoryId;
      if (!id) return;
      commit((doc) => {
        const traj = findTrajectory(doc, id)?.traj;
        if (traj) traj.needsReview = !traj.needsReview;
      });
    },

    toggleCompleted: () => {
      commit((doc) => {
        doc.state.completed = !doc.state.completed;
      });
    },

    undoDoc: () => {
      const state = get();
      if (state.undo.length === 0 || !state.doc) return;
      const previous = state.undo[state.undo.length - 1]!;
      set({
        doc: previous,
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, state.doc],
        selection: null,
        saveState: 'dirty',
      });
      void get().saveNow();
    },

    redoDoc: () => {
      const state = get();
      if (state.redo.length === 0 || !state.doc) return;
      const next = state.redo[state.redo.length - 1]!;
      set({
        doc: next,
        redo: state.redo.slice(0, -1),
        undo: [...state.undo, state.doc],
        selection: null,
        saveState: 'dirty',
      });
      void get().saveNow();
    },

    saveNow: async (force = false) => {
      frameNow();
      const state = get();
      if (!state.activeId || !state.doc) return;
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      const payload: Document = {
        ...state.doc,
        state: { ...state.doc.state, lastFrame: state.currentFrame },
      };
      set({ saveState: 'saving' });
      try {
        await api.save(state.activeId, payload, force);
        set({ saveState: 'saved', saveError: null, doc: payload, mismatch: null });
      } catch (error) {
        const message = (error as Error).message;
        const conflict = message.includes('changed on disk');
        set({ saveState: conflict ? 'conflict' : 'error', saveError: message });
        if (!conflict) set({ toast: `Sauvegarde impossible : ${message}` });
      }
    },
  };
});

export { activeSequenceOf, findTrajectory };
