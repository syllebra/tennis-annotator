import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { activeSequenceOf, useStore } from '../store';
import type { XY } from '../types';

const BOX = 260;

export function Loupe() {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const activeId = useStore((s) => s.activeId);
  const frame = useStore((s) => s.currentFrame);
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.loupeZoom);
  const boxRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<XY | null>(null);
  const draggingRef = useRef(false);

  const sequence = doc ? activeSequenceOf({ doc, currentFrame: frame }) : null;
  const keyframe = sequence?.court.keyframes.find((k) => k.t === frame) ?? null;

  let point: XY | null = null;
  let pointFrame = frame;
  if (selection?.kind === 'point' && doc) {
    for (const seq of doc.sequences) {
      const traj = seq.trajectories.find((t) => t.id === selection.trajectoryId);
      if (traj) {
        const p = traj.points[selection.index];
        if (p) {
          point = { x: p.x, y: p.y };
          pointFrame = p.t;
        }
      }
    }
  } else if (selection?.kind === 'landmark' && keyframe) {
    const p = keyframe.landmarks[selection.landmarkId];
    if (p) {
      point = { x: p.x, y: p.y };
      pointFrame = keyframe.t;
    }
  }

  useEffect(() => {
    if (point) setAnchor({ x: point.x, y: point.y });
    else setAnchor(null);
    // only re-anchor when the selection or its frame changes, not on every pixel move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, pointFrame, activeId]);

  const width = meta?.table.width ?? 1920;
  const height = meta?.table.height ?? 1080;
  const half = Math.max(8, Math.round(BOX / (2 * zoom)));
  const size = Math.max(16, Math.min(half * 2, Math.min(width, height)));
  const centerX = Math.max(0, Math.min(width - size, Math.round((anchor?.x ?? 0.5) * width) - Math.floor(size / 2)));
  const centerY = Math.max(0, Math.min(height - size, Math.round((anchor?.y ?? 0.5) * height) - Math.floor(size / 2)));

  const src =
    activeId && point
      ? api.loupeUrl(activeId, pointFrame, (anchor?.x ?? point.x) * width, (anchor?.y ?? point.y) * height, half)
      : null;

  const scale = BOX / size;
  const crossX = point ? ((point.x * width - centerX) * scale) : 0;
  const crossY = point ? ((point.y * height - centerY) * scale) : 0;

  const toRatio = (clientX: number, clientY: number): XY => {
    const rect = boxRef.current!.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    return {
      x: (centerX + u * size) / width,
      y: (centerY + v * size) / height,
    };
  };

  return (
    <div
      className="loupe"
      onFocus={() => useStore.getState().setLoupeFocused(true)}
      onBlur={() => useStore.getState().setLoupeFocused(false)}
      tabIndex={0}
    >
      <div className="panel-title">
        Loupe <span className="mono subtle">{point ? `#${pointFrame}` : '—'}</span>
      </div>
      <div
        className="loupe-box"
        ref={boxRef}
        style={{ width: BOX, height: BOX }}
        onPointerDown={(event) => {
          if (!point) return;
          useStore.getState().setLoupeFocused(true);
          setAnchor({ x: point.x, y: point.y });
          const ratio = toRatio(event.clientX, event.clientY);
          useStore.getState().beginDrag();
          useStore.getState().dragTo(ratio);
          draggingRef.current = true;
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          boxRef.current?.focus();
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current || !point) return;
          useStore.getState().dragTo(toRatio(event.clientX, event.clientY));
        }}
        onPointerUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          useStore.getState().endDrag();
        }}
      >
        {src ? (
          <img src={src} alt="loupe" draggable={false} />
        ) : (
          <div className="loupe-empty">Sélectionne un point</div>
        )}
        {point && (
          <>
            <div className="loupe-cross-v" style={{ left: crossX }} />
            <div className="loupe-cross-h" style={{ top: crossY }} />
          </>
        )}
      </div>
      <div className="loupe-controls">
        <label>
          zoom ×{zoom.toFixed(0)}
          <input
            type="range"
            min={4}
            max={24}
            step={1}
            value={zoom}
            onChange={(event) => useStore.getState().setLoupeZoom(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="loupe-readout mono subtle">
        {point ? `x ${point.x.toFixed(6)}  y ${point.y.toFixed(6)}` : '—'}
      </div>
      <div className="loupe-help subtle">
        Flèches = 0,1 px · Shift = 1 px · Alt = 5 px (loupe focus)
      </div>
    </div>
  );
}
