import { useState } from 'react';
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
  const [imgFailed, setImgFailed] = useState(false);

  if (faviconUrl && !imgFailed) {
    return (
      <img
        src={faviconUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className={`rounded object-contain shrink-0 ${className}`}
      />
    );
  }

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
        style={{ fontSize: Math.max(12, Math.round(size * 0.8)), color: accent || 'var(--ink-main)' }}
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
}
