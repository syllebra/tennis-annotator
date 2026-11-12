import { useEffect, useRef, useState } from 'react';
import { activeSequenceOf, useStore } from '../store';
import { TAG_COLORS } from '../render';

const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

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

  // keep the playhead in view
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const x = frame * pxPerFrame;
    const left = body.scrollLeft;
    const right = left + body.clientWidth;
    if (x < left + 40) body.scrollLeft = Math.max(0, x - 40);
    else if (x > right - 80) body.scrollLeft = x - body.clientWidth + 80;
  }, [frame, pxPerFrame]);

  const frameAt = (clientX: number): number => {
    const body = bodyRef.current;
    if (!body) return 0;
    const rect = body.getBoundingClientRect();
    const x = clientX - rect.left + body.scrollLeft;
    return Math.round(x / pxPerFrame);
  };

  const scrub = (event: React.PointerEvent) => {
    if (event.buttons !== 1 && event.type === 'pointermove') return;
    useStore.getState().setFrame(frameAt(event.clientX));
  };

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const anchorFrame = (event.clientX - rect.left + body.scrollLeft) / pxPerFrame;
      const next = Math.min(24, Math.max(0.02, pxPerFrame * (event.deltaY < 0 ? 1.15 : 0.87)));
      setPxPerFrame(next);
      requestAnimationFrame(() => {
        body.scrollLeft = anchorFrame * next - (event.clientX - rect.left);
      });
    };
    const body = bodyRef.current;
    body?.addEventListener('wheel', onWheel, { passive: false });
    return () => body?.removeEventListener('wheel', onWheel);
  }, [pxPerFrame]);

  const step = TICK_STEPS.find((s) => s * pxPerFrame >= 56) ?? 10000;
  const visibleStart = Math.max(0, Math.floor(scrollLeft / pxPerFrame) - step);
  const visibleEnd = Math.min(total, Math.ceil((scrollLeft + viewport) / pxPerFrame) + step);
  const ticks: number[] = [];
  for (let f = Math.ceil(visibleStart / step) * step; f <= visibleEnd; f += step) ticks.push(f);

  if (!doc || !meta) return null;

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <span className="mono">
          #{frame} / {total - 1}
        </span>
        <span className="tl-time mono">{formatTime(meta.table.pts[frame] ?? 0)}</span>
        <span className="separator" />
        <label className="tl-zoom">
          zoom
          <input
            type="range"
            min={-3}
            max={3}
            step={0.05}
            value={Math.log10(pxPerFrame)}
            onChange={(event) => setPxPerFrame(10 ** Number(event.target.value))}
          />
        </label>
        <span className="separator" />
        <span className={pendingIn !== null ? 'mono chip on' : 'mono chip'}>
          IN {pendingIn ?? '—'}
        </span>
        <span className={pendingOut !== null ? 'mono chip on' : 'mono chip'}>
          OUT {pendingOut ?? '—'}
        </span>
        <button className="btn small" onClick={() => useStore.getState().createSequence()}>
          Créer la séquence
        </button>
        <button className="btn small ghost" onClick={() => useStore.getState().clearRange()}>
          effacer
        </button>
        <span className="spacer" />
        {occlusionStart !== null && (
          <span className="chip warn mono">occultation ouverte @ {occlusionStart}</span>
        )}
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
                style={{ left: seq.tStart * pxPerFrame, width: (seq.tEnd - seq.tStart + 1) * pxPerFrame }}
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
            {sequence?.trajectories.map((traj) => (
              <div
                key={traj.id}
                className={traj.id === activeTrajectoryId ? 'tl-row active' : 'tl-row'}
                style={{ left: traj.tStart * pxPerFrame, width: (traj.tEnd - traj.tStart + 1) * pxPerFrame }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  useStore.getState().setActiveTrajectory(traj.id);
                }}
              >
                <span className="tl-row-label">{traj.label}</span>
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
                        useStore.getState().select({ kind: 'point', trajectoryId: traj.id, index });
                      }}
                    />
                  );
                })}
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
