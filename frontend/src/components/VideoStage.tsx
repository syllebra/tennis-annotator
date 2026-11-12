import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { courtLandmarksOf, drawOverlay, hitTest, type StageView } from '../render';
import { hoverState, useStore } from '../store';
import type { Point } from '../math';
import { LANDMARK_LABELS } from '../math';

const imageCache = new Map<string, { img: HTMLImageElement; ready: boolean }>();

function nearestFrame(pts: number[], time: number): number {
  if (pts.length === 0) return 0;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid]! <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function VideoStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drawRef = useRef<() => void>(() => undefined);
  const viewRef = useRef<StageView | null>(null);
  const draggingRef = useRef(false);

  const activeId = useStore((s) => s.activeId);
  const meta = useStore((s) => s.meta);
  const doc = useStore((s) => s.doc);
  const frame = useStore((s) => s.currentFrame);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);
  const showCourt = useStore((s) => s.showCourt);
  const wizard = useStore((s) => s.wizard);
  const activeTrajectoryId = useStore((s) => s.activeTrajectoryId);
  const occlusionStart = useStore((s) => s.occlusionStart);
  const tool = useStore((s) => s.tool);

  const view: StageView | null = (() => {
    if (!doc) return null;
    const sequence = doc.sequences.find((s) => frame >= s.tStart && frame <= s.tEnd) ?? null;
    return {
      doc,
      sequence,
      frame,
      selection,
      showCourt,
      wizard,
      activeTrajectoryId,
      occlusionStart,
    };
  })();
  viewRef.current = view;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cssW, cssH);

    const state = useStore.getState();
    const video = videoRef.current;
    const current = state.currentFrame;
    let painted = false;

    if (!state.playing && state.activeId) {
      const key = `${current}@${Math.round(cssW * dpr)}`;
      const cached = imageCache.get(key);
      if (cached?.ready) {
        ctx.drawImage(cached.img, 0, 0, cssW, cssH);
        painted = true;
      } else if (!cached && state.meta) {
        const img = new Image();
        const entry = { img, ready: false };
        img.onload = () => {
          entry.ready = true;
          drawRef.current();
        };
        img.src = api.frameUrl(
          state.activeId,
          current,
          Math.min(Math.round(cssW * dpr), state.meta.table.width),
        );
        imageCache.set(key, entry);
        while (imageCache.size > 120) {
          const oldest = imageCache.keys().next().value;
          if (oldest === undefined) break;
          imageCache.delete(oldest);
        }
      }
    }

    if (!painted && video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, cssW, cssH);
      painted = true;
    }
    if (!painted) {
      ctx.fillStyle = '#161b22';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#8b949e';
      ctx.font = '14px system-ui';
      ctx.fillText('Décodage de la frame…', 16, 28);
    }

    const currentView = viewRef.current;
    if (currentView) drawOverlay(ctx, cssW, cssH, currentView);
  }, []);

  drawRef.current = draw;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  }, [draw, frame, doc, selection, showCourt, wizard, activeTrajectoryId, occlusionStart, size, playing]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const state = useStore.getState();
      const video = videoRef.current;
      if (video && state.meta) {
        const table = state.meta.table;
        const traj = state.doc?.sequences
          .flatMap((s) => s.trajectories)
          .find((t) => t.id === state.activeTrajectoryId);
        if (state.verify && traj && video.currentTime >= (table.pts[traj.tEnd] ?? 0)) {
          video.currentTime = table.pts[traj.tStart] ?? 0;
        }
        state.syncFrame(nearestFrame(table.pts, video.currentTime));
      }
      drawRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      const state = useStore.getState();
      const pts = state.meta?.table.pts ?? [];
      const target = pts[state.currentFrame] ?? 0;
      if (Math.abs(video.currentTime - target) > 0.04) video.currentTime = target;
      void video.play().catch(() => useStore.getState().setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing]);

  const ratioFromEvent = (event: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  };

  const onPointerDown = (event: React.PointerEvent) => {
    const state = useStore.getState();
    if (!canvasRef.current || !viewRef.current) return;
    const ratio = ratioFromEvent(event);
    hoverState.x = ratio[0];
    hoverState.y = ratio[1];
    if (state.wizard) {
      state.wizardClick({ x: ratio[0], y: ratio[1] });
      return;
    }
    if (state.tool === 'anchor' || state.tool === 'path') {
      state.placeWithTool({ x: ratio[0], y: ratio[1] });
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const hit = hitTest(
      viewRef.current,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
    );
    if (!hit) {
      state.select(null);
      return;
    }
    if (hit.kind === 'landmark') {
      const seq = viewRef.current.sequence;
      const hasKeyframe = seq?.court.keyframes.some((k) => k.t === state.currentFrame);
      if (seq && !hasKeyframe && seq.court.keyframes.length > 0) {
        const nearest = seq.court.keyframes.reduce((best, k) =>
          Math.abs(k.t - state.currentFrame) < Math.abs(best.t - state.currentFrame) ? k : best,
        );
        state.syncFrame(nearest.t);
        state.select(hit);
        return;
      }
    }
    state.select(hit);
    state.beginDrag();
    draggingRef.current = true;
    canvasRef.current.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const ratio = ratioFromEvent(event);
    hoverState.x = ratio[0];
    hoverState.y = ratio[1];
    if (draggingRef.current) useStore.getState().dragTo({ x: ratio[0], y: ratio[1] });
  };

  const onPointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    useStore.getState().endDrag();
  };

  const landmarks = view ? Object.keys(courtLandmarksOf(view)) : [];
  const aspect = meta ? meta.table.width / meta.table.height : 16 / 9;

  return (
    <div className="stage" ref={containerRef}>
      <div className="stage-frame" ref={wrapperRef} style={{ aspectRatio: `${aspect}` }}>
        <video
          ref={videoRef}
          className="stage-video"
          src={activeId ? api.mediaUrl(activeId) : undefined}
          muted
          playsInline
          preload="auto"
        />
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {wizard && (
          <div className="stage-hint wizard">
            <span className="step">
              {wizard.index + 1}/{wizard.ids.length}
            </span>
            <span className="grow">
              {LANDMARK_LABELS[wizard.ids[wizard.index]!] ?? wizard.ids[wizard.index]}
            </span>
            <span className="dots">
              {wizard.ids.map((id, index) => (
                <span
                  key={id}
                  className={
                    index < wizard.index ? 'dot done' : index === wizard.index ? 'dot current' : 'dot'
                  }
                >
                  {index + 1}
                </span>
              ))}
            </span>
            <button className="link" onClick={() => useStore.getState().cancelWizard()}>
              annuler
            </button>
          </div>
        )}
        {(tool === 'anchor' || tool === 'path') && (
          <div className="stage-hint armed">
            Clique la balle pour poser {tool === 'anchor' ? 'une ancre' : 'un point de passage'}
            <button className="link" onClick={() => useStore.getState().setTool('select')}>
              annuler
            </button>
          </div>
        )}
        {landmarks.length === 0 && view?.sequence && showCourt && (
          <div className="stage-hint subtle">C pour poser les 4 coins du court</div>
        )}
        {meta?.needsProxy && meta.proxy.state !== 'done' && (
          <div className="stage-proxy">
            {meta.proxy.state === 'error'
              ? 'Lecture continue indisponible — navigation frame par frame uniquement'
              : `Préparation de la lecture… ${Math.round((meta.proxy.progress ?? 0) * 100)} %`}
          </div>
        )}
      </div>
    </div>
  );
}
