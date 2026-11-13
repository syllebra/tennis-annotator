import { useEffect } from 'react';
import { api } from '../api';
import { activeSequenceOf, findTrajectory, useStore } from '../store';
import type { Tag } from '../types';
import { SidePanel } from './SidePanel';
import { Timeline } from './Timeline';
import { VideoStage } from './VideoStage';

const DIGIT_TAGS: Record<string, Tag> = {
  '1': 'hand',
  '2': 'racket',
  '3': 'ground',
  '4': 'net',
  '5': 'other',
  '0': 'boundary',
};

export function Annotator() {
  const meta = useStore((s) => s.meta);
  const doc = useStore((s) => s.doc);
  const frame = useStore((s) => s.currentFrame);
  const saveState = useStore((s) => s.saveState);
  const mismatch = useStore((s) => s.mismatch);
  const busy = useStore((s) => s.busy);
  const detectorBusy = useStore((s) => s.detectorBusy);
  const toast = useStore((s) => s.toast);
  const verify = useStore((s) => s.verify);
  const showCourt = useStore((s) => s.showCourt);
  const loupeFocused = useStore((s) => s.loupeFocused);
  const playing = useStore((s) => s.playing);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const state = useStore.getState();
      if (!state.meta || !state.doc) return;
      const key = event.key;
      const mod = event.ctrlKey || event.metaKey;
      const frameStep = event.shiftKey ? 10 : mod ? 60 : 1;

      const selectable = state.activeTrajectoryId
        ? findTrajectory(state.doc, state.activeTrajectoryId)?.traj.points ?? []
        : [];

      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        state.setPlaying(!state.playing);
        return;
      }
      if (mod && (key === 'z' || key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) state.redoDoc();
        else state.undoDoc();
        return;
      }
      if (mod && (key === 's' || key === 'S')) {
        event.preventDefault();
        void state.saveNow();
        return;
      }
      if (mod && key === 'Enter') {
        event.preventDefault();
        state.createSequence();
        return;
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        const direction = key === 'ArrowRight' ? 1 : -1;
        if (state.loupeFocused && state.selection) {
          const amount = (event.shiftKey ? 1 : event.altKey ? 5 : 0.1) * direction;
          nudge(state, amount / state.meta.table.width, 0);
          return;
        }
        if (event.altKey) {
          if (selectable.length === 0) return;
          const sorted = [...selectable].sort((a, b) => a.t - b.t);
          const next =
            direction > 0
              ? sorted.find((p) => p.t > state.currentFrame) ?? sorted[0]
              : [...sorted].reverse().find((p) => p.t < state.currentFrame) ?? sorted[sorted.length - 1];
          if (!next) return;
          const index = selectable.indexOf(next);
          state.syncFrame(next.t);
          state.select({ kind: 'point', trajectoryId: state.activeTrajectoryId!, index });
          return;
        }
        state.stepFrame(direction * frameStep);
        return;
      }

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (!state.loupeFocused || !state.selection) return;
        event.preventDefault();
        const amount = (event.shiftKey ? 1 : event.altKey ? 5 : 0.1) * (key === 'ArrowDown' ? 1 : -1);
        nudge(state, 0, amount / state.meta.table.height);
        return;
      }

      if (key === '[' || key === ']') {
        event.preventDefault();
        state.stepFrame(key === ']' ? 1 : -1);
        return;
      }
      if (key === 'Tab') {
        event.preventDefault();
        if (selectable.length === 0) return;
        const sorted = [...selectable].sort((a, b) => a.t - b.t);
        let currentIndex = -1;
        if (state.selection?.kind === 'point') {
          const selectedT = selectable[state.selection.index]?.t;
          currentIndex = sorted.findIndex((p) => p.t === selectedT);
        }
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + sorted.length) % sorted.length
          : (currentIndex + 1) % sorted.length;
        const next = sorted[nextIndex]!;
        const index = selectable.indexOf(next);
        state.syncFrame(next.t);
        state.select({ kind: 'point', trajectoryId: state.activeTrajectoryId!, index });
        return;
      }

      if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        state.deleteSelected();
        return;
      }
      if (key === 'Escape') {
        state.cancelWizard();
        if (state.tool !== 'select') state.setTool('select');
        return;
      }

      const lower = key.toLowerCase();
      if (DIGIT_TAGS[key]) {
        state.setPointTag(DIGIT_TAGS[key]!);
        return;
      }
      switch (lower) {
        case 'i':
          state.setIn();
          break;
        case 'o':
          state.setOut();
          break;
        case 'c':
          state.startCourtWizard();
          break;
        case 'b':
          state.newTrajectory();
          break;
        case 'a':
          state.addAnchor(null);
          break;
        case 'p':
          state.addPathPoint();
          break;
        case 'u':
          state.toggleOcclusion();
          break;
        case 'l':
          state.toggleCourt();
          break;
        case 'v':
          state.toggleVerify();
          break;
        case 'r':
          state.toggleNeedsReview();
          break;
        case 'j':
          state.stepFrame(1);
          break;
        case 'k':
          state.stepFrame(-1);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const flush = () => {
      const state = useStore.getState();
      if (state.activeId && state.doc) void state.saveNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!meta || !doc) return <div className="boot">Chargement…</div>;

  const sequence = activeSequenceOf({ doc, currentFrame: frame });
  const saveLabel =
    saveState === 'saving'
      ? '…'
      : saveState === 'saved'
        ? 'sauvegardé'
        : saveState === 'dirty'
          ? 'modifié'
          : saveState === 'conflict'
            ? 'conflit'
            : saveState === 'error'
              ? 'erreur'
              : '—';

  return (
    <div className="annotator">
      <header className="topbar">
        <button className="btn ghost" onClick={() => useStore.getState().closeVideo()}>
          ← vidéos
        </button>
        <span className="filename">{meta.fileName}</span>
        <span className="mono subtle">
          {sequence ? sequence.label : 'hors séquence'} · #{frame}
        </span>
        <span className="separator" />
        <div className="transport" role="group" aria-label="Lecture">
          <button className="btn tiny" onClick={() => useStore.getState().stepFrame(-10)} title="Reculer de 10 frames (Maj+←)">
            −10
          </button>
          <button className="btn tiny" onClick={() => useStore.getState().stepFrame(-1)} title="Frame précédente (←)">
            −1
          </button>
          <button
            className={playing ? 'btn tiny on' : 'btn tiny'}
            onClick={() => useStore.getState().setPlaying(!playing)}
            title="Lecture / pause (Espace)"
          >
            {playing ? '❚❚ pause' : '▶ lecture'}
          </button>
          <button className="btn tiny" onClick={() => useStore.getState().stepFrame(1)} title="Frame suivante (→)">
            +1
          </button>
          <button className="btn tiny" onClick={() => useStore.getState().stepFrame(10)} title="Avancer de 10 frames (Maj+→)">
            +10
          </button>
        </div>
        <span className="separator" />
        <button
          className={showCourt ? 'btn tiny on' : 'btn tiny'}
          onClick={() => useStore.getState().toggleCourt()}
          title="Afficher / masquer les lignes du court (L)"
        >
          lignes
        </button>
        <button
          className={verify ? 'btn tiny on' : 'btn tiny'}
          onClick={() => useStore.getState().toggleVerify()}
          title="Relire le trajet en boucle (V)"
        >
          vérif.
        </button>
        <span className="spacer" />
        {verify && <span className="chip on">vérification</span>}
        <span className={`chip save-${saveState}`}>{saveLabel}</span>
        <button
          className="btn tiny ghost"
          onClick={() => useStore.getState().saveNow()}
          title="Enregistrer maintenant (Ctrl+S) — la sauvegarde est automatique"
        >
          enregistrer
        </button>
        <button
          className="btn tiny ghost"
          onClick={() => useStore.getState().undoDoc()}
          title="Annuler (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          className="btn tiny ghost"
          onClick={() => useStore.getState().redoDoc()}
          title="Rétablir"
        >
          ↷
        </button>
        <button
          className={doc.state.completed ? 'btn small on' : 'btn small ghost'}
          onClick={() => useStore.getState().toggleCompleted()}
        >
          {doc.state.completed ? 'terminée' : 'marquer terminée'}
        </button>
      </header>

      {mismatch && (
        <div className="banner warn">
          La vidéo a changé depuis l'annotation ({mismatch.reasons.join(', ')}).
          {mismatch.blocking
            ? ' Édition refusée : le nombre de frames diffère.'
            : ' La sauvegarde écrasera les métadonnées vidéo.'}
          <button
            className="btn tiny"
            onClick={() => {
              const state = useStore.getState();
              if (!state.activeId || !state.doc) return;
              void api
                .adopt(state.activeId, state.doc)
                .then(() => state.notify('Métadonnées vidéo mises à jour.'))
                .catch((error: Error) => state.notify(error.message));
            }}
          >
            adopter
          </button>
        </div>
      )}
      {toast && (
        <div className="banner info">
          {toast}
          <button className="link" onClick={() => useStore.getState().notify(null)}>
            ok
          </button>
        </div>
      )}
      {busy && <div className="banner">{busy}</div>}
      {detectorBusy && <div className="banner info">{detectorBusy}</div>}

      <div className="workspace">
        <div className="stage-column">
          <VideoStage />
        </div>
        <SidePanel />
      </div>
      <Timeline />
      {loupeFocused && <div className="focus-hint">loupe focus · flèches = sub-pixel</div>}
    </div>
  );
}

function nudge(
  state: ReturnType<typeof useStore.getState>,
  dx: number,
  dy: number,
): void {
  const selection = state.selection;
  if (!selection) return;
  if (selection.kind === 'point') {
    const found = state.doc ? findTrajectory(state.doc, selection.trajectoryId) : null;
    const point = found?.traj.points[selection.index];
    if (!point) return;
    state.moveSelected({ x: point.x + dx, y: point.y + dy });
  } else {
    const sequence = state.doc ? activeSequenceOf(state) : null;
    const keyframe = sequence?.court.keyframes.find((k) => k.t === state.currentFrame);
    const landmark = keyframe?.landmarks[selection.landmarkId];
    if (!landmark) return;
    state.moveSelected({ x: landmark.x + dx, y: landmark.y + dy });
  }
}
