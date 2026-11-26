import type { GridConfig, GridDensity, SiteSettings } from './types.js';
import { clampGridSize } from './gridEngine.js';

export const GRID_DENSITY_MAP: Record<GridDensity, GridConfig> = {
  compact: { cellSize: 92, gap: 12 },
  standard: { cellSize: 108, gap: 14 },
  relaxed: { cellSize: 124, gap: 16 },
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteTitle: 'sora · canvas',
  brandAccent: '#ff5500',
  homeLinkEnabled: false,
  homeLinkLabel: 'home',
  homeLinkUrl: 'https://example.com',
  defaultTheme: 'light',
  dotGridMode: 'always',
  canvasBgStyle: 'aurora',
  customBgUrl: '',
  wheelMode: 'zoom',
  showFolderNav: true,
  openTarget: '_blank',

  defaultItemW: 1,
  defaultItemH: 1,
  defaultFolderW: 2,
  defaultFolderH: 2,
  defaultFolderMode: 'grid',
  dragOutItemSizeMode: '1x1',

  gridDensity: 'standard',
  touchLongPressMs: 380,
  hoverMergeEnabled: true,
  hoverMergeMs: 600,
  mergedFolderTitle: '新建文件夹',
  allowPrivateMeta: false,

  rememberDays: 365,
  slidingRenewal: true,
  desktopViewportMode: 'auto',
  mobileViewportMode: 'anchor',
  viewportOrigin: null,
};

function clampRange(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function normalizeSiteSettings(raw: Partial<SiteSettings> | null | undefined): SiteSettings {
  const s = raw ?? {};
  const rememberDays =
    s.rememberDays === 7 || s.rememberDays === 30 || s.rememberDays === 90 || s.rememberDays === 365
      ? s.rememberDays
      : DEFAULT_SITE_SETTINGS.rememberDays;

  let viewportOrigin: { x: number; y: number } | null = null;
  if (
    s.viewportOrigin &&
    typeof s.viewportOrigin === 'object' &&
    typeof s.viewportOrigin.x === 'number' &&
    Number.isFinite(s.viewportOrigin.x) &&
    typeof s.viewportOrigin.y === 'number' &&
    Number.isFinite(s.viewportOrigin.y)
  ) {
    viewportOrigin = {
      x: Math.round(s.viewportOrigin.x),
      y: Math.round(s.viewportOrigin.y),
    };
  }

  return {
    siteTitle:
      typeof s.siteTitle === 'string' && s.siteTitle.trim().length > 0
        ? s.siteTitle.trim().slice(0, 40)
        : DEFAULT_SITE_SETTINGS.siteTitle,
    brandAccent:
      typeof s.brandAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.brandAccent.trim())
        ? s.brandAccent.trim()
        : DEFAULT_SITE_SETTINGS.brandAccent,
    homeLinkEnabled:
      typeof s.homeLinkEnabled === 'boolean'
        ? s.homeLinkEnabled
        : DEFAULT_SITE_SETTINGS.homeLinkEnabled,
    homeLinkLabel:
      typeof s.homeLinkLabel === 'string' && s.homeLinkLabel.trim().length > 0
        ? s.homeLinkLabel.trim().slice(0, 24)
        : DEFAULT_SITE_SETTINGS.homeLinkLabel,
    homeLinkUrl:
      typeof s.homeLinkUrl === 'string' && /^https?:\/\//i.test(s.homeLinkUrl.trim())
        ? s.homeLinkUrl.trim()
        : DEFAULT_SITE_SETTINGS.homeLinkUrl,
    defaultTheme:
      s.defaultTheme === 'light' || s.defaultTheme === 'dark' || s.defaultTheme === 'system'
        ? s.defaultTheme
        : DEFAULT_SITE_SETTINGS.defaultTheme,
    dotGridMode:
      s.dotGridMode === 'always' || s.dotGridMode === 'edit-only' || s.dotGridMode === 'hidden'
        ? s.dotGridMode
        : DEFAULT_SITE_SETTINGS.dotGridMode,
    canvasBgStyle:
      s.canvasBgStyle === 'dot' || s.canvasBgStyle === 'aurora' || s.canvasBgStyle === 'wallpaper'
        ? s.canvasBgStyle
        : DEFAULT_SITE_SETTINGS.canvasBgStyle,
    customBgUrl:
      typeof s.customBgUrl === 'string' && /^https?:\/\//i.test(s.customBgUrl.trim())
        ? s.customBgUrl.trim().slice(0, 500)
        : '',
    wheelMode:
      s.wheelMode === 'zoom' || s.wheelMode === 'pan'
        ? s.wheelMode
        : DEFAULT_SITE_SETTINGS.wheelMode,
    showFolderNav:
      typeof s.showFolderNav === 'boolean'
        ? s.showFolderNav
        : DEFAULT_SITE_SETTINGS.showFolderNav,
    openTarget:
      s.openTarget === '_blank' || s.openTarget === '_self'
        ? s.openTarget
        : DEFAULT_SITE_SETTINGS.openTarget,

    defaultItemW: clampGridSize(
      typeof s.defaultItemW === 'number' ? s.defaultItemW : DEFAULT_SITE_SETTINGS.defaultItemW
    ),
    defaultItemH: clampGridSize(
      typeof s.defaultItemH === 'number' ? s.defaultItemH : DEFAULT_SITE_SETTINGS.defaultItemH
    ),
    defaultFolderW: clampGridSize(
      typeof s.defaultFolderW === 'number' ? s.defaultFolderW : DEFAULT_SITE_SETTINGS.defaultFolderW
    ),
    defaultFolderH: clampGridSize(
      typeof s.defaultFolderH === 'number' ? s.defaultFolderH : DEFAULT_SITE_SETTINGS.defaultFolderH
    ),
    defaultFolderMode:
      s.defaultFolderMode === 'grid' || s.defaultFolderMode === 'list'
        ? s.defaultFolderMode
        : DEFAULT_SITE_SETTINGS.defaultFolderMode,
    dragOutItemSizeMode:
      s.dragOutItemSizeMode === '1x1' || s.dragOutItemSizeMode === 'preserve'
        ? s.dragOutItemSizeMode
        : DEFAULT_SITE_SETTINGS.dragOutItemSizeMode,

    gridDensity:
      s.gridDensity === 'compact' || s.gridDensity === 'standard' || s.gridDensity === 'relaxed'
        ? s.gridDensity
        : DEFAULT_SITE_SETTINGS.gridDensity,
    touchLongPressMs: clampRange(s.touchLongPressMs, 200, 800, DEFAULT_SITE_SETTINGS.touchLongPressMs),
    hoverMergeEnabled:
      typeof s.hoverMergeEnabled === 'boolean'
        ? s.hoverMergeEnabled
        : DEFAULT_SITE_SETTINGS.hoverMergeEnabled,
    hoverMergeMs: clampRange(s.hoverMergeMs, 350, 1200, DEFAULT_SITE_SETTINGS.hoverMergeMs),
    mergedFolderTitle:
      typeof s.mergedFolderTitle === 'string' && s.mergedFolderTitle.trim().length > 0
        ? s.mergedFolderTitle.trim().slice(0, 32)
        : DEFAULT_SITE_SETTINGS.mergedFolderTitle,
    allowPrivateMeta:
      typeof s.allowPrivateMeta === 'boolean'
        ? s.allowPrivateMeta
        : DEFAULT_SITE_SETTINGS.allowPrivateMeta,

    rememberDays,
    slidingRenewal:
      typeof s.slidingRenewal === 'boolean'
        ? s.slidingRenewal
        : DEFAULT_SITE_SETTINGS.slidingRenewal,
    desktopViewportMode:
      s.desktopViewportMode === 'anchor' || s.desktopViewportMode === 'auto'
        ? s.desktopViewportMode
        : DEFAULT_SITE_SETTINGS.desktopViewportMode,
    mobileViewportMode:
      s.mobileViewportMode === 'anchor' || s.mobileViewportMode === 'auto'
        ? s.mobileViewportMode
        : DEFAULT_SITE_SETTINGS.mobileViewportMode,
    viewportOrigin,
  };
}
