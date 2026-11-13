import { useEffect, useRef, useState } from 'react';
import { activeSequenceOf, useStore } from '../store';
import { TAG_COLORS } from '../render';

const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MIN_SCALE = 0.002;
const MAX_SCALE = 24;

export function Timeline() {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const frame = useStore((s) => s.currentFrame);
  const pendingIn = useStore((s) => s.pendingIn);
  const pendingOut = useStore((s) => s.pendingOut);
  const activeTrajectoryId = useStore((s) => s.activeTrajectoryId);
  const selection = useStore((s) => s.selection);
  const occlusionStart = useStore((s) => s.occlusionStart);

  const [pxPerFrame, setPxPerFrame] = useState(3);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewport, setViewport] = useState(900);
  const bodyRef = useRef<HTMLDivElement>(null);

  const total = meta?.table.frameCount ?? 0;
  const width = Math.max(viewport, total * pxPerFrame);
  const sequence = doc ? activeSequenceOf({ doc, currentFrame: frame }) : null;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(() => setViewport(body.clientWidth));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const x = frame * pxPerFrame;
    const left = body.scrollLeft;
    const right = left + body.clientWidth;
    if (x < left + 40) body.scrollLeft = Math.max(0, x - 40);
    else if (x > right - 80) body.scrollLeft = x - body.clientWidth + 80;
  }, [frame, pxPerFrame]);

  const zoomAt = (nextScale: number, clientX?: number) => {
    const body = bodyRef.current;
    if (!body) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    const rect = body.getBoundingClientRect();
    const pointer = clientX === undefined ? body.clientWidth / 2 : clientX - rect.left;
    const anchorFrame = (pointer + body.scrollLeft) / pxPerFrame;
    setPxPerFrame(scale);
    requestAnimationFrame(() => {
      body.scrollLeft = Math.max(0, anchorFrame * scale - pointer);
    });
  };

  const fit = (mode: 'all' | 'sequence') => {
    const body = bodyRef.current;
    if (!body || total === 0) return;
    const span =
      mode === 'sequence' && sequence ? sequence.tEnd - sequence.tStart + 1 : total;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (body.clientWidth - 8) / span));
    setPxPerFrame(scale);
    requestAnimationFrame(() => {
      body.scrollLeft = mode === 'sequence' && sequence ? sequence.tStart * scale : 0;
    });
  };

  // molette = zoom autour du curseur, maj+molette = défilement horizontal
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey) {
        body.scrollLeft += event.deltaY;
        event.preventDefault();
        return;
      }
      event.preventDefault();
      zoomAt(pxPerFrame * (event.deltaY < 0 ? 1.18 : 1 / 1.18), event.clientX);
    };
    body.addEventListener('wheel', onWheel, { passive: false });
    return () => body.removeEventListener('wheel', onWheel);
  }, [pxPerFrame]);

  const frameAt = (clientX: number): number => {
    const body = bodyRef.current;
    if (!body) return 0;
    const rect = body.getBoundingClientRect();
    return Math.round((clientX - rect.left + body.scrollLeft) / pxPerFrame);
  };

  const scrub = (event: React.PointerEvent) => {
    if (event.buttons !== 1 && event.type === 'pointermove') return;
    useStore.getState().setFrame(frameAt(event.clientX));
  };

  const step = TICK_STEPS.find((s) => s * pxPerFrame >= 56) ?? 10000;
  const visibleStart = Math.max(0, Math.floor(scrollLeft / pxPerFrame) - step);
  const visibleEnd = Math.min(total, Math.ceil((scrollLeft + viewport) / pxPerFrame) + step);
  const ticks: number[] = [];
  for (let f = Math.ceil(visibleStart / step) * step; f <= visibleEnd; f += step) ticks.push(f);

  if (!doc || !meta) return null;
  const store = useStore.getState();

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <label className="tl-frame">
          frame
          <input
            type="number"
            min={0}
            max={total - 1}
            value={frame}
            onChange={(event) => store.setFrame(Number(event.target.value))}
          />
          <span className="subtle mono">/ {total - 1}</span>
        </label>
        <span className="tl-time mono">{formatTime(meta.table.pts[frame] ?? 0)}</span>
        <span className="separator" />
        <button
          className={pendingIn !== null ? 'btn small on' : 'btn small'}
          onClick={() => store.setIn()}
          title="Poser le début de la sélection à la frame courante (I)"
        >
          IN {pendingIn ?? '—'}
        </button>
        <button
          className={pendingOut !== null ? 'btn small on' : 'btn small'}
          onClick={() => store.setOut()}
          title="Poser la fin de la sélection à la frame courante (O)"
        >
          OUT {pendingOut ?? '—'}
        </button>
        <button className="btn small" onClick={() => store.createSequence()}>
          Créer la séquence
        </button>
        <button
          className="btn small ghost"
          onClick={() => store.clearRange()}
          disabled={pendingIn === null && pendingOut === null}
        >
          effacer
        </button>
        <span className="spacer" />
        {occlusionStart !== null && (
          <span className="chip warn mono">occultation ouverte @ {occlusionStart}</span>
        )}
        <span className="separator" />
        <div className="zoom-group">
          <button
            className="btn tiny"
            onClick={() => zoomAt(pxPerFrame / 1.35)}
            title="Dézoomer la timeline"
          >
            −
          </button>
          <span className="mono subtle zoom-value">{pxPerFrame.toFixed(2)} px/f</span>
          <button
            className="btn tiny"
            onClick={() => zoomAt(pxPerFrame * 1.35)}
            title="Zoomer la timeline (molette sur la timeline)"
          >
            +
          </button>
          <button className="btn tiny ghost" onClick={() => fit('all')} title="Voir toute la vidéo">
            tout
          </button>
          <button
            className="btn tiny ghost"
            onClick={() => fit('sequence')}
            disabled={!sequence}
            title="Cadrer la séquence courante"
          >
            séquence
          </button>
        </div>
      </div>

      <div
        className="tl-body"
        ref={bodyRef}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
      >
        <div className="tl-inner" style={{ width }}>
          <div
            className="tl-ruler"
            onPointerDown={(event) => {
              (event.target as HTMLElement).setPointerCapture(event.pointerId);
              scrub(event);
            }}
            onPointerMove={scrub}
          >
            {ticks.map((t) => (
              <div key={t} className="tl-tick" style={{ left: t * pxPerFrame }}>
                <span className="mono">{t}</span>
              </div>
            ))}
          </div>

          <div className="tl-bands">
            {doc.sequences.map((seq) => (
              <div
                key={seq.id}
                className={seq.id === sequence?.id ? 'tl-band active' : 'tl-band'}
                style={{
                  left: seq.tStart * pxPerFrame,
                  width: (seq.tEnd - seq.tStart + 1) * pxPerFrame,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  useStore.getState().setFrame(seq.tStart);
                }}
              >
                <span>{seq.label}</span>
              </div>
            ))}
          </div>

          <div className="tl-rows">
            <div className="tl-line">
              <span className="tl-court-label">court</span>
              {sequence && sequence.court.keyframes.length > 1 && (
                <div
                  className="tl-court-span"
                  style={{
                    left: Math.min(...sequence.court.keyframes.map((k) => k.t)) * pxPerFrame,
                    width:
                      (Math.max(...sequence.court.keyframes.map((k) => k.t)) -
                        Math.min(...sequence.court.keyframes.map((k) => k.t))) *
                      pxPerFrame,
                  }}
                />
              )}
              {sequence?.court.keyframes.map((keyframe, index) => (
                <button
                  key={keyframe.t}
                  className={
                    Math.abs(keyframe.t - frame) < 0.5 ? 'tl-keyframe on' : 'tl-keyframe'
                  }
                  style={{ left: keyframe.t * pxPerFrame - 7 }}
                  title={`Pose court ${index + 1}/${sequence.court.keyframes.length} · #${keyframe.t}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    useStore.getState().jumpFrame(keyframe.t);
                    useStore.getState().select(null);
                  }}
                />
              ))}
            </div>

            {sequence?.trajectories.map((traj) => (
              <div className="tl-line" key={traj.id}>
                <div
                  className={traj.id === activeTrajectoryId ? 'tl-row active' : 'tl-row'}
                  title={`${traj.label} — ${traj.points.filter((p) => p.kind === 'anchor').length} impact(s)`}
                  style={{
                    left: traj.tStart * pxPerFrame,
                    width: (traj.tEnd - traj.tStart + 1) * pxPerFrame,
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    useStore.getState().setActiveTrajectory(traj.id);
                  }}
                >
                  {traj.occlusions.map((occ, i) => (
                    <div
                      key={i}
                      className="tl-occ"
                      style={{
                        left: (occ.from - traj.tStart) * pxPerFrame,
                        width: (occ.to - occ.from + 1) * pxPerFrame,
                      }}
                    />
                  ))}
                  {traj.points.map((point, index) => {
                    const selected =
                      selection?.kind === 'point' &&
                      selection.trajectoryId === traj.id &&
                      selection.index === index;
                    return (
                      <div
                        key={`${point.t}-${index}`}
                        className={selected ? 'tl-point selected' : 'tl-point'}
                        title={`#${point.t} ${point.kind}${point.tag ? ` ${point.tag}` : ''}`}
                        style={{
                          left: (point.t - traj.tStart) * pxPerFrame - 2,
                          background:
                            point.kind === 'path' ? '#ffd166' : TAG_COLORS[point.tag ?? 'other'],
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          useStore.getState().setActiveTrajectory(traj.id);
                          useStore.getState().syncFrame(point.t);
                          useStore
                            .getState()
                            .select({ kind: 'point', trajectoryId: traj.id, index });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {pendingIn !== null && (
            <div className="tl-marker in" style={{ left: pendingIn * pxPerFrame }} />
          )}
          {pendingOut !== null && (
            <div className="tl-marker out" style={{ left: pendingOut * pxPerFrame }} />
          )}
          <div className="tl-playhead" style={{ left: frame * pxPerFrame }} />
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
