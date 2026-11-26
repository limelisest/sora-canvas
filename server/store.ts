import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  BookmarkItem,
  CanvasDocument,
  CanvasWidget,
  FolderContainer,
  FolderDisplayMode,
  GridConfig,
  HistorySnapshotSummary,
  SiteSettings,
  ZoneContainer,
} from '../shared/types.js';
import { normalizeSiteSettings } from '../shared/settings.js';
import { clampZoneSize, isEntityInsideZone, validateCanvasDocument } from '../shared/gridEngine.js';

const MAX_HISTORY_SNAPSHOTS = 30;
const SNAPSHOT_COALESCE_MS = 5 * 60 * 1000;
const DEFAULT_GRID: GridConfig = { cellSize: 108, gap: 14 };
let snapshotSeq = 0;

const canvasCache = new Map<string, { mtimeMs: number; doc: CanvasDocument }>();
const settingsCache = new Map<string, { mtimeMs: number; settings: SiteSettings }>();

interface LegacyV1Child {
  id: string;
  title: string;
  url: string;
  subtitle?: string;
  icon?: string;
  faviconUrl?: string;
  accent?: string;
  tags?: string[];
}

interface LegacyV1Node {
  id: string;
  type: 'link' | 'folder';
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  accent?: string;
  url?: string;
  subtitle?: string;
  icon?: string;
  faviconUrl?: string;
  tags?: string[];
  displayMode?: FolderDisplayMode;
  isPrivate?: boolean;
  children?: LegacyV1Child[];
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyV1Document {
  version: 1;
  updatedAt: string;
  grid?: GridConfig;
  nodes: LegacyV1Node[];
}

interface HistorySnapshotFile {
  id: string;
  createdAt: string;
  reason: string;
  document: CanvasDocument | LegacyV1Document;
}

export function migrateV1ToV2(v1: LegacyV1Document): CanvasDocument {
  const now = v1.updatedAt || new Date().toISOString();
  const folders: FolderContainer[] = [];
  const items: BookmarkItem[] = [];
  const usedIds = new Set<string>();

  const claimId = (preferred: string, prefix: string): string => {
    if (preferred && !usedIds.has(preferred)) {
      usedIds.add(preferred);
      return preferred;
    }
    const next = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
    usedIds.add(next);
    return next;
  };

  for (const node of v1.nodes) {
    if (node.type === 'folder') {
      const folderId = claimId(node.id, 'folder');
      folders.push({
        id: folderId,
        title: node.title,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        displayMode: node.displayMode === 'list' ? 'list' : 'grid',
        isPrivate: Boolean(node.isPrivate),
        accent: node.accent,
        createdAt: node.createdAt || now,
        updatedAt: node.updatedAt || now,
      });

      const children = Array.isArray(node.children) ? node.children : [];
      children.forEach((child, idx) => {
        items.push({
          id: claimId(child.id, 'item'),
          title: child.title,
          url: child.url,
          subtitle: child.subtitle,
          icon: child.icon,
          faviconUrl: child.faviconUrl,
          accent: child.accent,
          tags: child.tags ? [...child.tags] : undefined,
          parentId: folderId,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          order: idx,
          createdAt: node.createdAt || now,
          updatedAt: node.updatedAt || now,
        });
      });
    } else {
      items.push({
        id: claimId(node.id, 'item'),
        title: node.title,
        url: node.url || 'https://example.com',
        subtitle: node.subtitle,
        icon: node.icon,
        faviconUrl: node.faviconUrl,
        accent: node.accent,
        tags: node.tags ? [...node.tags] : undefined,
        parentId: null,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        order: 0,
        createdAt: node.createdAt || now,
        updatedAt: node.updatedAt || now,
      });
    }
  }

  return {
    version: 2,
    updatedAt: now,
    grid: v1.grid ?? { ...DEFAULT_GRID },
    folders,
    items,
    zones: [],
    widgets: [],
  };
}

export function createSeedCanvas(): CanvasDocument {
  const now = new Date().toISOString();
  return {
    version: 2,
    updatedAt: now,
    grid: { ...DEFAULT_GRID },
    zones: [],
    widgets: [],
    folders: [
      {
        id: 'seed-compact-tools',
        title: '效率收纳',
        x: 1,
        y: -1,
        w: 1,
        h: 1,
        displayMode: 'grid',
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'seed-ai-workbench',
        title: 'AI 工作台',
        x: -2,
        y: 0,
        w: 2,
        h: 2,
        displayMode: 'list',
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'seed-intranet-common',
        title: '内网与常用',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        displayMode: 'grid',
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'seed-private-vault',
        title: '私密收藏',
        x: 2,
        y: -1,
        w: 2,
        h: 2,
        displayMode: 'grid',
        isPrivate: true,
        accent: '#f59e0b',
        createdAt: now,
        updatedAt: now,
      },
    ],
    items: [
      {
        id: 'seed-neko-console',
        title: 'Sora 控制台',
        subtitle: 'console.example.com',
        url: 'https://example.com',
        icon: 'Terminal',
        accent: '#ff5500',
        tags: ['控制台', 'Home'],
        parentId: null,
        x: -2,
        y: -1,
        w: 2,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'seed-booth-assets',
        title: 'Booth 资源',
        subtitle: 'booth.pm',
        url: 'https://booth.pm',
        icon: 'Package',
        tags: ['3D', '素材'],
        parentId: null,
        x: 0,
        y: -1,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-github',
        title: 'GitHub',
        url: 'https://github.com',
        subtitle: '代码托管',
        icon: 'Code2',
        parentId: 'seed-compact-tools',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-cloudflare',
        title: 'Cloudflare',
        url: 'https://dash.cloudflare.com',
        subtitle: '边缘与 Tunnel',
        icon: 'Cloud',
        parentId: 'seed-compact-tools',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-excalidraw',
        title: 'Excalidraw',
        url: 'https://excalidraw.com',
        subtitle: '手绘白板',
        icon: 'PenTool',
        parentId: 'seed-compact-tools',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-regex',
        title: 'Regex101',
        url: 'https://regex101.com',
        subtitle: '正则调试',
        icon: 'Braces',
        parentId: 'seed-compact-tools',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-chatgpt',
        title: 'ChatGPT',
        url: 'https://chatgpt.com',
        subtitle: 'OpenAI 对话助手',
        icon: 'Sparkles',
        parentId: 'seed-ai-workbench',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-claude',
        title: 'Claude',
        url: 'https://claude.ai',
        subtitle: 'Anthropic 深度协作',
        icon: 'Bot',
        parentId: 'seed-ai-workbench',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-gemini',
        title: 'Google AI Studio',
        url: 'https://aistudio.google.com',
        subtitle: 'Gemini 实验平台',
        icon: 'Cpu',
        parentId: 'seed-ai-workbench',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-deepseek',
        title: 'DeepSeek',
        url: 'https://chat.deepseek.com',
        subtitle: '推理与编程模型',
        icon: 'BrainCircuit',
        parentId: 'seed-ai-workbench',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-pve',
        title: 'Proxmox VE',
        url: 'http://192.168.1.10:8006',
        subtitle: '虚拟化宿主机',
        icon: 'Server',
        parentId: 'seed-intranet-common',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-nas',
        title: 'NAS 存储',
        url: 'http://192.168.1.20:5000',
        subtitle: '文件与备份',
        icon: 'HardDrive',
        parentId: 'seed-intranet-common',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-portainer',
        title: 'Portainer',
        url: 'http://192.168.1.10:9000',
        subtitle: '容器编排面板',
        icon: 'Box',
        parentId: 'seed-intranet-common',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-router',
        title: '主路由网关',
        url: 'http://192.168.1.1',
        subtitle: 'OpenWrt',
        icon: 'Router',
        parentId: 'seed-intranet-common',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-vaultwarden',
        title: '私密密码库',
        url: 'https://vault.internal.example',
        subtitle: 'Vaultwarden',
        icon: 'KeyRound',
        parentId: 'seed-private-vault',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'child-private-notes',
        title: '私人备忘录',
        url: 'https://notes.internal.example',
        subtitle: '加密笔记',
        icon: 'NotebookPen',
        parentId: 'seed-private-vault',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

export function normalizeDocument(
  raw: unknown
): { doc: CanvasDocument; migrated: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version === 2 && Array.isArray(obj.folders) && Array.isArray(obj.items)) {
    const rawDoc = raw as CanvasDocument;
    let modeMigrated = false;
    const folders = rawDoc.folders.map((f) => {
      const rawMode = (f as { displayMode?: string }).displayMode;
      if (rawMode !== 'grid' && rawMode !== 'list') {
        modeMigrated = true;
        return { ...f, displayMode: 'grid' as const };
      }
      return f;
    });
    const zones: ZoneContainer[] = Array.isArray(rawDoc.zones)
      ? rawDoc.zones.map((z) => {
          const nextW = clampZoneSize(typeof z.w === 'number' && Number.isFinite(z.w) ? z.w : 4);
          const nextH = clampZoneSize(typeof z.h === 'number' && Number.isFinite(z.h) ? z.h : 2);
          if (z.w !== nextW || z.h !== nextH) {
            modeMigrated = true;
          }
          return {
            ...z,
            w: nextW,
            h: nextH,
            isPrivate: Boolean(z.isPrivate),
          };
        })
      : [];
    const widgets: CanvasWidget[] = Array.isArray(rawDoc.widgets) ? rawDoc.widgets : [];
    return {
      doc: {
        ...rawDoc,
        folders,
        zones,
        widgets,
      },
      migrated: modeMigrated,
    };
  }
  if (obj.version === 1 && Array.isArray(obj.nodes)) {
    return { doc: migrateV1ToV2(raw as LegacyV1Document), migrated: true };
  }
  return null;
}

export async function loadSettings(dataDir: string): Promise<SiteSettings> {
  const settingsPath = path.join(dataDir, 'settings.json');
  const cacheKey = path.resolve(settingsPath);
  try {
    const stat = await fs.stat(settingsPath);
    const cached = settingsCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.settings;
    }
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SiteSettings>;
    const normalized = normalizeSiteSettings(parsed);
    settingsCache.set(cacheKey, { mtimeMs: stat.mtimeMs, settings: normalized });
    return normalized;
  } catch {
    return normalizeSiteSettings(null);
  }
}

export async function saveSettings(
  dataDir: string,
  patch: Partial<SiteSettings>
): Promise<SiteSettings> {
  const current = await loadSettings(dataDir);
  const next = normalizeSiteSettings({ ...current, ...patch });
  const settingsPath = path.join(dataDir, 'settings.json');
  await atomicWriteJson(settingsPath, next);
  try {
    const stat = await fs.stat(settingsPath);
    settingsCache.set(path.resolve(settingsPath), { mtimeMs: stat.mtimeMs, settings: next });
  } catch {
    settingsCache.delete(path.resolve(settingsPath));
  }
  return next;
}

export async function loadCanvas(dataDir: string): Promise<CanvasDocument> {
  const canvasPath = path.join(dataDir, 'canvas.json');
  const cacheKey = path.resolve(canvasPath);
  try {
    const stat = await fs.stat(canvasPath);
    const cached = canvasCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.doc;
    }
    const raw = await fs.readFile(canvasPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeDocument(parsed);
    if (normalized) {
      if (normalized.migrated) {
        await atomicWriteJson(canvasPath, normalized.doc);
        const newStat = await fs.stat(canvasPath);
        canvasCache.set(cacheKey, { mtimeMs: newStat.mtimeMs, doc: normalized.doc });
      } else {
        canvasCache.set(cacheKey, { mtimeMs: stat.mtimeMs, doc: normalized.doc });
      }
      return normalized.doc;
    }
  } catch {
    // Seed below
  }

  const seed = createSeedCanvas();
  await atomicWriteJson(canvasPath, seed);
  try {
    const stat = await fs.stat(canvasPath);
    canvasCache.set(cacheKey, { mtimeMs: stat.mtimeMs, doc: seed });
  } catch {
    // ignore
  }
  return seed;
}

export async function writeSnapshot(
  dataDir: string,
  doc: CanvasDocument,
  reason: string
): Promise<HistorySnapshotSummary> {
  const historyDir = path.join(dataDir, 'history');
  await fs.mkdir(historyDir, { recursive: true });

  const seq = String(snapshotSeq++ % 10000).padStart(4, '0');
  const id = `${Date.now()}-${seq}-${crypto.randomBytes(2).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const snapshot: HistorySnapshotFile = {
    id,
    createdAt,
    reason,
    document: doc,
  };

  await atomicWriteJson(path.join(historyDir, `${id}.json`), snapshot);

  const files = (await fs.readdir(historyDir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length > MAX_HISTORY_SNAPSHOTS) {
    const toDelete = files.slice(0, files.length - MAX_HISTORY_SNAPSHOTS);
    await Promise.all(toDelete.map((f) => fs.unlink(path.join(historyDir, f)).catch(() => {})));
  }

  return {
    id,
    createdAt,
    reason,
    nodeCount:
      doc.folders.length +
      doc.items.length +
      (doc.zones?.length ?? 0) +
      (doc.widgets?.length ?? 0),
  };
}

async function readLatestSnapshotMeta(
  dataDir: string
): Promise<{ reason: string; createdAtMs: number } | null> {
  const historyDir = path.join(dataDir, 'history');
  let files: string[] = [];
  try {
    files = (await fs.readdir(historyDir)).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return null;
  }

  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(historyDir, file), 'utf8');
      const parsed = JSON.parse(raw) as Partial<HistorySnapshotFile>;
      const createdAtMs = typeof parsed.createdAt === 'string' ? Date.parse(parsed.createdAt) : NaN;
      if (typeof parsed.reason === 'string' && Number.isFinite(createdAtMs)) {
        return { reason: parsed.reason, createdAtMs };
      }
    } catch {
      // Skip corrupted snapshot
    }
  }
  return null;
}

export async function createManualSnapshot(
  dataDir: string,
  label?: string
): Promise<HistorySnapshotSummary> {
  const doc = await loadCanvas(dataDir);
  const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 60) : '';
  const reason = cleanLabel ? `manual:${cleanLabel}` : 'manual';
  return writeSnapshot(dataDir, doc, reason);
}

export async function deleteHistorySnapshot(dataDir: string, snapshotId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(snapshotId)) {
    throw new Error('无效的快照 ID');
  }
  const snapshotPath = path.join(dataDir, 'history', `${snapshotId}.json`);
  try {
    await fs.unlink(snapshotPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error('快照不存在');
    }
    throw err;
  }
  void pruneOrphanedUploads(dataDir).catch(() => {});
}

export async function saveCanvas(
  dataDir: string,
  nextDoc: CanvasDocument,
  reason = 'manual_save'
): Promise<CanvasDocument> {
  const validation = validateCanvasDocument(nextDoc);
  if (!validation.valid) {
    throw new Error(validation.error || '画布布局校验失败');
  }

  const prev = await loadCanvas(dataDir);
  let shouldSnapshot = true;
  if (reason === 'canvas_put') {
    const latest = await readLatestSnapshotMeta(dataDir);
    if (
      latest &&
      latest.reason === 'canvas_put' &&
      Date.now() - latest.createdAtMs < SNAPSHOT_COALESCE_MS
    ) {
      shouldSnapshot = false;
    }
  }

  if (shouldSnapshot) {
    await writeSnapshot(dataDir, prev, reason);
  }

  const stamped: CanvasDocument = {
    version: 2,
    updatedAt: new Date().toISOString(),
    grid: nextDoc.grid ?? { ...DEFAULT_GRID },
    folders: nextDoc.folders,
    items: nextDoc.items,
    zones: nextDoc.zones ?? [],
    widgets: nextDoc.widgets ?? [],
  };

  const canvasPath = path.join(dataDir, 'canvas.json');
  await atomicWriteJson(canvasPath, stamped);
  try {
    const stat = await fs.stat(canvasPath);
    canvasCache.set(path.resolve(canvasPath), { mtimeMs: stat.mtimeMs, doc: stamped });
  } catch {
    canvasCache.delete(path.resolve(canvasPath));
  }
  void pruneOrphanedUploads(dataDir).catch(() => {});
  return stamped;
}

export async function listHistory(dataDir: string): Promise<HistorySnapshotSummary[]> {
  const historyDir = path.join(dataDir, 'history');
  let files: string[] = [];
  try {
    files = (await fs.readdir(historyDir)).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }

  const items: HistorySnapshotSummary[] = [];
  for (const file of files.slice(0, MAX_HISTORY_SNAPSHOTS)) {
    try {
      const raw = await fs.readFile(path.join(historyDir, file), 'utf8');
      const parsed = JSON.parse(raw) as HistorySnapshotFile;
      const doc = parsed.document as Partial<CanvasDocument> & Partial<LegacyV1Document>;
      const nodeCount =
        Array.isArray(doc?.folders) && Array.isArray(doc?.items)
          ? doc.folders.length +
            doc.items.length +
            (Array.isArray(doc.zones) ? doc.zones.length : 0) +
            (Array.isArray(doc.widgets) ? doc.widgets.length : 0)
          : Array.isArray(doc?.nodes)
            ? doc.nodes.length
            : 0;
      items.push({
        id: parsed.id,
        createdAt: parsed.createdAt,
        reason: parsed.reason,
        nodeCount,
      });
    } catch {
      // Skip corrupted snapshot
    }
  }
  return items;
}

export async function restoreHistorySnapshot(
  dataDir: string,
  snapshotId: string
): Promise<CanvasDocument> {
  if (!/^[a-zA-Z0-9_-]+$/.test(snapshotId)) {
    throw new Error('无效的快照 ID');
  }
  const snapshotPath = path.join(dataDir, 'history', `${snapshotId}.json`);
  const raw = await fs.readFile(snapshotPath, 'utf8');
  const parsed = JSON.parse(raw) as HistorySnapshotFile;
  const normalized = normalizeDocument(parsed?.document);
  if (!normalized) {
    throw new Error('快照数据已损坏');
  }
  return saveCanvas(dataDir, normalized.doc, `restore:${snapshotId}`);
}

export function sanitizeCanvasForPublic(doc: CanvasDocument): {
  doc: CanvasDocument;
  hasPrivateHidden: boolean;
} {
  const allZones = doc.zones ?? [];
  const allWidgets = doc.widgets ?? [];

  const privateZones = allZones.filter((z) => z.isPrivate);
  const publicZones = allZones.filter((z) => !z.isPrivate);

  const privateFolderIds = new Set<string>();
  const publicFolders: FolderContainer[] = [];

  for (const folder of doc.folders) {
    if (folder.isPrivate || privateZones.some((pz) => isEntityInsideZone(folder, pz))) {
      privateFolderIds.add(folder.id);
    } else {
      publicFolders.push(folder);
    }
  }

  let hiddenTopItems = 0;
  const publicItems = doc.items.filter((item) => {
    if (item.parentId !== null) {
      return !privateFolderIds.has(item.parentId);
    }
    const insidePrivateZone = privateZones.some((pz) => isEntityInsideZone(item, pz));
    if (insidePrivateZone) {
      hiddenTopItems++;
      return false;
    }
    return true;
  });

  const publicWidgets = allWidgets.filter((widget) => {
    if (widget.kind === 'note' && widget.isPrivate) return false;
    if (privateZones.some((pz) => isEntityInsideZone(widget, pz))) return false;
    return true;
  });

  const hasPrivateHidden =
    privateZones.length > 0 ||
    privateFolderIds.size > 0 ||
    hiddenTopItems > 0 ||
    publicWidgets.length < allWidgets.length;

  return {
    doc: {
      ...doc,
      folders: publicFolders,
      items: publicItems,
      zones: publicZones,
      widgets: publicWidgets,
    },
    hasPrivateHidden,
  };
}

const UPLOAD_REF_RE = /\/api\/uploads\/([a-f0-9]{16,64}\.(?:png|jpg|jpeg|webp|gif|avif))/gi;
const UPLOAD_FILE_RE = /^[a-f0-9]{16,64}\.(png|jpg|jpeg|webp|gif|avif)$/i;
const TMP_RESIDUAL_MAX_AGE_MS = 10 * 60 * 1000;

function collectUploadRefsFromText(raw: string, out: Set<string>): void {
  UPLOAD_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = UPLOAD_REF_RE.exec(raw)) !== null) {
    out.add(match[1]);
  }
}

export async function pruneOrphanedUploads(
  dataDir: string,
  graceMs = 5 * 60 * 1000
): Promise<{ removed: string[] }> {
  const uploadsDir = path.join(dataDir, 'uploads');
  let entries: string[];
  try {
    entries = await fs.readdir(uploadsDir);
  } catch {
    return { removed: [] };
  }
  if (entries.length === 0) return { removed: [] };

  const referenced = new Set<string>();

  for (const relPath of ['canvas.json', 'settings.json']) {
    try {
      const raw = await fs.readFile(path.join(dataDir, relPath), 'utf8');
      collectUploadRefsFromText(raw, referenced);
    } catch {
      // Missing or unreadable optional file
    }
  }

  const historyDir = path.join(dataDir, 'history');
  try {
    const historyFiles = (await fs.readdir(historyDir)).filter((f) => f.endsWith('.json'));
    await Promise.all(
      historyFiles.map(async (hf) => {
        try {
          const raw = await fs.readFile(path.join(historyDir, hf), 'utf8');
          collectUploadRefsFromText(raw, referenced);
        } catch {
          // Skip unreadable snapshot
        }
      })
    );
  } catch {
    // No history directory yet
  }

  const now = Date.now();
  const removed: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(uploadsDir, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    if (entry.includes('.tmp.')) {
      if (now - stat.mtimeMs >= TMP_RESIDUAL_MAX_AGE_MS) {
        await fs.unlink(fullPath).catch(() => {});
      }
      continue;
    }

    if (!UPLOAD_FILE_RE.test(entry)) continue;
    if (referenced.has(entry)) continue;
    if (now - stat.mtimeMs < graceMs) continue;

    try {
      await fs.unlink(fullPath);
      removed.push(entry);
    } catch {
      // Ignore concurrent deletion
    }
  }

  return { removed };
}
