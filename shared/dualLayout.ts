import type {
  BookmarkItem,
  CanvasDocument,
  CanvasGridEntity,
  CanvasWidget,
  FolderContainer,
  FreeTextWidget,
  LayoutOverride,
  PublicLayoutConfig,
  ZoneContainer,
} from './types.js';
import {
  findNearestFreeSlot,
  getTopLevelEntities,
  isEntityInsideZone,
  isValidGridSize,
  isValidQuarterCoord,
  isValidZoneSize,
  rectsOverlap,
  snapQuarter,
  type GridRect,
} from './gridEngine.js';

function isValidTextOverride(ov: LayoutOverride): boolean {
  return (
    isValidQuarterCoord(ov.x) &&
    isValidQuarterCoord(ov.y) &&
    isValidQuarterCoord(ov.w) &&
    ov.w >= 1 &&
    ov.w <= 40 &&
    isValidQuarterCoord(ov.h) &&
    ov.h >= 0.75 &&
    ov.h <= 40
  );
}

function isValidZoneOverride(ov: LayoutOverride): boolean {
  return (
    isValidQuarterCoord(ov.x) &&
    isValidQuarterCoord(ov.y) &&
    isValidZoneSize(ov.w) &&
    isValidZoneSize(ov.h)
  );
}

function isValidGridOverride(ov: LayoutOverride): boolean {
  return (
    isValidQuarterCoord(ov.x) &&
    isValidQuarterCoord(ov.y) &&
    isValidGridSize(ov.w) &&
    isValidGridSize(ov.h)
  );
}

function parseOverride(raw: unknown): LayoutOverride | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.x !== 'number' ||
    typeof o.y !== 'number' ||
    typeof o.w !== 'number' ||
    typeof o.h !== 'number'
  ) {
    return null;
  }
  if (
    !isValidQuarterCoord(o.x) ||
    !isValidQuarterCoord(o.y) ||
    !isValidQuarterCoord(o.w) ||
    !isValidQuarterCoord(o.h)
  ) {
    return null;
  }
  if (o.w < 1 || o.w > 40 || o.h < 0.75 || o.h > 40) return null;
  return {
    x: snapQuarter(o.x),
    y: snapQuarter(o.y),
    w: snapQuarter(o.w),
    h: snapQuarter(o.h),
  };
}

export function normalizePublicLayout(raw: unknown): PublicLayoutConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const positions: Record<string, LayoutOverride> = {};
  if (obj.positions && typeof obj.positions === 'object' && !Array.isArray(obj.positions)) {
    for (const [id, val] of Object.entries(obj.positions as Record<string, unknown>)) {
      if (!id || typeof id !== 'string') continue;
      const parsed = parseOverride(val);
      if (parsed) {
        positions[id] = parsed;
      }
    }
  }

  let viewportOrigin: { x: number; y: number } | null | undefined = undefined;
  if (obj.viewportOrigin === null) {
    viewportOrigin = null;
  } else if (obj.viewportOrigin && typeof obj.viewportOrigin === 'object' && !Array.isArray(obj.viewportOrigin)) {
    const vo = obj.viewportOrigin as Record<string, unknown>;
    if (
      typeof vo.x === 'number' &&
      Number.isFinite(vo.x) &&
      typeof vo.y === 'number' &&
      Number.isFinite(vo.y)
    ) {
      viewportOrigin = { x: Math.round(vo.x), y: Math.round(vo.y) };
    }
  }

  if (Object.keys(positions).length === 0 && viewportOrigin === undefined) {
    return undefined;
  }

  return {
    positions,
    ...(viewportOrigin !== undefined ? { viewportOrigin } : {}),
  };
}

export interface FilteredPublicParts {
  zones: ZoneContainer[];
  folders: FolderContainer[];
  items: BookmarkItem[];
  widgets: CanvasWidget[];
  hasPrivateHidden: boolean;
}

/**
 * Filter public elements strictly using canonical (unlocked) coordinates
 * so public layout overrides never alter private-zone containment checks.
 */
export function filterPublicDocParts(doc: CanvasDocument): FilteredPublicParts {
  const allZones = doc.zones ?? [];
  const privateZones = allZones.filter((z) => z.isPrivate);
  const inPrivateZone = (rect: GridRect): boolean =>
    privateZones.some((pz) => isEntityInsideZone(rect, pz));

  const publicZones = allZones.filter((z) => !z.isPrivate).map((z) => ({ ...z }));
  const publicFolders = doc.folders
    .filter((f) => !f.isPrivate && !inPrivateZone(f))
    .map((f) => ({ ...f }));
  const publicFolderIds = new Set(publicFolders.map((f) => f.id));

  const publicItems = doc.items
    .filter((it) => {
      if (it.parentId !== null) {
        return publicFolderIds.has(it.parentId);
      }
      return !inPrivateZone(it);
    })
    .map((it) => ({
      ...it,
      tags: it.tags ? [...it.tags] : undefined,
    }));

  const publicWidgets = (doc.widgets ?? [])
    .filter((w) => {
      if (inPrivateZone(w)) return false;
      if (w.kind === 'note' && w.isPrivate) return false;
      return true;
    })
    .map((w) =>
      w.kind === 'carousel'
        ? { ...w, images: w.images.map((img) => ({ ...img })) }
        : { ...w }
    );

  const hasPrivateHidden =
    publicZones.length < allZones.length ||
    publicFolders.length < doc.folders.length ||
    publicItems.length < doc.items.length ||
    publicWidgets.length < (doc.widgets ?? []).length;

  return {
    zones: publicZones,
    folders: publicFolders,
    items: publicItems,
    widgets: publicWidgets,
    hasPrivateHidden,
  };
}

function compareSlotOrder(a: GridRect & { id: string }, b: GridRect & { id: string }): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id.localeCompare(b.id);
}

interface GridPlacementEntry {
  id: string;
  rect: GridRect;
  hasOverride: boolean;
}

function computePublicGridPlacements(
  folders: readonly FolderContainer[],
  items: readonly BookmarkItem[],
  widgets: readonly CanvasWidget[],
  positions: Record<string, LayoutOverride>
): { placedMap: Map<string, GridRect>; relocatedIds: Set<string> } {
  const entries: GridPlacementEntry[] = [];

  for (const f of folders) {
    const ov = positions[f.id];
    const hasOverride = Boolean(ov && isValidGridOverride(ov));
    entries.push({
      id: f.id,
      rect: hasOverride ? { x: ov.x, y: ov.y, w: ov.w, h: ov.h } : { x: f.x, y: f.y, w: f.w, h: f.h },
      hasOverride,
    });
  }

  for (const it of items) {
    if (it.parentId !== null) continue;
    const ov = positions[it.id];
    const hasOverride = Boolean(ov && isValidGridOverride(ov));
    entries.push({
      id: it.id,
      rect: hasOverride ? { x: ov.x, y: ov.y, w: ov.w, h: ov.h } : { x: it.x, y: it.y, w: it.w, h: it.h },
      hasOverride,
    });
  }

  for (const w of widgets) {
    if (w.kind !== 'carousel' && w.kind !== 'note') continue;
    const ov = positions[w.id];
    const hasOverride = Boolean(ov && isValidGridOverride(ov));
    entries.push({
      id: w.id,
      rect: hasOverride ? { x: ov.x, y: ov.y, w: ov.w, h: ov.h } : { x: w.x, y: w.y, w: w.w, h: w.h },
      hasOverride,
    });
  }

  const overridden = entries.filter((e) => e.hasOverride).sort((a, b) => compareSlotOrder({ ...a.rect, id: a.id }, { ...b.rect, id: b.id }));
  const fallback = entries.filter((e) => !e.hasOverride).sort((a, b) => compareSlotOrder({ ...a.rect, id: a.id }, { ...b.rect, id: b.id }));

  const occupied: GridRect[] = [];
  const placedMap = new Map<string, GridRect>();
  const relocatedIds = new Set<string>();

  for (const group of [overridden, fallback]) {
    for (const entry of group) {
      let target = entry.rect;
      if (occupied.some((occ) => rectsOverlap(occ, target))) {
        const free = findNearestFreeSlot(occupied, target.w, target.h, target.x, target.y);
        target = { x: free.x, y: free.y, w: target.w, h: target.h };
        relocatedIds.add(entry.id);
      }
      occupied.push(target);
      placedMap.set(entry.id, target);
    }
  }

  return { placedMap, relocatedIds };
}

export interface ProjectedPublicCanvas {
  doc: CanvasDocument;
  hasPrivateHidden: boolean;
  publicViewportOrigin: { x: number; y: number } | null;
}

/**
 * Project the canonical document into the locked/public layout view.
 * Strips raw `publicLayout` so visitors never receive full layout override maps.
 */
export function projectPublicCanvas(doc: CanvasDocument): ProjectedPublicCanvas {
  const parts = filterPublicDocParts(doc);
  const positions = doc.publicLayout?.positions ?? {};

  const zones = parts.zones.map((z) => {
    const ov = positions[z.id];
    return ov && isValidZoneOverride(ov)
      ? { ...z, x: ov.x, y: ov.y, w: ov.w, h: ov.h }
      : z;
  });

  const { placedMap } = computePublicGridPlacements(
    parts.folders,
    parts.items,
    parts.widgets,
    positions
  );

  const folders = parts.folders.map((f) => {
    const r = placedMap.get(f.id);
    return r ? { ...f, x: r.x, y: r.y, w: r.w, h: r.h } : f;
  });

  const items = parts.items.map((it) => {
    if (it.parentId !== null) return it;
    const r = placedMap.get(it.id);
    return r ? { ...it, x: r.x, y: r.y, w: r.w, h: r.h } : it;
  });

  const widgets = parts.widgets.map((w) => {
    if (w.kind === 'text') {
      const ov = positions[w.id];
      return ov && isValidTextOverride(ov)
        ? { ...w, x: ov.x, y: ov.y, w: ov.w, h: ov.h }
        : w;
    }
    const r = placedMap.get(w.id);
    return r ? { ...w, x: r.x, y: r.y, w: r.w, h: r.h } : w;
  });

  const projectedDoc: CanvasDocument = {
    version: 2,
    updatedAt: doc.updatedAt,
    grid: { ...doc.grid },
    folders,
    items,
    zones,
    widgets,
  };

  return {
    doc: projectedDoc,
    hasPrivateHidden: parts.hasPrivateHidden,
    publicViewportOrigin: doc.publicLayout?.viewportOrigin ?? null,
  };
}

/**
 * Prune stale/private keys from `publicLayout.positions` and persist
 * non-overlapping fallback slots for newly exposed public entities if needed.
 */
export function reconcilePublicLayout(doc: CanvasDocument): CanvasDocument {
  const parts = filterPublicDocParts(doc);
  const rawPositions = doc.publicLayout?.positions ?? {};
  const nextPositions: Record<string, LayoutOverride> = {};

  for (const z of parts.zones) {
    const ov = rawPositions[z.id];
    if (ov && isValidZoneOverride(ov)) nextPositions[z.id] = { ...ov };
  }
  for (const f of parts.folders) {
    const ov = rawPositions[f.id];
    if (ov && isValidGridOverride(ov)) nextPositions[f.id] = { ...ov };
  }
  for (const it of parts.items) {
    if (it.parentId !== null) continue;
    const ov = rawPositions[it.id];
    if (ov && isValidGridOverride(ov)) nextPositions[it.id] = { ...ov };
  }
  for (const w of parts.widgets) {
    const ov = rawPositions[w.id];
    if (!ov) continue;
    if (w.kind === 'text') {
      if (isValidTextOverride(ov)) nextPositions[w.id] = { ...ov };
    } else if (isValidGridOverride(ov)) {
      nextPositions[w.id] = { ...ov };
    }
  }

  const { placedMap, relocatedIds } = computePublicGridPlacements(
    parts.folders,
    parts.items,
    parts.widgets,
    nextPositions
  );

  for (const id of relocatedIds) {
    if (!nextPositions[id]) {
      const slot = placedMap.get(id);
      if (slot) {
        nextPositions[id] = { x: slot.x, y: slot.y, w: slot.w, h: slot.h };
      }
    }
  }

  const hasViewportOrigin = doc.publicLayout?.viewportOrigin !== undefined;
  if (Object.keys(nextPositions).length === 0 && !hasViewportOrigin) {
    if (!doc.publicLayout) return doc;
    const { publicLayout: _omit, ...rest } = doc;
    return rest;
  }

  return {
    ...doc,
    publicLayout: {
      positions: nextPositions,
      ...(hasViewportOrigin ? { viewportOrigin: doc.publicLayout?.viewportOrigin } : {}),
    },
  };
}

/**
 * Merge edits made while viewing/editing the locked (public) layout back
 * into the canonical document:
 * - Item/folder/zone/widget content & structural changes sync globally.
 * - Existing entities keep their canonical (unlocked) x/y/w/h, while locked
 *   coordinates/sizes write into `publicLayout.positions`.
 * - Newly created or desktop-extracted top-level entities take their locked
 *   placement on the public side and avoid overlaps (and private zones) on the
 *   canonical side.
 */
export function mergeLockedLayoutEdit(
  canonicalDoc: CanvasDocument,
  nextLockedDoc: CanvasDocument
): CanvasDocument {
  const prevParts = filterPublicDocParts(canonicalDoc);
  const prevPublicZoneIds = new Set(prevParts.zones.map((z) => z.id));
  const prevPublicFolderIds = new Set(prevParts.folders.map((f) => f.id));
  const prevPublicItemIds = new Set(prevParts.items.map((i) => i.id));
  const prevPublicWidgetIds = new Set(prevParts.widgets.map((w) => w.id));

  const canonZones = canonicalDoc.zones ?? [];
  const canonPrivateZones = canonZones.filter((z) => !prevPublicZoneIds.has(z.id));
  const canonZoneMap = new Map(canonZones.map((z) => [z.id, z]));
  const canonFolderMap = new Map(canonicalDoc.folders.map((f) => [f.id, f]));
  const canonItemMap = new Map(canonicalDoc.items.map((i) => [i.id, i]));
  const canonWidgetMap = new Map((canonicalDoc.widgets ?? []).map((w) => [w.id, w]));

  const privateFolders = canonicalDoc.folders.filter((f) => !prevPublicFolderIds.has(f.id));
  const privateItems = canonicalDoc.items.filter((i) => !prevPublicItemIds.has(i.id));
  const privateWidgets = (canonicalDoc.widgets ?? []).filter((w) => !prevPublicWidgetIds.has(w.id));

  const privateEntities = getTopLevelEntities({
    folders: privateFolders,
    items: privateItems,
    widgets: privateWidgets,
  });

  // Track all canonical top-level rects to place newly created/extracted entities cleanly
  const occupiedCanonical: GridRect[] = [
    ...privateEntities.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h })),
    ...canonPrivateZones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
  ];

  // Reserve existing canonical positions for surviving public grid entities first
  for (const nf of nextLockedDoc.folders) {
    const orig = canonFolderMap.get(nf.id);
    if (orig) occupiedCanonical.push({ x: orig.x, y: orig.y, w: orig.w, h: orig.h });
  }
  for (const ni of nextLockedDoc.items) {
    if (ni.parentId !== null) continue;
    const orig = canonItemMap.get(ni.id);
    if (orig && orig.parentId === null) {
      occupiedCanonical.push({ x: orig.x, y: orig.y, w: orig.w, h: orig.h });
    }
  }
  for (const nw of nextLockedDoc.widgets ?? []) {
    if (nw.kind === 'text') continue;
    const orig = canonWidgetMap.get(nw.id);
    if (orig && orig.kind !== 'text') {
      occupiedCanonical.push({ x: orig.x, y: orig.y, w: orig.w, h: orig.h });
    }
  }

  const nextPublicPositions: Record<string, LayoutOverride> = {};

  const allocateCanonicalSlot = (desired: GridRect): GridRect => {
    if (occupiedCanonical.some((occ) => rectsOverlap(occ, desired))) {
      const slot = findNearestFreeSlot(occupiedCanonical, desired.w, desired.h, desired.x, desired.y);
      const placed = { x: slot.x, y: slot.y, w: desired.w, h: desired.h };
      occupiedCanonical.push(placed);
      return placed;
    }
    occupiedCanonical.push(desired);
    return desired;
  };

  // 1. Zones
  const syncedPublicZones: ZoneContainer[] = (nextLockedDoc.zones ?? []).map((nz) => {
    nextPublicPositions[nz.id] = { x: nz.x, y: nz.y, w: nz.w, h: nz.h };
    const orig = canonZoneMap.get(nz.id);
    if (orig) {
      return { ...nz, x: orig.x, y: orig.y, w: orig.w, h: orig.h };
    }
    return { ...nz };
  });

  // 2. Folders
  const syncedPublicFolders: FolderContainer[] = nextLockedDoc.folders.map((nf) => {
    nextPublicPositions[nf.id] = { x: nf.x, y: nf.y, w: nf.w, h: nf.h };
    const orig = canonFolderMap.get(nf.id);
    if (orig) {
      return { ...nf, x: orig.x, y: orig.y, w: orig.w, h: orig.h };
    }
    const slot = allocateCanonicalSlot({ x: nf.x, y: nf.y, w: nf.w, h: nf.h });
    return { ...nf, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
  });

  // 3. Items
  const syncedPublicItems: BookmarkItem[] = nextLockedDoc.items.map((ni) => {
    if (ni.parentId !== null) {
      return { ...ni, tags: ni.tags ? [...ni.tags] : undefined };
    }
    nextPublicPositions[ni.id] = { x: ni.x, y: ni.y, w: ni.w, h: ni.h };
    const orig = canonItemMap.get(ni.id);
    if (orig && orig.parentId === null) {
      return {
        ...ni,
        tags: ni.tags ? [...ni.tags] : undefined,
        x: orig.x,
        y: orig.y,
        w: orig.w,
        h: orig.h,
      };
    }
    const slot = allocateCanonicalSlot({ x: ni.x, y: ni.y, w: ni.w, h: ni.h });
    return {
      ...ni,
      tags: ni.tags ? [...ni.tags] : undefined,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    };
  });

  // 4. Widgets
  const syncedPublicWidgets: CanvasWidget[] = (nextLockedDoc.widgets ?? []).map((nw) => {
    nextPublicPositions[nw.id] = { x: nw.x, y: nw.y, w: nw.w, h: nw.h };
    const orig = canonWidgetMap.get(nw.id);
    if (nw.kind === 'text') {
      const cloned: FreeTextWidget = orig && orig.kind === 'text'
        ? { ...nw, x: orig.x, y: orig.y, w: orig.w, h: orig.h }
        : { ...nw };
      return cloned;
    }
    if (orig && orig.kind !== 'text') {
      return { ...nw, x: orig.x, y: orig.y, w: orig.w, h: orig.h };
    }
    const slot = allocateCanonicalSlot({ x: nw.x, y: nw.y, w: nw.w, h: nw.h });
    return { ...nw, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
  });

  const viewportOrigin =
    nextLockedDoc.publicLayout?.viewportOrigin !== undefined
      ? nextLockedDoc.publicLayout.viewportOrigin
      : canonicalDoc.publicLayout?.viewportOrigin;

  const merged: CanvasDocument = {
    version: 2,
    updatedAt: nextLockedDoc.updatedAt || canonicalDoc.updatedAt,
    grid: { ...canonicalDoc.grid },
    folders: [...privateFolders, ...syncedPublicFolders],
    items: [...privateItems, ...syncedPublicItems],
    zones: [...canonPrivateZones, ...syncedPublicZones],
    widgets: [...privateWidgets, ...syncedPublicWidgets],
    publicLayout: {
      positions: nextPublicPositions,
      ...(viewportOrigin !== undefined ? { viewportOrigin } : {}),
    },
  };

  return reconcilePublicLayout(merged);
}

/**
 * Copy all current canonical (unlocked) public entity positions & sizes into
 * `publicLayout.positions`, preserving any existing `publicLayout.viewportOrigin`.
 */
export function buildSyncedPublicLayoutFromCanonical(doc: CanvasDocument): PublicLayoutConfig {
  const parts = filterPublicDocParts(doc);
  const positions: Record<string, LayoutOverride> = {};

  for (const z of parts.zones) positions[z.id] = { x: z.x, y: z.y, w: z.w, h: z.h };
  for (const f of parts.folders) positions[f.id] = { x: f.x, y: f.y, w: f.w, h: f.h };
  for (const it of parts.items) {
    if (it.parentId === null) {
      positions[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
    }
  }
  for (const w of parts.widgets) positions[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h };

  const viewportOrigin = doc.publicLayout?.viewportOrigin;
  return {
    positions,
    ...(viewportOrigin !== undefined ? { viewportOrigin } : {}),
  };
}
