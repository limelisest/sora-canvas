import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Bot,
  Box,
  Braces,
  BrainCircuit,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  FileText,
  Folder,
  Globe,
  HardDrive,
  Heart,
  KeyRound,
  Layers,
  Link2,
  Music,
  NotebookPen,
  Package,
  PenTool,
  Router,
  Server,
  Settings,
  Shield,
  Sparkles,
  Star,
  Terminal,
  Video,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  markTrackedAssetSettled,
  registerTrackedAsset,
  useLoadPhase,
} from '../utils/loadTracker';

export const ICON_MAP: Record<string, LucideIcon> = {
  Terminal,
  Package,
  Code2,
  Cloud,
  PenTool,
  Braces,
  Sparkles,
  Bot,
  Cpu,
  BrainCircuit,
  Server,
  HardDrive,
  Box,
  Router,
  KeyRound,
  NotebookPen,
  Globe,
  Folder,
  Bookmark,
  Star,
  Heart,
  Compass,
  Database,
  Shield,
  Zap,
  Music,
  Video,
  FileText,
  Settings,
  Layers,
  Link2,
};

export const ICON_PRESET_NAMES = Object.keys(ICON_MAP);

const DEAD_FAVICON_STORAGE_KEY = 'neko-dead-favicons';
const DEAD_FAVICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEAD_FAVICON_MAX_ENTRIES = 400;

let deadFaviconCache: Map<string, number> | null = null;

function isExemptFaviconUrl(url: string): boolean {
  return url.startsWith('/api/uploads/') || url.startsWith('data:');
}

function loadDeadFaviconCache(): Map<string, number> {
  if (deadFaviconCache) return deadFaviconCache;
  const map = new Map<string, number>();
  deadFaviconCache = map;
  if (typeof window === 'undefined' || !window.localStorage) return map;
  try {
    const raw = window.localStorage.getItem(DEAD_FAVICON_STORAGE_KEY);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && now - v < DEAD_FAVICON_TTL_MS) {
        map.set(k, v);
      }
    }
  } catch {
    // Ignore corrupt localStorage entries
  }
  return map;
}

function persistDeadFaviconCache(map: Map<string, number>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (map.size > DEAD_FAVICON_MAX_ENTRIES) {
      const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
      map.clear();
      for (const [k, v] of sorted.slice(0, DEAD_FAVICON_MAX_ENTRIES)) {
        map.set(k, v);
      }
    }
    window.localStorage.setItem(
      DEAD_FAVICON_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(map.entries()))
    );
  } catch {
    // Ignore quota / storage errors
  }
}

function isDeadFavicon(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || isExemptFaviconUrl(trimmed)) return false;
  const map = loadDeadFaviconCache();
  const failedAt = map.get(trimmed);
  if (failedAt === undefined) return false;
  if (Date.now() - failedAt >= DEAD_FAVICON_TTL_MS) {
    map.delete(trimmed);
    persistDeadFaviconCache(map);
    return false;
  }
  return true;
}

function markDeadFavicon(url?: string): void {
  if (!url) return;
  const trimmed = url.trim();
  if (!trimmed || isExemptFaviconUrl(trimmed)) return;
  const map = loadDeadFaviconCache();
  map.set(trimmed, Date.now());
  persistDeadFaviconCache(map);
}

/** Clear dead-favicon cooldown cache entry when user manually edits/saves an icon URL. */
export function clearDeadFavicon(url?: string): void {
  if (!url) return;
  const trimmed = url.trim();
  if (!trimmed) return;
  const map = loadDeadFaviconCache();
  const changed = map.delete(trimmed) || (trimmed !== url && map.delete(url));
  if (changed) {
    persistDeadFaviconCache(map);
  }
}

interface IconGlyphProps {
  icon?: string;
  faviconUrl?: string;
  title: string;
  accent?: string;
  size?: number;
  className?: string;
  isFolder?: boolean;
}

export function IconGlyph({
  icon,
  faviconUrl,
  title,
  accent,
  size = 18,
  className = '',
  isFolder = false,
}: IconGlyphProps) {
  const loadPhase = useLoadPhase();
  const [imgFailed, setImgFailed] = useState(() => isDeadFavicon(faviconUrl));
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    setImgFailed(isDeadFavicon(faviconUrl));
    setImgLoaded(false);
    trackedRef.current = false;
  }, [faviconUrl]);

  const shouldShowImg = Boolean(faviconUrl) && !imgFailed && loadPhase !== 'content';
  const assetKey = faviconUrl ? `icon:${faviconUrl}` : '';

  useEffect(() => {
    trackedRef.current = false;
    if (!shouldShowImg || !assetKey) return;
    const el = imgRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const inViewport =
      rect.width > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth;

    if (inViewport) {
      trackedRef.current = true;
      registerTrackedAsset(assetKey);
    }

    if (el.complete) {
      if (el.naturalWidth > 0) {
        setImgLoaded(true);
      } else {
        markDeadFavicon(faviconUrl);
        setImgFailed(true);
      }
      if (trackedRef.current) {
        markTrackedAssetSettled(assetKey);
      }
    }
  }, [shouldShowImg, assetKey, faviconUrl]);

  const renderFallback = () => {
    if (icon && ICON_MAP[icon]) {
      const Comp = ICON_MAP[icon];
      return (
        <Comp
          size={size}
          style={accent ? { color: accent } : undefined}
          className={`shrink-0 ${className}`}
        />
      );
    }

    if (icon && icon.trim().length > 0 && icon.trim().length <= 4) {
      return (
        <span
          className={`inline-flex items-center justify-center leading-none select-none shrink-0 ${className}`}
          style={{ fontSize: size }}
        >
          {icon.trim()}
        </span>
      );
    }

    const Fallback = isFolder ? Folder : Globe;
    const letter = title.trim().slice(0, 1).toUpperCase();
    if (!isFolder && letter && !icon) {
      return (
        <span
          className={`inline-flex items-center justify-center font-semibold select-none shrink-0 ${className}`}
          style={{
            fontSize: Math.max(12, Math.round(size * 0.8)),
            color: accent || 'var(--ink-main)',
          }}
        >
          {letter}
        </span>
      );
    }

    return (
      <Fallback
        size={size}
        style={accent ? { color: accent } : undefined}
        className={`shrink-0 ${className}`}
      />
    );
  };

  if (faviconUrl && !imgFailed) {
    return (
      <span
        style={{ width: size, height: size }}
        className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      >
        {!imgLoaded && renderFallback()}
        {shouldShowImg && (
          <img
            ref={imgRef}
            src={faviconUrl}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onLoad={() => {
              setImgLoaded(true);
              if (trackedRef.current && assetKey) markTrackedAssetSettled(assetKey);
            }}
            onError={() => {
              markDeadFavicon(faviconUrl);
              setImgFailed(true);
              if (trackedRef.current && assetKey) markTrackedAssetSettled(assetKey);
            }}
            className={`absolute inset-0 h-full w-full rounded object-contain transition-opacity duration-150 ${
              imgLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </span>
    );
  }

  return renderFallback();
}
