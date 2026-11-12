import type {
  BrowseResult,
  Document,
  LoadedAnnotations,
  VideoList,
  VideoMeta,
} from './types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep the status line */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean }>('/health'),
  config: () => request<{ videoRoot: string; proxy: boolean }>('/config'),
  setRoot: (videoRoot: string) =>
    request<{ videoRoot: string }>('/config', {
      method: 'PUT',
      body: JSON.stringify({ videoRoot }),
    }),
  browse: (path?: string) =>
    request<BrowseResult>(`/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  videos: () => request<VideoList>('/videos'),
  meta: (id: string) => request<VideoMeta>(`/videos/${id}/meta`),
  prepare: (id: string) =>
    request<{ state: string; progress: number }>(`/videos/${id}/prepare`, { method: 'POST' }),
  proxy: (id: string) => request<{ state: string; progress: number }>(`/videos/${id}/proxy`),
  annotations: (id: string) => request<LoadedAnnotations>(`/videos/${id}/annotations`),
  save: (id: string, doc: Document, force = false) =>
    request<{ saved: boolean }>(`/videos/${id}/annotations${force ? '?force=true' : ''}`, {
      method: 'PUT',
      body: JSON.stringify(doc),
    }),
  adopt: (id: string, doc: Document) =>
    request<{ saved: boolean }>(`/videos/${id}/adopt`, {
      method: 'POST',
      body: JSON.stringify(doc),
    }),
  mediaUrl: (id: string) => `${BASE}/videos/${id}/media`,
  frameUrl: (id: string, n: number, w?: number) =>
    `${BASE}/videos/${id}/frame?n=${n}${w ? `&w=${w}` : ''}`,
  loupeUrl: (id: string, n: number, x: number, y: number, half: number) =>
    `${BASE}/videos/${id}/loupe?n=${n}&x=${x.toFixed(2)}&y=${y.toFixed(2)}&half=${half}`,
};
