import { useEffect, useState } from 'react';
import { precisionAt } from '../derive';
import { LANDMARK_LABELS } from '../math';
import { TAG_COLORS, TAG_LABELS } from '../render';
import { activeSequenceOf, findTrajectory, useStore } from '../store';
import type { Tag } from '../types';
import { CourtDiagram } from './CourtDiagram';
import { Loupe } from './Loupe';

const TAGS: Tag[] = ['hand', 'racket', 'ground', 'net', 'other', 'boundary'];

/** Move to the previous/next court pose, wrapping around. */
function goPose(
  sequence: { court: { keyframes: { t: number }[] } },
  frame: number,
  direction: number,
): void {
  const keys = [...sequence.court.keyframes].sort((a, b) => a.t - b.t);
  if (keys.length === 0) return;
  const current = keys.findIndex((k) => k.t === frame);
  let next: number;
  if (current >= 0) {
    next = (current + direction + keys.length) % keys.length;
  } else if (direction > 0) {
    next = keys.findIndex((k) => k.t > frame);
    if (next < 0) next = 0;
  } else {
    const before = keys.map((k) => k.t).filter((t) => t < frame);
    next = before.length > 0 ? keys.findIndex((k) => k.t === before[before.length - 1]) : keys.length - 1;
  }
  const store = useStore.getState();
  store.jumpFrame(keys[next]!.t);
  store.select(null);
}
const NUDGE_STEPS = [0.1, 1, 5];

function LabelInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="field"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="number-field">
      <span className="subtle">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (Number.isFinite(parsed) && parsed !== value) onChange(parsed);
          else setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function SidePanel() {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const frame = useStore((s) => s.currentFrame);
  const selection = useStore((s) => s.selection);
  const activeTrajectoryId = useStore((s) => s.activeTrajectoryId);
  const wizard = useStore((s) => s.wizard);
  const tool = useStore((s) => s.tool);
  const occlusionStart = useStore((s) => s.occlusionStart);
  const [nudgeStep, setNudgeStep] = useState(1);

  if (!doc || !meta) return null;
  const store = useStore.getState();
  const sequence = activeSequenceOf({ doc, currentFrame: frame });
  const precision = sequence ? precisionAt(sequence.court, frame) : 0;
  const keyframe = sequence?.court.keyframes.find((k) => k.t === frame) ?? null;
  const found = activeTrajectoryId ? findTrajectory(doc, activeTrajectoryId) : null;
  const traj = found?.traj ?? null;
  const selectedPoint =
    selection?.kind === 'point' && traj ? traj.points[selection.index] ?? null : null;
  const selectedLandmark = selection?.kind === 'landmark' ? selection.landmarkId : null;
  const impacts = traj ? traj.points.filter((p) => p.kind === 'anchor') : [];
  const poseIndex = sequence
    ? sequence.court.keyframes.findIndex((k) => k.t === frame)
    : -1;
  const segments = Math.max(0, impacts.length - 1);

  const nudge = (signX: number, signY: number) => {
    const dx = (signX * nudgeStep) / meta.table.width;
    const dy = (signY * nudgeStep) / meta.table.height;
    if (selectedPoint) {
      store.moveSelected({ x: selectedPoint.x + dx, y: selectedPoint.y + dy });
    } else if (selectedLandmark && keyframe) {
      const landmark = keyframe.landmarks[selectedLandmark];
      if (landmark) {
        store.moveSelected({ x: landmark.x + dx, y: landmark.y + dy });
      }
    }
  };

  const nudgePad = (
    <div className="nudge">
      <button className="btn tiny" onClick={() => nudge(0, -1)} title="Monter">
        ↑
      </button>
      <div className="nudge-row">
        <button className="btn tiny" onClick={() => nudge(-1, 0)} title="Gauche">
          ←
        </button>
        <select
          value={nudgeStep}
          onChange={(event) => setNudgeStep(Number(event.target.value))}
          title="Pas du clavier et de la croix"
        >
          {NUDGE_STEPS.map((step) => (
            <option key={step} value={step}>
              {step} px
            </option>
          ))}
        </select>
        <button className="btn tiny" onClick={() => nudge(1, 0)} title="Droite">
          →
        </button>
      </div>
      <button className="btn tiny" onClick={() => nudge(0, 1)} title="Descendre">
        ↓
      </button>
    </div>
  );

  return (
    <aside className="side">
      <section className="panel">
        <div className="panel-title">
          Séquence
          <span className="spacer" />
          <button
            className="btn tiny ghost"
            title="Supprimer la séquence et tout son contenu"
            onClick={() => store.deleteSequence()}
            disabled={!sequence}
          >
            supprimer
          </button>
        </div>

        <select
          className="field"
          value={sequence?.id ?? ''}
          onChange={(event) => {
            const target = doc.sequences.find((item) => item.id === event.target.value);
            if (target) store.setFrame(target.tStart);
          }}
          title="Aller à une autre séquence"
        >
          {!sequence && <option value="">hors séquence</option>}
          {doc.sequences.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · {item.tStart}–{item.tEnd}
            </option>
          ))}
        </select>

        {sequence ? (
          <>
            <LabelInput value={sequence.label} onCommit={(v) => store.renameSequence(v)} />
            <div className="range-row">
              <NumberField
                label="début"
                value={sequence.tStart}
                min={0}
                max={meta.table.frameCount - 1}
                onChange={(v) => store.setSequenceRange(v, sequence.tEnd)}
              />
              <NumberField
                label="fin"
                value={sequence.tEnd}
                min={0}
                max={meta.table.frameCount - 1}
                onChange={(v) => store.setSequenceRange(sequence.tStart, v)}
              />
            </div>

            <div className="kv">
              <span className="subtle">Court</span>
              <select
                value={sequence.court.preset}
                onChange={(event) =>
                  store.setCourtPreset(event.target.value as typeof sequence.court.preset)
                }
                title="Preset de landmarks du court"
              >
                <option value="doubles_corners">coins double</option>
                <option value="singles_corners">coins simple</option>
                <option value="service_boxes">carrés de service</option>
              </select>
            </div>
            <div className="kv">
              <span className="subtle">Poses court</span>
              <span className="mono">
                {sequence.court.keyframes.length === 0
                  ? '—'
                  : `${sequence.court.keyframes.length}${sequence.court.keyframes.length > 1 ? ' (caméra mobile)' : ' (statique)'}`}
              </span>
            </div>
            {sequence.court.keyframes.length > 0 && (
              <div className="pose-nav">
                <button
                  className="btn tiny"
                  onClick={() => goPose(sequence, frame, -1)}
                  title="Pose précédente"
                >
                  ◀ pose
                </button>
                <span className="mono subtle">
                  {poseIndex >= 0
                    ? `pose ${poseIndex + 1}/${sequence.court.keyframes.length}`
                    : `hors pose · ${sequence.court.keyframes.length} poses`}
                </span>
                <button
                  className="btn tiny"
                  onClick={() => goPose(sequence, frame, 1)}
                  title="Pose suivante"
                >
                  pose ▶
                </button>
              </div>
            )}
            {keyframe && (
              <ul className="landmark-list">
                {Object.entries(keyframe.landmarks).map(([id, position]) => {
                  const selected =
                    selection?.kind === 'landmark' && selection.landmarkId === id;
                  return (
                    <li
                      key={id}
                      className={selected ? 'on' : ''}
                      onClick={() => {
                        store.select({ kind: 'landmark', landmarkId: id });
                        store.jumpFrame(keyframe.t);
                      }}
                      title="Sélectionner ce point, puis glisser sur la vidéo ou utiliser la croix"
                    >
                      <span className="landmark-dot" />
                      <span className="grow">{LANDMARK_LABELS[id] ?? id}</span>
                      <span className="mono subtle">
                        {position.x.toFixed(4)}, {position.y.toFixed(4)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="row">
              <button className="btn small" onClick={() => store.startCourtWizard()}>
                {keyframe ? 'Reposer le court (C)' : 'Poser le court (C)'}
              </button>
              <button
                className="btn small ghost"
                onClick={() => store.toggleMirror()}
                title="Inverse l'appariement gauche/droite des points"
              >
                miroir {sequence.court.mirrored ? 'on' : 'off'}
              </button>
              <button
                className="btn small ghost"
                onClick={() => store.deleteCourtKeyframe()}
                disabled={!keyframe}
                title="Supprimer la keyframe court à cette frame"
              >
                suppr. keyframe
              </button>
            </div>

            {precision > 0 && (
              <div className={`gauge ${precision < 0.35 ? 'warn' : ''}`}>
                <div
                  className="gauge-fill"
                  style={{ width: `${Math.min(100, precision * 100)}%` }}
                />
                <span>précision {Math.round(precision * 100)} %</span>
              </div>
            )}
            {precision > 0 && precision < 0.35 && (
              <p className="hint warn">
                Le quadrilatère annoté couvre peu du court : les lignes déduites sont extrapolées.
              </p>
            )}
            {keyframe && !wizard && (
              <p className="hint">
                Keyframe court à #{keyframe.t} · {Object.keys(keyframe.landmarks).length} points.
                Clique un point du court pour l’ajuster.
              </p>
            )}

            {wizard && (
              <div className="wizard-box">
                <div className="wizard-head">
                  Point {wizard.index + 1}/{wizard.ids.length} ·{' '}
                  {LANDMARK_LABELS[wizard.ids[wizard.index]!] ?? wizard.ids[wizard.index]}
                </div>
                <CourtDiagram ids={wizard.ids} current={wizard.index} placed={wizard.index} />
                <ol className="wizard-list">
                  {wizard.ids.map((id, index) => (
                    <li
                      key={id}
                      className={
                        index === wizard.index ? 'current' : index < wizard.index ? 'done' : ''
                      }
                    >
                      {index + 1}. {LANDMARK_LABELS[id] ?? id}
                    </li>
                  ))}
                </ol>
                <button className="btn small ghost" onClick={() => store.cancelWizard()}>
                  annuler
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="hint">
            Place le playhead dans une séquence, ou crées-en une : boutons <strong>IN</strong> /{' '}
            <strong>OUT</strong> sous la vidéo, puis <strong>Créer la séquence</strong>.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          Échanges
          <span className="spacer" />
          <button
            className="btn tiny"
            onClick={() => store.newTrajectory()}
            disabled={!sequence}
            title="Un échange = un point joué, composé de plusieurs segments entre impacts"
          >
            + nouvel échange
          </button>
        </div>

        {sequence && sequence.trajectories.length > 0 ? (
          <ul className="traj-list">
            {sequence.trajectories.map((item) => {
              const itemImpacts = item.points.filter((p) => p.kind === 'anchor').length;
              return (
                <li
                  key={item.id}
                  className={item.id === activeTrajectoryId ? 'active' : ''}
                  onClick={() => store.setActiveTrajectory(item.id)}
                >
                  <span className="dot" data-review={item.needsReview} />
                  <span className="grow">{item.label}</span>
                  <span className="mono subtle">
                    {itemImpacts} imp · {Math.max(1, itemImpacts - 1)} seg
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">
            Aucun échange. Un échange = un point joué (service, échanges de fond…), décrit comme
            une spline en plusieurs segments séparés par les impacts.
          </p>
        )}

        {traj && (
          <>
            <div className="row">
              <LabelInput
                value={traj.label}
                onCommit={(value) => store.renameTrajectory(value)}
                placeholder="nom de l’échange"
              />
            </div>
            <div className="row">
              <button className="btn small ghost" onClick={() => store.toggleNeedsReview()}>
                {traj.needsReview ? '✓ à revoir' : 'marquer à revoir'}
              </button>
              <button className="btn small ghost" onClick={() => store.deleteTrajectory()}>
                supprimer
              </button>
            </div>

            <div className="impact-chips">
              {impacts.length === 0 && <span className="subtle">aucun impact</span>}
              {impacts.map((point) => {
                const index = traj.points.indexOf(point);
                return (
                  <button
                    key={`${point.t}-${index}`}
                    className={
                      selection?.kind === 'point' && selection.index === index ? 'impact on' : 'impact'
                    }
                    style={{ borderColor: TAG_COLORS[point.tag ?? 'other'] }}
                    onClick={() => {
                      store.syncFrame(point.t);
                      store.select({ kind: 'point', trajectoryId: traj.id, index });
                    }}
                    title={`Frame ${point.t}`}
                  >
                    <span className="mono">#{point.t}</span>
                    {point.tag ? TAG_LABELS[point.tag] : ''}
                  </button>
                );
              })}
            </div>

            <div className="row">
              <button
                className={tool === 'anchor' ? 'btn small on' : 'btn small'}
                onClick={() => store.setTool(tool === 'anchor' ? 'select' : 'anchor')}
                title="Puis clique la balle sur la vidéo (ou touche A)"
              >
                + ancre
              </button>
              <button
                className={tool === 'path' ? 'btn small on' : 'btn small'}
                onClick={() => store.setTool(tool === 'path' ? 'select' : 'path')}
                title="Point de passage entre deux ancres : clique la balle (ou P)"
              >
                + point de passage
              </button>
            </div>
            <p className="hint small">
              {impacts.length} impact(s) · {segments} segment(s) · {traj.points.length} point(s)
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">Point sélectionné</div>
        {selectedPoint ? (
          <>
            <div className="kv">
              <span className="mono">#{selectedPoint.t}</span>
              <div className="segmented">
                <button
                  className={selectedPoint.kind === 'anchor' ? 'on' : ''}
                  onClick={() => store.convertSelected('anchor')}
                  title="Un impact : la courbe peut y changer de direction"
                >
                  ancre
                </button>
                <button
                  className={selectedPoint.kind === 'path' ? 'on' : ''}
                  onClick={() => store.convertSelected('path')}
                  title="Un point de passage : la courbe reste lisse"
                >
                  passage
                </button>
              </div>
            </div>
            <div className="kv mono subtle">
              <span>x {selectedPoint.x.toFixed(6)}</span>
              <span>y {selectedPoint.y.toFixed(6)}</span>
            </div>
            {selectedPoint.kind === 'anchor' && (
              <div className="tags">
                {TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={selectedPoint.tag === tag ? 'tag on' : 'tag'}
                    onClick={() => store.setPointTag(tag)}
                    title={TAG_LABELS[tag]}
                  >
                    {TAG_LABELS[tag]}
                  </button>
                ))}
              </div>
            )}
            <div className="point-tools">
              {nudgePad}
              <div className="point-actions">
                <button className="btn tiny" onClick={() => store.selectRelative(-1)}>
                  ← précédent
                </button>
                <button className="btn tiny" onClick={() => store.selectRelative(1)}>
                  suivant →
                </button>
                <button
                  className={occlusionStart !== null ? 'btn tiny on' : 'btn tiny'}
                  onClick={() => store.toggleOcclusion()}
                  title="La balle est masquée mais sa position reste connue"
                >
                  {occlusionStart !== null ? 'fermer occultation' : 'occultation'}
                </button>
                <button className="btn tiny ghost" onClick={() => store.deleteSelected()}>
                  supprimer ce point
                </button>
              </div>
            </div>
          </>
        ) : selectedLandmark ? (
          <>
            <div className="kv">
              <span>{LANDMARK_LABELS[selectedLandmark] ?? selectedLandmark}</span>
              <span className="mono subtle">#{frame}</span>
            </div>
            {nudgePad}
          </>
        ) : (
          <p className="hint">
            Clique un point sur la vidéo, la timeline ou un impact ci-dessus. Utilise{' '}
            <em>+ ancre</em> / <em>+ point de passage</em> pour en ajouter.
          </p>
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
          <li><kbd>C</kbd> court · <kbd>B</kbd> échange · <kbd>A</kbd> ancre · <kbd>P</kbd> passage</li>
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
