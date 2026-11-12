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
  const [path, setPath] = useState(root);
  const [filter, setFilter] = useState('');
  const [browse, setBrowse] = useState<BrowseResult | null>(null);

  useEffect(() => setPath(root), [root]);

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
        <h1>Tennis Annotator</h1>
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
