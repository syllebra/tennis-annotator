import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { trajectoryPoint } from '../derive';
import { segmentView } from '../render';
import { useStore } from '../store';

const BOX = 300;
const PLAYBACK_REFRESH_MS = 120;

/**
 * Verification ball-cam: a magnified crop centred on the annotated position.
 * The ball must stay under the crosshair; stepping frame by frame makes drift
 * obvious without losing the whole-frame context.
 */
export function BallCam() {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const activeId = useStore((s) => s.activeId);
  const frame = useStore((s) => s.currentFrame);
  const playing = useStore((s) => s.playing);
  const activeTrajectoryId = useStore((s) => s.activeTrajectoryId);
  const zoom = useStore((s) => s.verifyZoom);
  const [shownFrame, setShownFrame] = useState(frame);
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (!playing) {
      setShownFrame(frame);
      lastRefresh.current = 0;
      return;
    }
    const now = performance.now();
    if (now - lastRefresh.current < PLAYBACK_REFRESH_MS) return;
    lastRefresh.current = now;
    setShownFrame(frame);
  }, [frame, playing]);

  const traj = activeTrajectoryId
    ? doc?.sequences.flatMap((s) => s.trajectories).find((t) => t.id === activeTrajectoryId) ?? null
    : null;
  const point = traj ? trajectoryPoint(traj, shownFrame) : null;
  const segments = traj ? segmentView(traj, shownFrame) : null;

  const width = meta?.table.width ?? 1920;
  const height = meta?.table.height ?? 1080;
  const half = Math.max(8, Math.round(BOX / (2 * zoom)));
  const size = Math.max(16, Math.min(half * 2, Math.min(width, height)));
  const cx = point
    ? Math.max(0, Math.min(width - size, Math.round(point[0] * width) - Math.floor(size / 2)))
    : 0;
  const cy = point
    ? Math.max(0, Math.min(height - size, Math.round(point[1] * height) - Math.floor(size / 2)))
    : 0;
  const crossX = point ? ((point[0] * width - cx) / size) * BOX : 0;
  const crossY = point ? ((point[1] * height - cy) / size) * BOX : 0;
  const outOfFrame = point ? point[0] < 0 || point[0] > 1 || point[1] < 0 || point[1] > 1 : false;

  const store = useStore.getState();

  return (
    <div className="ballcam" onPointerDown={(event) => event.stopPropagation()}>
      <div className="ballcam-head">
        <span className="ballcam-title">Vérification</span>
        <span className="mono subtle">#{shownFrame}</span>
        {segments && segments.count > 0 && (
          <span className="mono subtle">
            seg {segments.index + 1}/{segments.count}
          </span>
        )}
        <span className="spacer" />
        <button
          className="btn tiny ghost"
          onClick={() => store.toggleVerify()}
          title="Quitter la vérification (V)"
        >
          ✕
        </button>
      </div>

      <div className="ballcam-box" style={{ width: BOX, height: BOX }}>
        {!traj && <div className="ballcam-empty">Sélectionne un échange à vérifier.</div>}
        {traj && !point && <div className="ballcam-empty">Hors de l’échange à cette frame.</div>}
        {traj && point && activeId && (
          <>
            <img
              src={api.loupeUrl(activeId, shownFrame, point[0] * width, point[1] * height, half)}
              alt=""
              draggable={false}
            />
            <div className="ballcam-cross-v" style={{ left: crossX }} />
            <div className="ballcam-cross-h" style={{ top: crossY }} />
            {outOfFrame && <div className="ballcam-badge warn">balle annotée hors cadre</div>}
          </>
        )}
        {meta?.needsProxy && meta.proxy.state === 'running' && (
          <div className="ballcam-badge">proxy {Math.round(meta.proxy.progress * 100)} %</div>
        )}
      </div>

      <div className="ballcam-controls">
        <button
          className="btn tiny"
          onClick={() => store.stepFrame(-1)}
          title="Frame précédente (←)"
        >
          ◀
        </button>
        <button
          className={playing ? 'btn tiny on' : 'btn tiny'}
          onClick={() => store.setPlaying(!playing)}
          title="Rejouer l’échange (Espace)"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="btn tiny" onClick={() => store.stepFrame(1)} title="Frame suivante (→)">
          ▶
        </button>
        <span className="separator" />
        <button
          className="btn tiny"
          onClick={() => store.setVerifyZoom(zoom / 1.25)}
          title="Dézoomer le suivi"
        >
          −
        </button>
        <span className="mono subtle ballcam-zoom">×{zoom.toFixed(1)}</span>
        <button
          className="btn tiny"
          onClick={() => store.setVerifyZoom(zoom * 1.25)}
          title="Zoomer le suivi"
        >
          +
        </button>
      </div>
      <p className="ballcam-hint">
        La croix marque la position annotée : la balle doit rester dessous. Avance frame par frame.
      </p>
    </div>
  );
}
