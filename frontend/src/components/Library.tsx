import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { BrowseResult } from '../types';

const STATUS_LABELS: Record<string, string> = {
  new: 'non commencée',
  progress: 'en cours',
  done: 'terminée',
  corrupt: 'sidecar illisible',
};

export function Library() {
  const root = useStore((s) => s.root);
  const videos = useStore((s) => s.videos);
  const libraryExists = useStore((s) => s.libraryExists);
  const toast = useStore((s) => s.toast);
  const detectors = useStore((s) => s.detectors);
  const detectorBusy = useStore((s) => s.detectorBusy);
  const [path, setPath] = useState(root);
  const [detectorPath, setDetectorPath] = useState('');
  const [filter, setFilter] = useState('');
  const [browse, setBrowse] = useState<BrowseResult | null>(null);

  useEffect(() => setPath(root), [root]);
  useEffect(() => {
    setDetectorPath(detectors?.settings?.analyzerPath || detectors?.path || '');
  }, [detectors?.path, detectors?.settings?.analyzerPath]);

  const openBrowser = async (target?: string) => {
    try {
      setBrowse(await api.browse(target ?? path ?? undefined));
    } catch (error) {
      useStore.getState().notify((error as Error).message);
    }
  };

  const choose = async (target: string) => {
    await useStore.getState().setRoot(target);
    setBrowse(null);
  };

  const shown = videos.filter((v) =>
    v.relPath.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="library">
      <header className="library-head">
        <div className="library-title">
          <h1>Tennis Annotator</h1>
          <button
            className="btn tiny ghost"
            title="Fermer la session : le token sera redemandé"
            onClick={() => {
              void api.logout().finally(() => window.location.reload());
            }}
          >
            verrouiller
          </button>
        </div>
        <div className="library-root">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/chemin/vers/les/vidéos"
            spellCheck={false}
          />
          <button className="btn" onClick={() => choose(path)}>
            Ouvrir ce dossier
          </button>
          <button className="btn ghost" onClick={() => void openBrowser()}>
            Parcourir…
          </button>
          <button className="btn ghost" onClick={() => void useStore.getState().refresh()}>
            Rafraîchir
          </button>
        </div>
        {!libraryExists && (
          <p className="hint warn">Ce dossier n'existe pas ou n'est pas accessible.</p>
        )}
        {toast && (
          <p className="hint warn">
            {toast}{' '}
            <button className="link" onClick={() => useStore.getState().notify(null)}>
              ok
            </button>
          </p>
        )}
      </header>

      <div className="library-tools">
        <input
          className="filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filtrer…"
        />
        <span className="subtle">{shown.length} vidéo(s)</span>
      </div>

      <ul className="video-list">
        {shown.map((video) => (
          <li key={video.id} onClick={() => void useStore.getState().openVideo(video.id)}>
            <span className={`status status-${video.status}`}>{STATUS_LABELS[video.status] ?? video.status}</span>
            <span className="grow">{video.relPath}</span>
            <span className="mono subtle">
              {(video.sizeBytes / 1_048_576).toFixed(1)} Mo
              {video.lastFrame > 0 ? ` · #${video.lastFrame}` : ''}
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="empty">Aucune vidéo dans ce dossier.</li>}
      </ul>

      <section className="detectors-panel">
        <div className="detectors-head">
          <span className="panel-title">Détecteurs</span>
          <span className={detectors?.available ? 'chip on' : 'chip'}>
            {detectors?.available ? 'disponibles' : 'indisponibles'}
          </span>
          <span className="mono subtle">
            {detectors?.worker.state ?? '—'}
            {detectors?.worker.pid ? ` · pid ${detectors.worker.pid}` : ''}
          </span>
          <span className="spacer" />
          <span className="subtle small">
            optionnel — balle et court, fournis par le projet analyseur
          </span>
        </div>
        <div className="library-root">
          <input
            value={detectorPath}
            onChange={(event) => setDetectorPath(event.target.value)}
            placeholder="découverte automatique (../live-tennis-analyzer)"
            spellCheck={false}
          />
          <button
            className="btn"
            onClick={() =>
              void useStore.getState().saveDetectorSettings({ analyzerPath: detectorPath })
            }
          >
            Enregistrer
          </button>
          <button
            className="btn ghost"
            onClick={() => void useStore.getState().refreshDetectors(true)}
          >
            Vérifier
          </button>
          <button
            className="btn ghost"
            onClick={() => void useStore.getState().warmupDetectors()}
            disabled={!detectors?.available || detectorBusy !== null}
          >
            {detectorBusy?.startsWith('Préparation') ? 'Préparation…' : 'Préparer'}
          </button>
        </div>
        <p className="hint subtle">
          {detectors?.message ?? 'Statut inconnu.'}
          {detectors?.checks && !detectors.available && (
            <>
              {' '}
              (
              {Object.entries(detectors.checks)
                .map(([name, ok]) => `${name} ${ok ? '✓' : '✗'}`)
                .join(' · ')}
              )
            </>
          )}
        </p>
        {detectors?.interpreter?.note && (
          <p className="hint subtle small">interpréteur : {detectors.interpreter.note}</p>
        )}
        {detectorBusy && <p className="hint warn">{detectorBusy}</p>}
      </section>

      {browse && (
        <div className="modal" onClick={() => setBrowse(null)}>
          <div className="modal-body" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title mono">{browse.path}</div>
            <div className="modal-row">
              <button className="btn small ghost" onClick={() => void openBrowser(browse.parent)}>
                ..
              </button>
              <button className="btn small" onClick={() => void choose(browse.path)}>
                Choisir ce dossier
              </button>
            </div>
            <ul className="dir-list">
              {browse.entries.slice(0, 500).map((entry) => (
                <li
                  key={entry.path}
                  className={entry.video ? 'file' : ''}
                  onClick={() => {
                    if (!entry.video) void openBrowser(entry.path);
                  }}
                >
                  {entry.video ? '🎬' : '📁'} {entry.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
