import type { CanvasDocument, SiteSettings, ViewportMode } from '../../shared/types';
import { getTopLevelEntities } from '../../shared/gridEngine';
import { ZONE_OUTSET_PX } from '../components/ZoneCard';

export const MIN_VIEW_SCALE = 0.25;
export const MAX_VIEW_SCALE = 2.25;
const AUTO_FIT_MAX_SCALE = 1.25;

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < 768) return true;
  if (window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 960) {
    return true;
  }
  return false;
}

export function resolveActiveViewportMode(settings: SiteSettings): ViewportMode {
  return isMobileViewport() ? settings.mobileViewportMode : settings.desktopViewportMode;
}

export function getContentBoundsWorld(doc: CanvasDocument): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const entities = getTopLevelEntities(doc);
  const zones = doc.zones ?? [];
  const textWidgets = (doc.widgets ?? []).filter((w) => w.kind === 'text');
  if (entities.length === 0 && zones.length === 0 && textWidgets.length === 0) return null;

  const step = doc.grid.cellSize + doc.grid.gap;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const expand = (
    n: { x: number; y: number; w: number; h: number },
    outsetPx = 0,
    extraBottomPx = 0
  ) => {
    const left = n.x * step - outsetPx;
    const top = n.y * step - outsetPx;
    const right = n.x * step + n.w * doc.grid.cellSize + (n.w - 1) * doc.grid.gap + outsetPx;
    const bottom =
      n.y * step + n.h * doc.grid.cellSize + (n.h - 1) * doc.grid.gap + outsetPx + extraBottomPx;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  };

  for (const n of entities) expand(n);
  for (const z of zones) expand(z, ZONE_OUTSET_PX, 14);
  for (const t of textWidgets) expand(t);

  return { minX, minY, maxX, maxY };
}

export function getDefaultOriginWorld(doc: CanvasDocument): { x: number; y: number } {
  const bounds = getContentBoundsWorld(doc);
  if (!bounds) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.round((bounds.minX + bounds.maxX) / 2),
    y: Math.round((bounds.minY + bounds.maxY) / 2),
  };
}

export function resolveViewportOrigin(
  doc: CanvasDocument,
  settings: SiteSettings
): { x: number; y: number } {
  return settings.viewportOrigin ?? getDefaultOriginWorld(doc);
}

export function computeInitialView(
  doc: CanvasDocument,
  settings: SiteSettings
): { scale: number; panX: number; panY: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const mode = resolveActiveViewportMode(settings);

  if (mode === 'anchor') {
    const origin = resolveViewportOrigin(doc, settings);
    return {
      scale: 1,
      panX: Math.round(vw / 2 - origin.x),
      panY: Math.round(vh / 2 - origin.y),
    };
  }

  const bounds = getContentBoundsWorld(doc);
  if (!bounds) {
    return {
      scale: 1,
      panX: Math.round(vw / 2),
      panY: Math.round(vh / 2),
    };
  }

  const mobile = isMobileViewport();
  const padTop = mobile ? 74 : 84;
  const padBottom = mobile ? 36 : 44;
  const padX = mobile ? 24 : 56;

  const availW = Math.max(180, vw - padX * 2);
  const availH = Math.max(180, vh - padTop - padBottom);
  const contentW = Math.max(1, bounds.maxX - bounds.minX);
  const contentH = Math.max(1, bounds.maxY - bounds.minY);

  const rawScale = Math.min(availW / contentW, availH / contentH);
  const scale = Number(
    Math.max(MIN_VIEW_SCALE, Math.min(AUTO_FIT_MAX_SCALE, rawScale)).toFixed(3)
  );

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const viewportCenterX = vw / 2;
  const viewportCenterY = padTop + availH / 2;

  return {
    scale,
    panX: Math.round(viewportCenterX - centerX * scale),
    panY: Math.round(viewportCenterY - centerY * scale),
  };
}
