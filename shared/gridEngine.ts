import type {
  BookmarkItem,
  CanvasDocument,
  CanvasGridEntity,
  CanvasWidget,
  FolderContainer,
  ZoneContainer,
} from './types.js';

export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 6;
export const GRID_SNAP_STEP = 0.25;
export const MIN_ZONE_SIZE = 1;
export const MAX_ZONE_SIZE = 40;

export function snapQuarter(v: number): number {
  return Math.round(v * 4) / 4;
}

export function isValidQuarterCoord(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v * 4 - Math.round(v * 4)) < 1e-6;
}

export function clampZoneSize(v: number): number {
  return Math.max(MIN_ZONE_SIZE, Math.min(MAX_ZONE_SIZE, Math.round(v)));
}

export function isValidZoneSize(v: number): boolean {
  return Number.isInteger(v) && v >= MIN_ZONE_SIZE && v <= MAX_ZONE_SIZE;
}

export function isEntityInsideZone(entity: GridRect, zone: GridRect): boolean {
  const cx = entity.x + entity.w / 2;
  const cy = entity.y + entity.h / 2;
  return cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridEntity extends GridRect {
  id: string;
}

export type SolveResizeResult<T extends GridEntity = GridEntity> =
  | {
      ok: true;
      entities: T[];
      movedIds: string[];
    }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_size' | 'surrounded';
      message: string;
    };

export type SolveMoveResult<T extends GridEntity = GridEntity> =
  | {
      ok: true;
      entities: T[];
      swappedIds: string[];
      mode: 'noop' | 'direct' | 'swap_rigid' | 'swap_vacated';
    }
  | {
      ok: false;
      reason: 'empty_selection' | 'not_found' | 'invalid_delta' | 'blocked';
      message: string;
    };

export type SolvePlaceExternalResult<T extends GridEntity = GridEntity> =
  | {
      ok: true;
      entities: T[];
      movedIds: string[];
    }
  | {
      ok: false;
      reason: 'invalid_size' | 'invalid_coords' | 'surrounded';
      message: string;
    };

export function clampGridSize(value: number): number {
  return Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, Math.round(value)));
}

export function isValidGridSize(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_GRID_SIZE && value <= MAX_GRID_SIZE;
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return (
    a.x < b.x + b.w - 1e-6 &&
    a.x + a.w > b.x + 1e-6 &&
    a.y < b.y + b.h - 1e-6 &&
    a.y + a.h > b.y + 1e-6
  );
}

export function getTopLevelEntities(doc: {
  folders: readonly FolderContainer[];
  items: readonly BookmarkItem[];
  widgets?: readonly CanvasWidget[];
}): CanvasGridEntity[] {
  const folderEntities: CanvasGridEntity[] = doc.folders.map((f) => ({
    ...f,
    kind: 'folder',
  }));
  const itemEntities: CanvasGridEntity[] = doc.items
    .filter((item) => item.parentId === null)
    .map((item) => ({
      ...item,
      tags: item.tags ? [...item.tags] : undefined,
      kind: 'item',
    }));
  const widgetEntities: CanvasGridEntity[] = (doc.widgets ?? [])
    .filter((w): w is Extract<CanvasWidget, { kind: 'carousel' | 'note' }> => w.kind === 'carousel' || w.kind === 'note')
    .map((w) =>
      w.kind === 'carousel'
        ? { ...w, images: w.images.map((img) => ({ ...img })) }
        : { ...w }
    );
  return [...folderEntities, ...itemEntities, ...widgetEntities];
}

export function applyEntityLayoutToDoc(
  doc: CanvasDocument,
  entities: readonly GridEntity[],
  updatedAt = new Date().toISOString()
): CanvasDocument {
  const posMap = new Map(entities.map((e) => [e.id, e]));
  const folders = doc.folders.map((f) => {
    const upd = posMap.get(f.id);
    if (!upd) return f;
    if (upd.x === f.x && upd.y === f.y && upd.w === f.w && upd.h === f.h) return f;
    return { ...f, x: upd.x, y: upd.y, w: upd.w, h: upd.h, updatedAt };
  });
  const items = doc.items.map((item) => {
    if (item.parentId !== null) return item;
    const upd = posMap.get(item.id);
    if (!upd) return item;
    if (upd.x === item.x && upd.y === item.y && upd.w === item.w && upd.h === item.h) return item;
    return { ...item, x: upd.x, y: upd.y, w: upd.w, h: upd.h, updatedAt };
  });
  const widgets = (doc.widgets ?? []).map((w) => {
    if (w.kind !== 'carousel' && w.kind !== 'note') return w;
    const upd = posMap.get(w.id);
    if (!upd) return w;
    if (upd.x === w.x && upd.y === w.y && upd.w === w.w && upd.h === w.h) return w;
    return { ...w, x: upd.x, y: upd.y, w: upd.w, h: upd.h, updatedAt };
  });
  return {
    ...doc,
    updatedAt,
    folders,
    items,
    ...(doc.zones ? { zones: doc.zones } : {}),
    ...(doc.widgets ? { widgets } : {}),
  };
}

export function validateNoOverlaps(entities: readonly GridEntity[]): {
  valid: boolean;
  conflicts: Array<[string, string]>;
} {
  const conflicts: Array<[string, string]> = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (rectsOverlap(entities[i], entities[j])) {
        conflicts.push([entities[i].id, entities[j].id]);
      }
    }
  }
  return { valid: conflicts.length === 0, conflicts };
}

export function validateEntities(entities: readonly GridEntity[]): {
  valid: boolean;
  error?: string;
} {
  const ids = new Set<string>();
  for (const entity of entities) {
    if (!entity.id || typeof entity.id !== 'string') {
      return { valid: false, error: '节点缺少有效的 id' };
    }
    if (ids.has(entity.id)) {
      return { valid: false, error: `存在重复节点 id: ${entity.id}` };
    }
    ids.add(entity.id);
    if (!isValidQuarterCoord(entity.x) || !isValidQuarterCoord(entity.y)) {
      return { valid: false, error: `节点 ${entity.id} 坐标必须为 0.25 网格倍数` };
    }
    if (!isValidGridSize(entity.w) || !isValidGridSize(entity.h)) {
      return { valid: false, error: `节点 ${entity.id} 尺寸必须在 1..6 之间` };
    }
  }
  const overlap = validateNoOverlaps(entities);
  if (!overlap.valid) {
    const [a, b] = overlap.conflicts[0];
    return { valid: false, error: `节点 ${a} 与 ${b} 存在网格重叠` };
  }
  return { valid: true };
}

export function validateCanvasDocument(
  doc: Pick<CanvasDocument, 'folders' | 'items'> & {
    zones?: readonly ZoneContainer[];
    widgets?: readonly CanvasWidget[];
  }
): { valid: boolean; error?: string } {
  const folderIds = new Set<string>();
  for (const folder of doc.folders) {
    if (!folder.id || typeof folder.id !== 'string') {
      return { valid: false, error: '文件夹缺少有效的 id' };
    }
    if (folderIds.has(folder.id)) {
      return { valid: false, error: `存在重复文件夹 id: ${folder.id}` };
    }
    folderIds.add(folder.id);
  }

  const itemIds = new Set<string>();
  for (const item of doc.items) {
    if (!item.id || typeof item.id !== 'string') {
      return { valid: false, error: '书签项目缺少有效的 id' };
    }
    if (itemIds.has(item.id) || folderIds.has(item.id)) {
      return { valid: false, error: `存在重复实体 id: ${item.id}` };
    }
    itemIds.add(item.id);
    if (item.parentId !== null && !folderIds.has(item.parentId)) {
      return { valid: false, error: `书签 ${item.id} 指向不存在的文件夹 ${item.parentId}` };
    }
  }

  const zoneIds = new Set<string>();
  for (const zone of doc.zones ?? []) {
    if (!zone.id || typeof zone.id !== 'string') {
      return { valid: false, error: '分区框缺少有效的 id' };
    }
    if (zoneIds.has(zone.id) || folderIds.has(zone.id) || itemIds.has(zone.id)) {
      return { valid: false, error: `存在重复分区 id: ${zone.id}` };
    }
    zoneIds.add(zone.id);
    if (!isValidQuarterCoord(zone.x) || !isValidQuarterCoord(zone.y)) {
      return { valid: false, error: `分区 ${zone.id} 坐标必须为 0.25 网格倍数` };
    }
    if (!isValidZoneSize(zone.w) || !isValidZoneSize(zone.h)) {
      return { valid: false, error: `分区 ${zone.id} 尺寸必须在 1..40 之间的整数` };
    }
  }

  const widgetIds = new Set<string>();
  for (const widget of doc.widgets ?? []) {
    if (!widget.id || typeof widget.id !== 'string') {
      return { valid: false, error: '小部件缺少有效的 id' };
    }
    if (
      widgetIds.has(widget.id) ||
      folderIds.has(widget.id) ||
      itemIds.has(widget.id) ||
      zoneIds.has(widget.id)
    ) {
      return { valid: false, error: `存在重复小部件 id: ${widget.id}` };
    }
    widgetIds.add(widget.id);
    if (widget.kind === 'text') {
      if (!isValidQuarterCoord(widget.x) || !isValidQuarterCoord(widget.y)) {
        return { valid: false, error: `文字小部件 ${widget.id} 坐标必须为 0.25 网格倍数` };
      }
      if (
        !isValidQuarterCoord(widget.w) ||
        widget.w < 1 ||
        widget.w > 40 ||
        !isValidQuarterCoord(widget.h) ||
        widget.h < 0.75 ||
        widget.h > 40
      ) {
        return { valid: false, error: `文字小部件 ${widget.id} 尺寸非法` };
      }
    }
  }

  return validateEntities(getTopLevelEntities(doc));
}

function cloneEntity<T extends GridEntity>(entity: T): T {
  const copy = { ...entity } as T & { tags?: string[] };
  if (Array.isArray(copy.tags)) {
    copy.tags = [...copy.tags];
  }
  return copy;
}

type PushDir = 'right' | 'down' | 'left' | 'up';

interface PushCandidate {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: PushDir;
  score: [number, number, number, number];
}

const DIR_RANK: Record<PushDir, number> = {
  right: 0,
  down: 1,
  left: 2,
  up: 3,
};

function buildPushCandidates<T extends GridEntity>(
  b: T,
  rOld: GridRect,
  rNew: GridRect,
  stationary: readonly T[]
): PushCandidate[] {
  const dw = rNew.w - rOld.w;
  const dh = rNew.h - rOld.h;

  const raw: Array<{ x: number; y: number; dir: PushDir; onSide: boolean }> = [
    {
      x: rNew.x + rNew.w,
      y: b.y,
      dir: 'right',
      onSide: b.x >= rOld.x + rOld.w,
    },
    {
      x: b.x,
      y: rNew.y + rNew.h,
      dir: 'down',
      onSide: b.y >= rOld.y + rOld.h,
    },
    {
      x: rNew.x - b.w,
      y: b.y,
      dir: 'left',
      onSide: b.x + b.w <= rOld.x,
    },
    {
      x: b.x,
      y: rNew.y - b.h,
      dir: 'up',
      onSide: b.y + b.h <= rOld.y,
    },
  ];

  const valid: PushCandidate[] = [];
  for (const cand of raw) {
    const rect: GridRect = { x: cand.x, y: cand.y, w: b.w, h: b.h };
    if (rectsOverlap(rect, rNew)) continue;
    let blocked = false;
    for (const s of stationary) {
      if (rectsOverlap(rect, s)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const aligned =
      (cand.dir === 'right' && dw > 0) ||
      (cand.dir === 'down' && dh > 0) ||
      (cand.dir === 'left' && dw < 0) ||
      (cand.dir === 'up' && dh < 0);
    const dist = Math.abs(cand.x - b.x) + Math.abs(cand.y - b.y);
    valid.push({
      x: cand.x,
      y: cand.y,
      w: b.w,
      h: b.h,
      dir: cand.dir,
      score: [aligned ? 0 : 1, cand.onSide ? 0 : 1, dist, DIR_RANK[cand.dir]],
    });
  }

  valid.sort((a, c) => {
    for (let i = 0; i < 4; i++) {
      if (a.score[i] !== c.score[i]) return a.score[i] - c.score[i];
    }
    return 0;
  });

  return valid;
}

function solveOrthogonalPush<T extends GridEntity>(
  overlapped: readonly T[],
  stationary: readonly T[],
  rOld: GridRect,
  rNew: GridRect
): Map<string, GridRect> | null {
  const candidateList = overlapped.map((b) => ({
    entity: b,
    candidates: buildPushCandidates(b, rOld, rNew, stationary),
  }));

  for (const item of candidateList) {
    if (item.candidates.length === 0) return null;
  }

  candidateList.sort((a, b) => a.candidates.length - b.candidates.length);

  const placed: Array<{ id: string; rect: GridRect }> = [];
  let steps = 0;
  const MAX_STEPS = 10000;

  function backtrack(idx: number): boolean {
    if (idx === candidateList.length) return true;
    if (++steps > MAX_STEPS) return false;

    const { entity, candidates } = candidateList[idx];
    for (const cand of candidates) {
      let conflict = false;
      for (const p of placed) {
        if (rectsOverlap(cand, p.rect)) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;

      placed.push({ id: entity.id, rect: cand });
      if (backtrack(idx + 1)) return true;
      placed.pop();
    }
    return false;
  }

  if (!backtrack(0)) return null;
  return new Map(placed.map((p) => [p.id, p.rect]));
}

export function solveResize<T extends GridEntity>(
  entities: readonly T[],
  targetId: string,
  newW: number,
  newH: number
): SolveResizeResult<T> {
  if (!isValidGridSize(newW) || !isValidGridSize(newH)) {
    return {
      ok: false,
      reason: 'invalid_size',
      message: '尺寸必须为 1 到 6 之间的整数',
    };
  }

  const target = entities.find((n) => n.id === targetId);
  if (!target) {
    return {
      ok: false,
      reason: 'not_found',
      message: `未找到节点 ${targetId}`,
    };
  }

  if (target.w === newW && target.h === newH) {
    return {
      ok: true,
      entities: entities.map((n) => cloneEntity(n)),
      movedIds: [],
    };
  }

  const rOld: GridRect = { x: target.x, y: target.y, w: target.w, h: target.h };
  const rNew: GridRect = { x: target.x, y: target.y, w: newW, h: newH };

  const overlapped = entities.filter((n) => n.id !== targetId && rectsOverlap(rNew, n));
  if (overlapped.length === 0) {
    return {
      ok: true,
      entities: entities.map((n) => {
        const copy = cloneEntity(n);
        if (copy.id === targetId) {
          copy.w = newW;
          copy.h = newH;
        }
        return copy;
      }),
      movedIds: [],
    };
  }

  const overlappedIds = new Set(overlapped.map((n) => n.id));
  const stationary = entities.filter((n) => n.id !== targetId && !overlappedIds.has(n.id));
  const placementMap = solveOrthogonalPush(overlapped, stationary, rOld, rNew);

  if (!placementMap) {
    return {
      ok: false,
      reason: 'surrounded',
      message: '四周无空位可挤压，无法调整到该尺寸',
    };
  }

  const nextEntities = entities.map((n) => {
    const copy = cloneEntity(n);
    if (copy.id === targetId) {
      copy.w = newW;
      copy.h = newH;
      return copy;
    }
    const newRect = placementMap.get(copy.id);
    if (newRect) {
      copy.x = newRect.x;
      copy.y = newRect.y;
    }
    return copy;
  });

  return {
    ok: true,
    entities: nextEntities,
    movedIds: overlapped.map((n) => n.id),
  };
}

export function solvePlaceExternalItem<T extends GridEntity>(
  entities: readonly T[],
  itemRect: T
): SolvePlaceExternalResult<T> {
  if (!isValidQuarterCoord(itemRect.x) || !isValidQuarterCoord(itemRect.y)) {
    return {
      ok: false,
      reason: 'invalid_coords',
      message: '放置坐标必须为 0.25 网格倍数',
    };
  }
  if (!isValidGridSize(itemRect.w) || !isValidGridSize(itemRect.h)) {
    return {
      ok: false,
      reason: 'invalid_size',
      message: '尺寸必须为 1 到 6 之间的整数',
    };
  }

  const others = entities.filter((e) => e.id !== itemRect.id);
  const rNew: GridRect = { x: itemRect.x, y: itemRect.y, w: itemRect.w, h: itemRect.h };
  const overlapped = others.filter((e) => rectsOverlap(rNew, e));

  if (overlapped.length === 0) {
    return {
      ok: true,
      entities: [...others.map((e) => cloneEntity(e)), cloneEntity(itemRect)],
      movedIds: [],
    };
  }

  const overlappedIds = new Set(overlapped.map((e) => e.id));
  const stationary = others.filter((e) => !overlappedIds.has(e.id));
  const placementMap = solveOrthogonalPush(overlapped, stationary, rNew, rNew);

  if (!placementMap) {
    return {
      ok: false,
      reason: 'surrounded',
      message: '四周无空位可挤压，无法放置到该位置',
    };
  }

  const nextOthers = others.map((e) => {
    const copy = cloneEntity(e);
    const upd = placementMap.get(copy.id);
    if (upd) {
      copy.x = upd.x;
      copy.y = upd.y;
    }
    return copy;
  });

  return {
    ok: true,
    entities: [...nextOthers, cloneEntity(itemRect)],
    movedIds: overlapped.map((e) => e.id),
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parseCellKey(key: string): { x: number; y: number } {
  const [xStr, yStr] = key.split(',');
  return { x: Number(xStr), y: Number(yStr) };
}

function getGroupCells(rects: readonly GridRect[]): Set<string> {
  const cells = new Set<string>();
  for (const rect of rects) {
    for (let cx = rect.x; cx < rect.x + rect.w; cx++) {
      for (let cy = rect.y; cy < rect.y + rect.h; cy++) {
        cells.add(cellKey(cx, cy));
      }
    }
  }
  return cells;
}

function packItemsIntoVacatedCells<T extends GridEntity>(
  items: readonly T[],
  vacatedCells: Set<string>
): Map<string, { x: number; y: number }> | null {
  const sortedItems = [...items].sort((a, b) => {
    const areaDiff = b.w * b.h - a.w * a.h;
    if (areaDiff !== 0) return areaDiff;
    const maxDiff = Math.max(b.w, b.h) - Math.max(a.w, a.h);
    if (maxDiff !== 0) return maxDiff;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  const sortedCells = Array.from(vacatedCells)
    .map(parseCellKey)
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  const occupied = new Set<string>();
  const placement = new Map<string, { x: number; y: number }>();
  let steps = 0;
  const MAX_STEPS = 10000;

  function canPlace(x: number, y: number, w: number, h: number): boolean {
    for (let cx = x; cx < x + w; cx++) {
      for (let cy = y; cy < y + h; cy++) {
        const key = cellKey(cx, cy);
        if (!vacatedCells.has(key) || occupied.has(key)) {
          return false;
        }
      }
    }
    return true;
  }

  function setOccupied(x: number, y: number, w: number, h: number, add: boolean): void {
    for (let cx = x; cx < x + w; cx++) {
      for (let cy = y; cy < y + h; cy++) {
        const key = cellKey(cx, cy);
        if (add) occupied.add(key);
        else occupied.delete(key);
      }
    }
  }

  function backtrack(idx: number): boolean {
    if (idx === sortedItems.length) return true;
    if (++steps > MAX_STEPS) return false;

    const item = sortedItems[idx];
    for (const cell of sortedCells) {
      if (canPlace(cell.x, cell.y, item.w, item.h)) {
        setOccupied(cell.x, cell.y, item.w, item.h, true);
        placement.set(item.id, { x: cell.x, y: cell.y });
        if (backtrack(idx + 1)) return true;
        placement.delete(item.id);
        setOccupied(cell.x, cell.y, item.w, item.h, false);
      }
    }
    return false;
  }

  return backtrack(0) ? placement : null;
}

function findClampedDelta<T extends GridEntity>(
  movingEntities: readonly T[],
  stationaryEntities: readonly T[],
  dx: number,
  dy: number,
  maxDistFromTarget: number
): { dx: number; dy: number } | null {
  const seen = new Set<string>();
  const candidates: Array<{ candDx: number; candDy: number; dist: number }> = [];

  const pushCand = (cx: number, cy: number) => {
    const candDx = snapQuarter(cx);
    const candDy = snapQuarter(cy);
    if (candDx === 0 && candDy === 0) return;
    const key = `${candDx},${candDy}`;
    if (seen.has(key)) return;
    seen.add(key);

    const dist = Math.hypot(candDx - dx, candDy - dy);
    if (dist >= maxDistFromTarget - 1e-6) return;

    const overlaps = movingEntities.some((m) => {
      const movedRect: GridRect = {
        x: snapQuarter(m.x + candDx),
        y: snapQuarter(m.y + candDy),
        w: m.w,
        h: m.h,
      };
      return stationaryEntities.some((u) => rectsOverlap(u, movedRect));
    });
    if (!overlaps) {
      candidates.push({ candDx, candDy, dist });
    }
  };

  // 1. Vector clamping from t = 1 down toward 0 in 0.25 steps
  const vecSteps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4));
  for (let i = vecSteps - 1; i >= 1; i--) {
    const t = i / vecSteps;
    pushCand(dx * t, dy * t);
  }

  // 2. Independent axis sliding: clamp X while keeping Y, and clamp Y while keeping X
  const xSteps = Math.round(Math.abs(dx) * 4);
  const xDir = dx >= 0 ? 1 : -1;
  for (let i = xSteps - 1; i >= 0; i--) {
    pushCand(xDir * (i / 4), dy);
  }

  const ySteps = Math.round(Math.abs(dy) * 4);
  const yDir = dy >= 0 ? 1 : -1;
  for (let i = ySteps - 1; i >= 0; i--) {
    pushCand(dx, yDir * (i / 4));
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return { dx: candidates[0].candDx, dy: candidates[0].candDy };
}

export function solveMove<T extends GridEntity>(
  entities: readonly T[],
  movingIds: readonly string[],
  dx: number,
  dy: number
): SolveMoveResult<T> {
  const uniqueIds = Array.from(new Set(movingIds));
  if (uniqueIds.length === 0) {
    return {
      ok: false,
      reason: 'empty_selection',
      message: '未选择任何要移动的节点',
    };
  }
  if (!isValidQuarterCoord(dx) || !isValidQuarterCoord(dy)) {
    return {
      ok: false,
      reason: 'invalid_delta',
      message: '位移量必须为 0.25 网格步长倍数',
    };
  }

  const movingSet = new Set(uniqueIds);
  const movingEntities = entities.filter((n) => movingSet.has(n.id));
  if (movingEntities.length !== uniqueIds.length) {
    return {
      ok: false,
      reason: 'not_found',
      message: '部分待移动节点不存在',
    };
  }

  const snappedDx = snapQuarter(dx);
  const snappedDy = snapQuarter(dy);

  if (snappedDx === 0 && snappedDy === 0) {
    return {
      ok: true,
      entities: entities.map((n) => cloneEntity(n)),
      swappedIds: [],
      mode: 'noop',
    };
  }

  const stationaryEntities = entities.filter((n) => !movingSet.has(n.id));
  const movedRects = movingEntities.map((m) => ({
    ...m,
    x: snapQuarter(m.x + snappedDx),
    y: snapQuarter(m.y + snappedDy),
  }));

  const collided = stationaryEntities.filter((u) =>
    movedRects.some((mp) => rectsOverlap(u, mp))
  );

  if (collided.length === 0) {
    const movedMap = new Map(movedRects.map((m) => [m.id, m]));
    return {
      ok: true,
      entities: entities.map((n) => {
        const copy = cloneEntity(n);
        const upd = movedMap.get(copy.id);
        if (upd) {
          copy.x = upd.x;
          copy.y = upd.y;
        }
        return copy;
      }),
      swappedIds: [],
      mode: 'direct',
    };
  }

  const isIntegerDelta = Number.isInteger(snappedDx) && Number.isInteger(snappedDy);

  if (isIntegerDelta) {
    const collidedIds = new Set(collided.map((s) => s.id));
    const restStationary = stationaryEntities.filter((u) => !collidedIds.has(u.id));

    // Strategy A: Rigid reverse translation of collided stationary entities by (-dx, -dy)
    const swappedRigid = collided.map((s) => ({
      ...s,
      x: snapQuarter(s.x - snappedDx),
      y: snapQuarter(s.y - snappedDy),
    }));

    const rigidValid = swappedRigid.every(
      (sp) =>
        !movedRects.some((mp) => rectsOverlap(sp, mp)) &&
        !restStationary.some((r) => rectsOverlap(sp, r))
    );

    if (rigidValid) {
      const posMap = new Map<string, { x: number; y: number }>();
      for (const mp of movedRects) posMap.set(mp.id, { x: mp.x, y: mp.y });
      for (const sp of swappedRigid) posMap.set(sp.id, { x: sp.x, y: sp.y });

      return {
        ok: true,
        entities: entities.map((n) => {
          const copy = cloneEntity(n);
          const pos = posMap.get(copy.id);
          if (pos) {
            copy.x = pos.x;
            copy.y = pos.y;
          }
          return copy;
        }),
        swappedIds: collided.map((s) => s.id),
        mode: 'swap_rigid',
      };
    }

    // Strategy B: Territory Union Partition (requires integer-aligned cells)
    const allIntegerCells =
      movingEntities.every((m) => Number.isInteger(m.x) && Number.isInteger(m.y)) &&
      collided.every((s) => Number.isInteger(s.x) && Number.isInteger(s.y));

    if (allIntegerCells) {
      const cellsM = getGroupCells(movingEntities);
      const cellsMPrime = getGroupCells(movedRects);
      const cellsS = getGroupCells(collided);

      const uOrig = new Set<string>(cellsM);
      for (const key of cellsS) uOrig.add(key);

      let allMPrimeInsideUnion = true;
      for (const key of cellsMPrime) {
        if (!uOrig.has(key)) {
          allMPrimeInsideUnion = false;
          break;
        }
      }

      let packed: Map<string, { x: number; y: number }> | null = null;
      if (allMPrimeInsideUnion) {
        const cRem = new Set<string>();
        for (const key of uOrig) {
          if (!cellsMPrime.has(key)) cRem.add(key);
        }
        packed = packItemsIntoVacatedCells(collided, cRem);
      }

      // Fallback when M' also extends into non-colliding empty cells while fully swallowing S
      if (!packed) {
        const cEnter = new Set<string>();
        for (const key of cellsMPrime) {
          if (!cellsM.has(key)) cEnter.add(key);
        }
        const cVacated = new Set<string>();
        for (const key of cellsM) {
          if (!cellsMPrime.has(key)) cVacated.add(key);
        }

        let allInsideEnter = true;
        for (const key of cellsS) {
          if (!cEnter.has(key)) {
            allInsideEnter = false;
            break;
          }
        }

        if (allInsideEnter) {
          packed = packItemsIntoVacatedCells(collided, cVacated);
        }
      }

      if (packed) {
        const posMap = new Map<string, { x: number; y: number }>(packed);
        for (const mp of movedRects) posMap.set(mp.id, { x: mp.x, y: mp.y });

        return {
          ok: true,
          entities: entities.map((n) => {
            const copy = cloneEntity(n);
            const pos = posMap.get(copy.id);
            if (pos) {
              copy.x = pos.x;
              copy.y = pos.y;
            }
            return copy;
          }),
          swappedIds: collided.map((s) => s.id),
          mode: 'swap_vacated',
        };
      }
    }
  }

  // Strategy C: Edge-Clamping ("贴边防重叠") along quarter-grid boundaries
  const clamped = findClampedDelta(movingEntities, stationaryEntities, snappedDx, snappedDy, 1);
  if (clamped) {
    const movedMap = new Map(
      movingEntities.map((m) => [
        m.id,
        { x: snapQuarter(m.x + clamped.dx), y: snapQuarter(m.y + clamped.dy) },
      ])
    );
    return {
      ok: true,
      entities: entities.map((n) => {
        const copy = cloneEntity(n);
        const upd = movedMap.get(copy.id);
        if (upd) {
          copy.x = upd.x;
          copy.y = upd.y;
        }
        return copy;
      }),
      swappedIds: [],
      mode: 'direct',
    };
  }

  return {
    ok: false,
    reason: 'blocked',
    message: '目标位置与现有卡片冲突且无法互换',
  };
}

export function solveMoveZoneGroup<T extends GridEntity>(
  allForeground: readonly T[],
  movingForegroundIds: readonly string[],
  dx: number,
  dy: number
):
  | { ok: true; dx: number; dy: number; entities: T[] }
  | { ok: false; reason: 'invalid_delta' | 'blocked'; message: string } {
  if (!isValidQuarterCoord(dx) || !isValidQuarterCoord(dy)) {
    return {
      ok: false,
      reason: 'invalid_delta',
      message: '位移量必须为 0.25 网格步长倍数',
    };
  }

  const snappedDx = snapQuarter(dx);
  const snappedDy = snapQuarter(dy);

  if (movingForegroundIds.length === 0 || (snappedDx === 0 && snappedDy === 0)) {
    return {
      ok: true,
      dx: snappedDx,
      dy: snappedDy,
      entities: allForeground.map((n) => cloneEntity(n)),
    };
  }

  const movingSet = new Set(movingForegroundIds);
  const movingEntities = allForeground.filter((e) => movingSet.has(e.id));
  const stationaryEntities = allForeground.filter((e) => !movingSet.has(e.id));

  const collidesAt = (candDx: number, candDy: number): boolean =>
    movingEntities.some((m) => {
      const rect: GridRect = {
        x: snapQuarter(m.x + candDx),
        y: snapQuarter(m.y + candDy),
        w: m.w,
        h: m.h,
      };
      return stationaryEntities.some((u) => rectsOverlap(u, rect));
    });

  let finalDx = snappedDx;
  let finalDy = snappedDy;

  if (collidesAt(finalDx, finalDy)) {
    // March smoothly in 0.25 steps along each axis without tunneling through external obstacles
    let curDx = 0;
    let curDy = 0;
    const totalSteps = Math.max(
      Math.round(Math.abs(snappedDx) * 4),
      Math.round(Math.abs(snappedDy) * 4)
    );
    const stepX = snappedDx / totalSteps;
    const stepY = snappedDy / totalSteps;
    for (let i = 1; i <= totalSteps; i++) {
      const tryDx = snapQuarter(stepX * i);
      const tryDy = snapQuarter(stepY * i);
      if (!collidesAt(tryDx, tryDy)) {
        curDx = tryDx;
        curDy = tryDy;
      } else {
        if (tryDx !== curDx && !collidesAt(tryDx, curDy)) {
          curDx = tryDx;
        }
        if (tryDy !== curDy && !collidesAt(curDx, tryDy)) {
          curDy = tryDy;
        }
      }
    }
    if (curDx === 0 && curDy === 0) {
      return {
        ok: false,
        reason: 'blocked',
        message: '分区内卡片与外部卡片发生碰撞',
      };
    }
    finalDx = curDx;
    finalDy = curDy;
  }

  return {
    ok: true,
    dx: finalDx,
    dy: finalDy,
    entities: allForeground.map((n) => {
      const copy = cloneEntity(n);
      if (movingSet.has(copy.id)) {
        copy.x = snapQuarter(copy.x + finalDx);
        copy.y = snapQuarter(copy.y + finalDy);
      }
      return copy;
    }),
  };
}

export function findNearestFreeSlot(
  entities: readonly GridRect[],
  w: number,
  h: number,
  originX = 0,
  originY = 0
): { x: number; y: number } {
  const safeW = clampGridSize(w);
  const safeH = clampGridSize(h);
  const startX = snapQuarter(originX);
  const startY = snapQuarter(originY);

  for (let radius = 0; radius <= 120; radius++) {
    const ring: Array<{ x: number; y: number; distSq: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        ring.push({
          x: snapQuarter(startX + dx),
          y: snapQuarter(startY + dy),
          distSq: dx * dx + dy * dy,
        });
      }
    }
    ring.sort((a, b) => {
      if (a.distSq !== b.distSq) return a.distSq - b.distSq;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    for (const candidate of ring) {
      const rect: GridRect = { x: candidate.x, y: candidate.y, w: safeW, h: safeH };
      if (!entities.some((n) => rectsOverlap(rect, n))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return { x: originX, y: originY };
}
