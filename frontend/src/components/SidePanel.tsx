import { precisionAt } from '../derive';
import { TAG_LABELS } from '../render';
import { activeSequenceOf, findTrajectory, useStore } from '../store';
import type { Tag } from '../types';
import { Loupe } from './Loupe';

const TAGS: Tag[] = ['hand', 'racket', 'ground', 'net', 'other', 'boundary'];

export function SidePanel() {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const frame = useStore((s) => s.currentFrame);
  const selection = useStore((s) => s.selection);
  const activeTrajectoryId = useStore((s) => s.activeTrajectoryId);

  if (!doc || !meta) return null;
  const sequence = activeSequenceOf({ doc, currentFrame: frame });
  const precision = sequence ? precisionAt(sequence.court, frame) : 0;
  const keyframe = sequence?.court.keyframes.find((k) => k.t === frame) ?? null;
  const found = activeTrajectoryId ? findTrajectory(doc, activeTrajectoryId) : null;
  const traj = found?.traj ?? null;
  const selectedPoint =
    selection?.kind === 'point' && traj ? traj.points[selection.index] ?? null : null;
  const selectedLandmark =
    selection?.kind === 'landmark' ? selection.landmarkId : null;

  const store = useStore.getState();

  return (
    <aside className="side">
      <section className="panel">
        <div className="panel-title">
          Séquence
          <span className="spacer" />
          <button
            className="btn tiny ghost"
            title="Supprimer la séquence"
            onClick={() => store.deleteSequence()}
          >
            supprimer
          </button>
        </div>
        {sequence ? (
          <>
            <div className="kv">
              <span>{sequence.label}</span>
              <span className="mono subtle">
                {sequence.tStart}–{sequence.tEnd}
              </span>
            </div>
            <div className="kv">
              <span className="subtle">Court</span>
              <select
                value={sequence.court.preset}
                onChange={(event) =>
                  store.setCourtPreset(event.target.value as typeof sequence.court.preset)
                }
              >
                <option value="doubles_corners">coins double</option>
                <option value="singles_corners">coins simple</option>
                <option value="service_boxes">carrés de service</option>
              </select>
            </div>
            <div className="kv">
              <span className="subtle">Keyframes</span>
              <span className="mono">
                {sequence.court.keyframes.length === 0
                  ? '—'
                  : sequence.court.keyframes.length === 1
                    ? 'statique'
                    : `${sequence.court.keyframes.length} (caméra mobile)`}
              </span>
            </div>
            <div className="row">
              <button className="btn small" onClick={() => store.startCourtWizard()}>
                Poser le court (C)
              </button>
              <button
                className="btn small ghost"
                onClick={() => store.deleteCourtKeyframe()}
                disabled={!keyframe}
              >
                Suppr. keyframe
              </button>
              <button
                className="btn small ghost"
                onClick={() => store.toggleMirror()}
                title="Inverse l'appariement gauche/droite"
              >
                miroir {sequence.court.mirrored ? 'on' : 'off'}
              </button>
            </div>
            {precision > 0 && (
              <div className={`gauge ${precision < 0.35 ? 'warn' : ''}`}>
                <div className="gauge-fill" style={{ width: `${Math.min(100, precision * 100)}%` }} />
                <span>précision {Math.round(precision * 100)} %</span>
              </div>
            )}
            {precision > 0 && precision < 0.35 && (
              <p className="hint warn">
                Le quadrilatère annoté couvre peu du court : les lignes déduites sont extrapolées.
              </p>
            )}
            {keyframe && (
              <p className="hint">
                Keyframe court à #{keyframe.t} · {Object.keys(keyframe.landmarks).length} landmarks
                {selectedLandmark ? ` · sélection ${selectedLandmark}` : ''}
              </p>
            )}
          </>
        ) : (
          <p className="hint">
            Place le playhead dans une séquence, ou crée-en une : <kbd>I</kbd> / <kbd>O</kbd> puis{' '}
            <kbd>Ctrl</kbd>+<kbd>Entrée</kbd>.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          Trajets balle
          <span className="spacer" />
          <button className="btn tiny" onClick={() => store.newTrajectory()}>
            + B
          </button>
        </div>
        {sequence && sequence.trajectories.length > 0 ? (
          <ul className="traj-list">
            {sequence.trajectories.map((t) => (
              <li
                key={t.id}
                className={t.id === activeTrajectoryId ? 'active' : ''}
                onClick={() => store.setActiveTrajectory(t.id)}
              >
                <span className="dot" data-review={t.needsReview} />
                <span className="grow">{t.label}</span>
                <span className="mono subtle">{t.points.length}p</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Aucun trajet. <kbd>B</kbd> pour démarrer un trajet à la frame courante.</p>
        )}
        {traj && (
          <div className="row">
            <button className="btn small ghost" onClick={() => store.toggleNeedsReview()}>
              {traj.needsReview ? '✓ à revoir' : 'marquer à revoir'}
            </button>
            <button className="btn small ghost" onClick={() => store.deleteTrajectory()}>
              supprimer
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">Point sélectionné</div>
        {selectedPoint ? (
          <>
            <div className="kv">
              <span className="mono">#{selectedPoint.t}</span>
              <span className="mono subtle">{selectedPoint.kind}</span>
            </div>
            <div className="kv mono subtle">
              <span>x {selectedPoint.x.toFixed(6)}</span>
              <span>y {selectedPoint.y.toFixed(6)}</span>
            </div>
            <div className="tags">
              {TAGS.map((tag, index) => (
                <button
                  key={tag}
                  className={selectedPoint.tag === tag ? 'tag on' : 'tag'}
                  style={{ borderColor: undefined }}
                  onClick={() => store.setPointTag(tag)}
                  title={`${TAG_LABELS[tag]} (${index === TAGS.length - 1 ? '0' : index + 1})`}
                >
                  {TAG_LABELS[tag]}
                </button>
              ))}
            </div>
            <div className="row">
              <button className="btn small ghost" onClick={() => store.toggleOcclusion()}>
                occultation (U)
              </button>
              <button className="btn small ghost" onClick={() => store.deleteSelected()}>
                supprimer
              </button>
            </div>
          </>
        ) : selectedLandmark ? (
          <div className="kv mono subtle">{selectedLandmark} — glisse pour ajuster</div>
        ) : (
          <p className="hint">Clique un point sur la vidéo ou la timeline.</p>
        )}
      </section>

      <Loupe />

      <details className="panel help">
        <summary>Raccourcis</summary>
        <ul>
          <li><kbd>Espace</kbd> lecture · <kbd>←/→</kbd> frame</li>
          <li><kbd>Shift+←/→</kbd> 10 frames · <kbd>Ctrl+←/→</kbd> 60</li>
          <li><kbd>Alt+←/→</kbd> point précédent/suivant</li>
          <li><kbd>I</kbd>/<kbd>O</kbd> bornes · <kbd>Ctrl+Entrée</kbd> créer séquence</li>
          <li><kbd>C</kbd> court · <kbd>B</kbd> trajet · <kbd>A</kbd> ancre · <kbd>P</kbd> path point</li>
          <li><kbd>1</kbd>–<kbd>5</kbd> tag · <kbd>0</kbd> bord · <kbd>U</kbd> occultation</li>
          <li><kbd>Tab</kbd> point suivant · <kbd>Suppr</kbd> supprimer</li>
          <li><kbd>L</kbd> lignes · <kbd>V</kbd> vérification · <kbd>Ctrl+Z</kbd> annuler</li>
          <li><kbd>R</kbd> à revoir · <kbd>Ctrl+S</kbd> sauver</li>
        </ul>
      </details>

      <div className="panel subtle small">
        {meta.fileName} · {meta.table.width}×{meta.table.height} ·{' '}
        {meta.table.fpsNominal.toFixed(2)} fps{meta.table.vfr ? ' (VFR)' : ''} ·{' '}
        {meta.table.frameCount} frames
      </div>
    </aside>
  );
}
