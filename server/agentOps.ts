import crypto from 'node:crypto';
import type {
  AgentOp,
  BookmarkItem,
  CanvasDocument,
  CanvasWidget,
  FolderContainer,
  ZoneContainer,
} from '../shared/types.js';
import {
  applyEntityLayoutToDoc,
  clampGridSize,
  findNearestFreeSlot,
  getTopLevelEntities,
  isValidGridSize,
  isValidQuarterCoord,
  isValidZoneSize,
  rectsOverlap,
  snapQuarter,
  solveMove,
  solvePlaceExternalItem,
  solveResize,
  validateCanvasDocument,
} from '../shared/gridEngine.js';

export class AgentOpError extends Error {
  statusCode: number;
  reason: string;
  opIndex: number;

  constructor(statusCode: number, reason: string, message: string, opIndex: number) {
    super(message);
    this.statusCode = statusCode;
    this.reason = reason;
    this.opIndex = opIndex;
  }
}

function cloneDocument(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    grid: { ...doc.grid },
    folders: doc.folders.map((f) => ({ ...f })),
    items: doc.items.map((item) => ({
      ...item,
      tags: item.tags ? [...item.tags] : undefined,
    })),
    zones: (doc.zones ?? []).map((z) => ({ ...z })),
    widgets: (doc.widgets ?? []).map((w): CanvasWidget =>
      w.kind === 'carousel'
        ? { ...w, images: w.images.map((img) => ({ ...img })) }
        : { ...w }
    ),
  };
}

function normalizeFolderOrders(items: BookmarkItem[], folderId: string, now: string): void {
  const folderItems = items
    .filter((i) => i.parentId === folderId)
    .sort((a, b) => a.order - b.order);
  folderItems.forEach((item, idx) => {
    item.order = idx;
    item.updatedAt = now;
  });
}

export function applyAgentOps(doc: CanvasDocument, ops: readonly AgentOp[]): CanvasDocument {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new AgentOpError(400, 'invalid_ops', 'ops 必须是非空操作数组', -1);
  }

  let current = cloneDocument(doc);
  const now = new Date().toISOString();

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
      throw new AgentOpError(400, 'invalid_op', '无效的操作对象', i);
    }

    switch (op.op) {
      case 'create_item': {
        if (!op.title || !op.url) {
          throw new AgentOpError(400, 'invalid_params', 'create_item 需要 title 和 url', i);
        }

        const targetFolderId = op.parentId ?? op.folderId ?? null;
        if (targetFolderId !== null) {
          const folder = current.folders.find((f) => f.id === targetFolderId);
          if (!folder) {
            throw new AgentOpError(404, 'folder_not_found', `未找到文件夹 ${targetFolderId}`, i);
          }
          const siblingCount = current.items.filter((it) => it.parentId === targetFolderId).length;
          const newItem: BookmarkItem = {
            id: op.id || `item-${crypto.randomUUID().slice(0, 8)}`,
            title: op.title,
            url: op.url,
            subtitle: op.subtitle,
            icon: op.icon,
            faviconUrl: op.faviconUrl,
            accent: op.accent,
            tags: op.tags ? [...op.tags] : undefined,
            parentId: targetFolderId,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            order: siblingCount,
            createdAt: now,
            updatedAt: now,
          };
          current.items.push(newItem);
          break;
        }

        const w = op.w ?? 1;
        const h = op.h ?? 1;
        if (!isValidGridSize(w) || !isValidGridSize(h)) {
          throw new AgentOpError(400, 'invalid_size', 'w 与 h 必须为 1..6 的整数', i);
        }

        const topLevel = getTopLevelEntities(current);
        let x = op.x;
        let y = op.y;
        if (x === undefined || y === undefined) {
          const slot = findNearestFreeSlot(topLevel, w, h, 0, 0);
          x = slot.x;
          y = slot.y;
        } else {
          if (!isValidQuarterCoord(x) || !isValidQuarterCoord(y)) {
            throw new AgentOpError(400, 'invalid_coords', 'x 与 y 必须为 0.25 网格倍数', i);
          }
          x = snapQuarter(x);
          y = snapQuarter(y);
          if (topLevel.some((e) => rectsOverlap({ x: x!, y: y!, w, h }, e))) {
            throw new AgentOpError(
              409,
              'overlap',
              `坐标 (${x}, ${y}) 尺寸 ${w}×${h} 与现有实体冲突`,
              i
            );
          }
        }

        current.items.push({
          id: op.id || `item-${crypto.randomUUID().slice(0, 8)}`,
          title: op.title,
          url: op.url,
          subtitle: op.subtitle,
          icon: op.icon,
          faviconUrl: op.faviconUrl,
          accent: op.accent,
          tags: op.tags ? [...op.tags] : undefined,
          parentId: null,
          x,
          y,
          w,
          h,
          order: 0,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }

      case 'update_item': {
        const item = current.items.find((it) => it.id === op.id);
        if (!item) {
          throw new AgentOpError(404, 'not_found', `未找到书签项目 ${op.id}`, i);
        }
        const patch = op.patch ?? {};
        if (patch.title !== undefined) item.title = patch.title;
        if (patch.url !== undefined) item.url = patch.url;
        if (patch.subtitle !== undefined) item.subtitle = patch.subtitle;
        if (patch.icon !== undefined) item.icon = patch.icon;
        if (patch.faviconUrl !== undefined) item.faviconUrl = patch.faviconUrl;
        if (patch.accent !== undefined) item.accent = patch.accent;
        if (patch.tags !== undefined) item.tags = [...patch.tags];
        item.updatedAt = now;
        break;
      }

      case 'delete_items': {
        const delSet = new Set(op.ids);
        const affectedFolders = new Set(
          current.items
            .filter((it) => delSet.has(it.id) && it.parentId !== null)
            .map((it) => it.parentId!)
        );
        current.items = current.items.filter((it) => !delSet.has(it.id));
        for (const fId of affectedFolders) {
          normalizeFolderOrders(current.items, fId, now);
        }
        break;
      }

      case 'create_folder': {
        if (!op.title) {
          throw new AgentOpError(400, 'invalid_params', 'create_folder 需要 title', i);
        }
        const w = op.w ?? 2;
        const h = op.h ?? 2;
        if (!isValidGridSize(w) || !isValidGridSize(h)) {
          throw new AgentOpError(400, 'invalid_size', 'w 与 h 必须为 1..6 的整数', i);
        }

        const topLevel = getTopLevelEntities(current);
        let x = op.x;
        let y = op.y;
        if (x === undefined || y === undefined) {
          const slot = findNearestFreeSlot(topLevel, w, h, 0, 0);
          x = slot.x;
          y = slot.y;
        } else {
          if (!isValidQuarterCoord(x) || !isValidQuarterCoord(y)) {
            throw new AgentOpError(400, 'invalid_coords', 'x 与 y 必须为 0.25 网格倍数', i);
          }
          x = snapQuarter(x);
          y = snapQuarter(y);
          if (topLevel.some((e) => rectsOverlap({ x: x!, y: y!, w, h }, e))) {
            throw new AgentOpError(
              409,
              'overlap',
              `坐标 (${x}, ${y}) 尺寸 ${w}×${h} 与现有实体冲突`,
              i
            );
          }
        }

        const folder: FolderContainer = {
          id: op.id || `folder-${crypto.randomUUID().slice(0, 8)}`,
          title: op.title,
          x,
          y,
          w,
          h,
          displayMode: op.displayMode === 'list' ? 'list' : 'grid',
          isPrivate: Boolean(op.isPrivate),
          icon: op.icon,
          accent: op.accent,
          createdAt: now,
          updatedAt: now,
        };
        current.folders.push(folder);
        break;
      }

      case 'update_folder': {
        const folder = current.folders.find((f) => f.id === op.id);
        if (!folder) {
          throw new AgentOpError(404, 'folder_not_found', `未找到文件夹 ${op.id}`, i);
        }
        const patch = op.patch ?? {};
        if (patch.title !== undefined) folder.title = patch.title;
        if (patch.displayMode !== undefined) {
          folder.displayMode = patch.displayMode === 'list' ? 'list' : 'grid';
        }
        if (patch.isPrivate !== undefined) folder.isPrivate = patch.isPrivate;
        if (patch.icon !== undefined) folder.icon = patch.icon;
        if (patch.accent !== undefined) folder.accent = patch.accent;
        folder.updatedAt = now;
        break;
      }

      case 'dissolve_folder': {
        const folderIdx = current.folders.findIndex((f) => f.id === op.id);
        if (folderIdx === -1) {
          throw new AgentOpError(404, 'folder_not_found', `未找到文件夹 ${op.id}`, i);
        }
        const [folder] = current.folders.splice(folderIdx, 1);

        if (op.deleteItems) {
          current.items = current.items.filter((it) => it.parentId !== folder.id);
        } else {
          const children = current.items
            .filter((it) => it.parentId === folder.id)
            .sort((a, b) => a.order - b.order);

          const occupied = getTopLevelEntities(current).map((e) => ({
            x: e.x,
            y: e.y,
            w: e.w,
            h: e.h,
          }));

          for (const child of children) {
            const slot = findNearestFreeSlot(occupied, 1, 1, folder.x, folder.y);
            child.parentId = null;
            child.x = slot.x;
            child.y = slot.y;
            child.w = 1;
            child.h = 1;
            child.order = 0;
            child.updatedAt = now;
            occupied.push({ x: slot.x, y: slot.y, w: 1, h: 1 });
          }
        }
        break;
      }

      case 'move_items_to_folder': {
        const folder = current.folders.find((f) => f.id === op.folderId);
        if (!folder) {
          throw new AgentOpError(404, 'folder_not_found', `未找到目标文件夹 ${op.folderId}`, i);
        }
        if (!Array.isArray(op.itemIds) || op.itemIds.length === 0) {
          throw new AgentOpError(400, 'invalid_params', 'itemIds 不能为空', i);
        }

        const movingItems: BookmarkItem[] = [];
        for (const itemId of op.itemIds) {
          const item = current.items.find((it) => it.id === itemId);
          if (!item) {
            throw new AgentOpError(404, 'not_found', `未找到书签项目 ${itemId}`, i);
          }
          movingItems.push(item);
        }

        const sourceFolders = new Set(
          movingItems.filter((it) => it.parentId !== null).map((it) => it.parentId!)
        );
        const movingSet = new Set(op.itemIds);

        const existingTargetItems = current.items
          .filter((it) => it.parentId === op.folderId && !movingSet.has(it.id))
          .sort((a, b) => a.order - b.order);

        const insertAt =
          op.index !== undefined
            ? Math.max(0, Math.min(existingTargetItems.length, op.index))
            : existingTargetItems.length;

        const merged = [
          ...existingTargetItems.slice(0, insertAt),
          ...movingItems,
          ...existingTargetItems.slice(insertAt),
        ];

        merged.forEach((item, idx) => {
          item.parentId = op.folderId;
          item.order = idx;
          item.updatedAt = now;
        });

        for (const srcId of sourceFolders) {
          if (srcId !== op.folderId) {
            normalizeFolderOrders(current.items, srcId, now);
          }
        }
        folder.updatedAt = now;
        break;
      }

      case 'move_items_to_canvas': {
        if (!Array.isArray(op.itemIds) || op.itemIds.length === 0) {
          throw new AgentOpError(400, 'invalid_params', 'itemIds 不能为空', i);
        }

        const w = clampGridSize(op.w ?? 1);
        const h = clampGridSize(op.h ?? 1);
        if (!isValidGridSize(w) || !isValidGridSize(h)) {
          throw new AgentOpError(400, 'invalid_size', 'w 与 h 必须为 1..6 的整数', i);
        }

        const itemsToMove: BookmarkItem[] = [];
        for (const itemId of op.itemIds) {
          const item = current.items.find((it) => it.id === itemId);
          if (!item) {
            throw new AgentOpError(404, 'not_found', `未找到书签项目 ${itemId}`, i);
          }
          itemsToMove.push(item);
        }

        const sourceFolders = new Set(
          itemsToMove.filter((it) => it.parentId !== null).map((it) => it.parentId!)
        );

        if (itemsToMove.length === 1 && op.x !== undefined && op.y !== undefined) {
          const item = itemsToMove[0];
          const topLevel = getTopLevelEntities(current);
          const placed = solvePlaceExternalItem(topLevel, {
            ...item,
            kind: 'item',
            parentId: null,
            x: op.x,
            y: op.y,
            w,
            h,
          });
          if (!placed.ok) {
            const status = placed.reason === 'surrounded' ? 409 : 400;
            throw new AgentOpError(status, placed.reason, placed.message, i);
          }
          item.parentId = null;
          item.x = op.x;
          item.y = op.y;
          item.w = w;
          item.h = h;
          item.order = 0;
          item.updatedAt = now;
          current = applyEntityLayoutToDoc(current, placed.entities, now);
        } else {
          for (const item of itemsToMove) {
            const srcFolder =
              item.parentId !== null
                ? current.folders.find((f) => f.id === item.parentId)
                : undefined;
            const originX = op.x ?? srcFolder?.x ?? 0;
            const originY = op.y ?? srcFolder?.y ?? 0;
            const topLevel = getTopLevelEntities(current).filter((e) => e.id !== item.id);
            const slot = findNearestFreeSlot(topLevel, w, h, originX, originY);
            item.parentId = null;
            item.x = slot.x;
            item.y = slot.y;
            item.w = w;
            item.h = h;
            item.order = 0;
            item.updatedAt = now;
          }
        }

        for (const srcId of sourceFolders) {
          normalizeFolderOrders(current.items, srcId, now);
        }
        break;
      }

      case 'merge_items_to_folder': {
        const source = current.items.find((it) => it.id === op.sourceItemId);
        if (!source) {
          throw new AgentOpError(404, 'not_found', `未找到源书签 ${op.sourceItemId}`, i);
        }
        const target = current.items.find((it) => it.id === op.targetItemId);
        if (!target) {
          throw new AgentOpError(404, 'not_found', `未找到目标书签 ${op.targetItemId}`, i);
        }
        if (source.id === target.id) {
          throw new AgentOpError(400, 'invalid_params', '不能将同一书签与自身合并', i);
        }
        if (target.parentId !== null) {
          throw new AgentOpError(409, 'invalid_target', '目标书签必须在桌面顶层才能合并建夹', i);
        }

        const prevSourceFolder = source.parentId;
        const newFolder: FolderContainer = {
          id: op.folderId || `folder-${crypto.randomUUID().slice(0, 8)}`,
          title: op.title || '新建文件夹',
          x: target.x,
          y: target.y,
          w: target.w,
          h: target.h,
          displayMode: 'grid',
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        };
        current.folders.push(newFolder);

        target.parentId = newFolder.id;
        target.order = 0;
        target.updatedAt = now;

        source.parentId = newFolder.id;
        source.order = 1;
        source.updatedAt = now;

        if (prevSourceFolder !== null) {
          normalizeFolderOrders(current.items, prevSourceFolder, now);
        }
        break;
      }

      case 'reorder_folder_items': {
        const folder = current.folders.find((f) => f.id === op.folderId);
        if (!folder) {
          throw new AgentOpError(404, 'folder_not_found', `未找到文件夹 ${op.folderId}`, i);
        }
        const folderItems = current.items.filter((it) => it.parentId === op.folderId);
        const itemMap = new Map(folderItems.map((it) => [it.id, it]));
        const seen = new Set<string>();
        let nextOrder = 0;

        for (const itemId of op.itemIds) {
          const item = itemMap.get(itemId);
          if (!item) {
            throw new AgentOpError(
              404,
              'item_not_found',
              `书签 ${itemId} 不属于文件夹 ${op.folderId}`,
              i
            );
          }
          if (!seen.has(itemId)) {
            seen.add(itemId);
            item.order = nextOrder++;
            item.updatedAt = now;
          }
        }
        for (const item of folderItems.sort((a, b) => a.order - b.order)) {
          if (!seen.has(item.id)) {
            item.order = nextOrder++;
            item.updatedAt = now;
          }
        }
        folder.updatedAt = now;
        break;
      }

      case 'resize_entity': {
        const topLevel = getTopLevelEntities(current);
        const res = solveResize(topLevel, op.id, op.w, op.h);
        if (!res.ok) {
          const status =
            res.reason === 'not_found' ? 404 : res.reason === 'invalid_size' ? 400 : 409;
          throw new AgentOpError(status, res.reason, res.message, i);
        }
        current = applyEntityLayoutToDoc(current, res.entities, now);
        break;
      }

      case 'move_entities': {
        const topLevel = getTopLevelEntities(current);
        const res = solveMove(topLevel, op.ids, op.dx, op.dy);
        if (!res.ok) {
          const status =
            res.reason === 'not_found'
              ? 404
              : res.reason === 'empty_selection' || res.reason === 'invalid_delta'
                ? 400
                : 409;
          throw new AgentOpError(status, res.reason, res.message, i);
        }
        current = applyEntityLayoutToDoc(current, res.entities, now);
        break;
      }

      case 'place_entity': {
        const topLevel = getTopLevelEntities(current);
        const target = topLevel.find((e) => e.id === op.id);
        if (!target) {
          throw new AgentOpError(404, 'not_found', `未找到桌面顶层实体 ${op.id}`, i);
        }
        const res = solveMove(topLevel, [op.id], op.x - target.x, op.y - target.y);
        if (!res.ok) {
          const status = res.reason === 'invalid_delta' ? 400 : 409;
          throw new AgentOpError(status, res.reason, res.message, i);
        }
        current = applyEntityLayoutToDoc(current, res.entities, now);
        break;
      }

      case 'create_zone': {
        if (!op.title) {
          throw new AgentOpError(400, 'invalid_params', 'create_zone 需要 title', i);
        }
        if (!isValidQuarterCoord(op.x) || !isValidQuarterCoord(op.y)) {
          throw new AgentOpError(400, 'invalid_coords', '分区坐标必须为 0.25 网格倍数', i);
        }
        if (!isValidZoneSize(op.w) || !isValidZoneSize(op.h)) {
          throw new AgentOpError(400, 'invalid_size', '分区尺寸必须在 1..40 之间（0.25 步进）', i);
        }
        const zone: ZoneContainer = {
          id: op.id || `zone-${crypto.randomUUID().slice(0, 8)}`,
          title: op.title,
          x: snapQuarter(op.x),
          y: snapQuarter(op.y),
          w: snapQuarter(op.w),
          h: snapQuarter(op.h),
          accent: op.accent,
          isPrivate: Boolean(op.isPrivate),
          createdAt: now,
          updatedAt: now,
        };
        current.zones = [...(current.zones ?? []), zone];
        break;
      }

      case 'update_zone': {
        const zone = (current.zones ?? []).find((z) => z.id === op.id);
        if (!zone) {
          throw new AgentOpError(404, 'not_found', `未找到分区 ${op.id}`, i);
        }
        const patch = op.patch ?? {};
        if (patch.title !== undefined) zone.title = patch.title;
        if (patch.x !== undefined) {
          if (!isValidQuarterCoord(patch.x)) {
            throw new AgentOpError(400, 'invalid_coords', 'x 必须为 0.25 网格倍数', i);
          }
          zone.x = snapQuarter(patch.x);
        }
        if (patch.y !== undefined) {
          if (!isValidQuarterCoord(patch.y)) {
            throw new AgentOpError(400, 'invalid_coords', 'y 必须为 0.25 网格倍数', i);
          }
          zone.y = snapQuarter(patch.y);
        }
        if (patch.w !== undefined) {
          if (!isValidZoneSize(patch.w)) {
            throw new AgentOpError(400, 'invalid_size', 'w 必须在 1..40 之间（0.25 步进）', i);
          }
          zone.w = snapQuarter(patch.w);
        }
        if (patch.h !== undefined) {
          if (!isValidZoneSize(patch.h)) {
            throw new AgentOpError(400, 'invalid_size', 'h 必须在 1..40 之间（0.25 步进）', i);
          }
          zone.h = snapQuarter(patch.h);
        }
        if (patch.accent !== undefined) zone.accent = patch.accent;
        if (patch.isPrivate !== undefined) zone.isPrivate = Boolean(patch.isPrivate);
        zone.updatedAt = now;
        break;
      }

      case 'delete_zone': {
        current.zones = (current.zones ?? []).filter((z) => z.id !== op.id);
        break;
      }

      default:
        throw new AgentOpError(400, 'unknown_op', `未知操作类型: ${(op as { op: string }).op}`, i);
    }
  }

  const finalCheck = validateCanvasDocument(current);
  if (!finalCheck.valid) {
    throw new AgentOpError(409, 'layout_conflict', finalCheck.error || '最终布局存在冲突', -1);
  }

  current.updatedAt = now;
  return current;
}

export function buildAgentGuideJson() {
  return {
    name: 'neko-like',
    version: 2,
    description:
      'Infinite-canvas bookmark launcher with decoupled BookmarkItem & FolderContainer model, deterministic grid physics, private folder isolation, and atomic Agent batch operations.',
    auth: {
      bearerHeader: 'Authorization: Bearer <apiToken>',
      cookieAuth: 'POST /api/auth/unlock sets HttpOnly signed session cookie',
      tokenLocation: 'data/config.json -> apiToken (server-side)',
    },
    endpoints: [
      { method: 'GET', path: '/api/health', auth: 'public', description: 'Health check and public folder/item counts' },
      { method: 'GET', path: '/api/canvas', auth: 'optional', description: 'Get v2 canvas { folders, items } (strips isPrivate folders and their items if unauthenticated)' },
      { method: 'PUT', path: '/api/canvas', auth: 'required', description: 'Replace full v2 canvas with overlap/integrity validation & automatic snapshot' },
      { method: 'POST', path: '/api/meta/fetch', auth: 'required', description: 'Fetch webpage title and favicon URL' },
      { method: 'POST', path: '/api/uploads/image', auth: 'required', description: 'Upload base64 image (<=10MB) for carousel widgets' },
      { method: 'GET', path: '/api/uploads/:filename', auth: 'public', description: 'Serve uploaded carousel image with immutable caching' },
      { method: 'GET', path: '/llms.txt', auth: 'public', description: 'Standard LLM/Agent Markdown instructions' },
      { method: 'GET', path: '/api/agent/guide', auth: 'public', description: 'This self-describing Agent guide (Markdown or ?format=json)' },
      { method: 'GET', path: '/api/agent/credentials', auth: 'required', description: 'Inspect current Agent Bearer token' },
      { method: 'POST', path: '/api/agent/rotate-token', auth: 'required', description: 'Rotate Agent Bearer token' },
      { method: 'POST', path: '/api/agent/ops', auth: 'required', description: 'Execute atomic v2 batch operations with deterministic grid solver' },
      { method: 'PUT', path: '/api/settings', auth: 'required', description: 'Update SiteSettings and sync gridDensity' },
      { method: 'GET', path: '/api/backup/export', auth: 'required', description: 'Download full JSON backup of settings and canvas' },
      { method: 'POST', path: '/api/backup/import', auth: 'required', description: 'Restore canvas (and optional settings) from JSON backup' },
      { method: 'GET', path: '/api/history', auth: 'required', description: 'List up to 30 snapshots (5-minute coalescing on canvas_put)' },
      { method: 'POST', path: '/api/history', auth: 'required', description: 'Create a manual snapshot with optional { label }' },
      { method: 'DELETE', path: '/api/history/:id', auth: 'required', description: 'Delete a single snapshot by id' },
      { method: 'POST', path: '/api/history/restore', auth: 'required', description: 'Restore canvas to a snapshot id' },
    ],
    operations: [
      {
        op: 'create_item',
        fields: {
          title: 'string (required)',
          url: 'string (required)',
          subtitle: 'string?',
          icon: 'string?',
          faviconUrl: 'string?',
          accent: 'string?',
          tags: 'string[]?',
          parentId: 'string | null? (null/omitted places on desktop; folderId puts inside folder)',
          w: 'integer 1..6 (default 1)',
          h: 'integer 1..6 (default 1)',
          x: 'integer? (auto-placed via spiral search if omitted)',
          y: 'integer?',
        },
      },
      { op: 'update_item', fields: { id: 'string', patch: '{ title?, url?, subtitle?, icon?, faviconUrl?, accent?, tags? }' } },
      { op: 'delete_items', fields: { ids: 'string[]' } },
      {
        op: 'create_folder',
        fields: {
          title: 'string (required)',
          w: 'integer 1..6 (default 2)',
          h: 'integer 1..6 (default 2)',
          displayMode: "'grid' | 'list' (default 'grid')",
          isPrivate: 'boolean (default false)',
          accent: 'string?',
          x: 'integer?',
          y: 'integer?',
        },
      },
      { op: 'update_folder', fields: { id: 'string', patch: '{ title?, displayMode?, isPrivate?, accent? }' } },
      { op: 'dissolve_folder', fields: { id: 'string', deleteItems: 'boolean? (default false: unpacks items to nearest free desktop slots)' } },
      { op: 'move_items_to_folder', fields: { itemIds: 'string[]', folderId: 'string', index: 'number?' }, note: 'Preserves item IDs and metadata' },
      { op: 'move_items_to_canvas', fields: { itemIds: 'string[]', x: 'integer?', y: 'integer?', w: '1..6?', h: '1..6?' }, note: 'Uses solvePlaceExternalItem when single item placed at (x,y); preserves item IDs' },
      { op: 'merge_items_to_folder', fields: { sourceItemId: 'string', targetItemId: 'string', title: 'string?' }, note: 'Creates folder at targetItem coordinates containing both items' },
      { op: 'reorder_folder_items', fields: { folderId: 'string', itemIds: 'string[]' } },
      { op: 'resize_entity', fields: { id: 'string', w: '1..6', h: '1..6' } },
      { op: 'move_entities', fields: { ids: 'string[]', dx: '0.25-grid number', dy: '0.25-grid number' } },
      { op: 'place_entity', fields: { id: 'string', x: '0.25-grid number', y: '0.25-grid number' } },
      { op: 'create_zone', fields: { title: 'string', x: '0.25-grid', y: '0.25-grid', w: '1..40 (0.25 step)', h: '1..40 (0.25 step)', accent: 'string?', isPrivate: 'boolean?' } },
      { op: 'update_zone', fields: { id: 'string', patch: '{ title?, x?, y?, w?, h?, accent?, isPrivate? }' } },
      { op: 'delete_zone', fields: { id: 'string' } },
    ],
  };
}

export function buildAgentGuideMarkdown(): string {
  return `# neko-like Agent API Guide (v2/v4)

## Data Model (\`version: 2\`)

- \`folders\`: \`FolderContainer[]\` — pure desktop containers (\`id, title, x, y, w, h, displayMode, isPrivate, accent\`). Coordinates \`x, y\` support \`0.25\` quarter-grid increments; \`w, h\` are integers \`1..6\`.
- \`items\`: \`BookmarkItem[]\` — independent bookmark entities (\`id, title, url, subtitle, icon, faviconUrl, accent, tags, parentId, x, y, w, h, order\`). Moving an item between desktop (\`parentId: null\`) and folders (\`parentId: folderId\`) preserves its \`id\` and metadata.
- \`zones\`: \`ZoneContainer[]\` — background grouping frames (\`id, title, x, y, w, h, accent, isPrivate\`); \`x, y\` support \`0.25\` steps and \`w, h\` are \`1..40 (0.25 step)\`. Unauthenticated \`GET /api/canvas\` strips \`isPrivate: true\` zones AND all entities inside them.
- \`widgets\`: \`CanvasWidget[]\` — desktop widgets: \`carousel\` (multi-image slider), \`text\` (borderless annotation), and \`note\` (sticky note with optional \`isPrivate\`).

## Authentication

All write endpoints accept either:
- \`Authorization: Bearer <apiToken>\` (stored in \`<DATA_DIR>/config.json\`)
- Signed \`HttpOnly\` session cookie via \`POST /api/auth/unlock\`

## Read Canvas

- \`GET /api/canvas\`: Returns \`{ version: 2, updatedAt, grid, folders, items, unlocked, hasPrivateHidden, settings }\`.
  When unauthenticated, any folder with \`isPrivate: true\` AND all items with \`parentId\` pointing to a private folder are completely stripped server-side.

\`\`\`bash
curl -sS https://YOUR_HOST/api/canvas \\
  -H "Authorization: Bearer YOUR_API_TOKEN"
\`\`\`

## Atomic Batch Operations (\`POST /api/agent/ops\`)

Send \`{ "ops": [...], "reason": "optional snapshot label" }\`:

\`\`\`bash
curl -sS -X POST https://YOUR_HOST/api/agent/ops \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "reason": "organize_bookmarks",
    "ops": [
      { "op": "create_folder", "id": "dev-tools", "title": "开发工具", "w": 2, "h": 2, "displayMode": "grid" },
      { "op": "create_item", "title": "GitHub", "url": "https://github.com", "parentId": "dev-tools" },
      { "op": "create_item", "title": "MDN", "url": "https://developer.mozilla.org" }
    ]
  }'
\`\`\`

### Items
1. \`create_item\`: \`{ op: "create_item", title, url, subtitle?, icon?, tags?, parentId?: string | null, x?, y?, w?: 1, h?: 1 }\`
2. \`update_item\`: \`{ op: "update_item", id, patch: { title?, url?, subtitle?, icon?, faviconUrl?, accent?, tags? } }\`
3. \`delete_items\`: \`{ op: "delete_items", ids: [...] }\`

### Folders
4. \`create_folder\`: \`{ op: "create_folder", title, w?: 2, h?: 2, displayMode?: "grid"|"list", isPrivate?: false, x?, y? }\`
5. \`update_folder\`: \`{ op: "update_folder", id, patch: { title?, displayMode?, isPrivate?, accent? } }\`
6. \`dissolve_folder\`: \`{ op: "dissolve_folder", id, deleteItems?: false }\` (default \`false\` unpacks items back to nearest desktop slots)

### Desktop & Folder Transfers
7. \`move_items_to_folder\`: \`{ op: "move_items_to_folder", itemIds: [...], folderId, index? }\`
8. \`move_items_to_canvas\`: \`{ op: "move_items_to_canvas", itemIds: [...], x?, y?, w?: 1, h?: 1 }\`
9. \`merge_items_to_folder\`: \`{ op: "merge_items_to_folder", sourceItemId, targetItemId, title? }\`
10. \`reorder_folder_items\`: \`{ op: "reorder_folder_items", folderId, itemIds: [...] }\`
11. \`resize_entity\`: \`{ op: "resize_entity", id, w, h }\`
12. \`move_entities\`: \`{ op: "move_entities", ids: [...], dx, dy }\`
13. \`place_entity\`: \`{ op: "place_entity", id, x, y }\`

## Snapshots, Settings & Backups

- \`GET /api/history\`: Lists up to 30 automatic snapshots.
- \`POST /api/history/restore\`: \`{ "id": "<snapshotId>" }\` restores a previous snapshot.
- \`PUT /api/settings\`: Update \`SiteSettings\` (changing \`gridDensity\` syncs \`canvas.grid\`).
- \`GET /api/backup/export\` & \`POST /api/backup/import\`: Full JSON backup export/restore.
`;
}
