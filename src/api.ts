import type {
  CanvasDocument,
  CanvasResponse,
  GridConfig,
  HistorySnapshotSummary,
  SiteSettings,
} from '../shared/types';

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export async function fetchCanvas(): Promise<CanvasResponse> {
  const res = await fetch('/api/canvas', { credentials: 'include' });
  return parseJson<CanvasResponse>(res);
}

export async function saveCanvasApi(doc: CanvasDocument): Promise<CanvasResponse> {
  const res = await fetch('/api/canvas', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  return parseJson<CanvasResponse>(res);
}

export async function saveCanvasCompactApi(doc: CanvasDocument): Promise<{
  ok: boolean;
  version: number;
  updatedAt: string;
  grid: GridConfig;
}> {
  const res = await fetch('/api/canvas?compact=1', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  return parseJson(res);
}

export async function saveSettingsApi(patch: Partial<SiteSettings>): Promise<{
  ok: boolean;
  settings: SiteSettings;
  grid: GridConfig;
}> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJson(res);
}

export async function unlockAuth(
  password: string,
  remember = true
): Promise<{ ok: boolean; unlocked: boolean; remember?: boolean }> {
  const res = await fetch('/api/auth/unlock', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, remember }),
  });
  return parseJson(res);
}

export async function lockAuth(): Promise<{ ok: boolean; unlocked: boolean }> {
  const res = await fetch('/api/auth/lock', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return parseJson(res);
}

export async function changePasswordApi(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean }> {
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return parseJson(res);
}

export async function revokeAllDevicesApi(keepCurrent = true): Promise<{
  ok: boolean;
  keptCurrent: boolean;
}> {
  const res = await fetch('/api/auth/revoke-all', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepCurrent }),
  });
  return parseJson(res);
}

export async function getAgentCredentialsApi(): Promise<{ ok: boolean; apiToken: string }> {
  const res = await fetch('/api/agent/credentials', { credentials: 'include' });
  return parseJson(res);
}

export async function rotateAgentTokenApi(): Promise<{ ok: boolean; apiToken: string }> {
  const res = await fetch('/api/agent/rotate-token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return parseJson(res);
}

export async function uploadImageApi(payload: {
  dataUrl?: string;
  mimeType?: string;
  dataBase64?: string;
}): Promise<{ ok: boolean; url: string }> {
  const res = await fetch('/api/uploads/image', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function fetchUrlMeta(url: string): Promise<{
  ok: boolean;
  url: string;
  title: string;
  faviconUrl: string;
}> {
  const res = await fetch('/api/meta/fetch', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return parseJson(res);
}

export async function fetchHistoryList(): Promise<{ ok: boolean; items: HistorySnapshotSummary[] }> {
  const res = await fetch('/api/history', { credentials: 'include' });
  return parseJson(res);
}

export async function createManualHistoryApi(
  label?: string
): Promise<{ ok: boolean; snapshot: HistorySnapshotSummary }> {
  const res = await fetch('/api/history', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  return parseJson(res);
}

export async function deleteHistoryApi(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return parseJson(res);
}

export async function restoreHistoryApi(
  id: string
): Promise<{ ok: boolean; canvas: CanvasResponse }> {
  const res = await fetch('/api/history/restore', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return parseJson(res);
}

export async function exportBackupApi(): Promise<{
  version: number;
  exportedAt: string;
  settings: SiteSettings;
  canvas: CanvasDocument;
}> {
  const res = await fetch('/api/backup/export', { credentials: 'include' });
  return parseJson(res);
}

export async function importBackupApi(payload: {
  canvas: unknown;
  settings?: Partial<SiteSettings>;
}): Promise<{ ok: boolean; canvas: CanvasResponse; settings: SiteSettings }> {
  const res = await fetch('/api/backup/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}
