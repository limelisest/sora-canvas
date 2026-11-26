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
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    setImgFailed(false);
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
        setImgFailed(true);
      }
      if (trackedRef.current) {
        markTrackedAssetSettled(assetKey);
      }
    }
  }, [shouldShowImg, assetKey]);

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
