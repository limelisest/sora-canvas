import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Crosshair,
  Folder,
  LayoutGrid,
  Lock,
  Search,
  StickyNote,
  X,
} from 'lucide-react';
import type {
  BookmarkItem,
  CanvasWidget,
  FolderContainer,
  NoteWidget,
  ZoneContainer,
} from '../../shared/types';
import { fuzzyScore } from '../../shared/pinyin';
import { IconGlyph } from './IconGlyph';

interface SearchEntry {
  key: string;
  kind: 'item' | 'folder' | 'zone' | 'note';
  title: string;
  subtitle?: string;
  url?: string;
  icon?: string;
  faviconUrl?: string;
  accent?: string;
  folderTitle?: string;
  isPrivate?: boolean;
  folder?: FolderContainer;
  zone?: ZoneContainer;
  note?: NoteWidget;
  rect?: { x: number; y: number; w: number; h: number };
  focusId?: string;
  score: number;
}

interface SearchPaletteProps {
  open: boolean;
  folders: FolderContainer[];
  items: BookmarkItem[];
  zones?: ZoneContainer[];
  widgets?: CanvasWidget[];
  openTarget?: '_blank' | '_self';
  onClose: () => void;
  onOpenFolder: (folder: FolderContainer) => void;
  onFocusRect?: (rect: { x: number; y: number; w: number; h: number }, highlightId: string) => void;
}

export function SearchPalette({
  open,
  folders,
  items,
  zones = [],
  widgets = [],
  openTarget = '_blank',
  onClose,
  onOpenFolder,
  onFocusRect,
}: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 15);
    }
  }, [open]);

  const results = useMemo(() => {
    const entries: SearchEntry[] = [];
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const countMap = new Map<string, number>();
    for (const item of items) {
      if (item.parentId) {
        countMap.set(item.parentId, (countMap.get(item.parentId) ?? 0) + 1);
      }
    }

    for (const zone of zones) {
      const score = fuzzyScore(query, zone.title);
      if (score > 0) {
        entries.push({
          key: `zone-${zone.id}`,
          kind: 'zone',
          title: zone.title,
          subtitle: '区域分区框',
          isPrivate: zone.isPrivate,
          accent: zone.accent,
          zone,
          rect: zone,
          focusId: zone.id,
          score,
        });
      }
    }

    for (const widget of widgets) {
      if (widget.kind !== 'note') continue;
      const score = fuzzyScore(query, widget.title, widget.content);
      if (score > 0) {
        const snippet = widget.content.replace(/\s+/g, ' ').trim();
        entries.push({
          key: `note-${widget.id}`,
          kind: 'note',
          title: widget.title || '随手便签',
          subtitle: snippet ? snippet.slice(0, 72) : '空白便签',
          isPrivate: widget.isPrivate,
          accent: widget.tint,
          note: widget,
          rect: widget,
          focusId: widget.id,
          score,
        });
      }
    }

    for (const folder of folders) {
      const folderScore = fuzzyScore(query, folder.title);
      if (folderScore > 0) {
        entries.push({
          key: `folder-${folder.id}`,
          kind: 'folder',
          title: folder.title,
          subtitle: `${countMap.get(folder.id) ?? 0} 个书签项目`,
          isPrivate: folder.isPrivate,
          accent: folder.accent,
          folder,
          rect: folder,
          focusId: folder.id,
          score: folderScore,
        });
      }
    }

    for (const item of items) {
      const parentFolder = item.parentId ? folderMap.get(item.parentId) : undefined;
      const score = fuzzyScore(
        query,
        item.title,
        item.subtitle,
        item.url,
        parentFolder?.title,
        ...(item.tags ?? [])
      );
      if (score > 0) {
        entries.push({
          key: `item-${item.id}`,
          kind: 'item',
          title: item.title,
          subtitle: item.subtitle || item.url,
          url: item.url,
          icon: item.icon,
          faviconUrl: item.faviconUrl,
          accent: item.accent,
          folderTitle: parentFolder?.title,
          isPrivate: parentFolder?.isPrivate,
          rect: parentFolder ?? item,
          focusId: parentFolder ? parentFolder.id : item.id,
          score,
        });
      }
    }

    entries.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'));
    return entries.slice(0, 24);
  }, [folders, items, zones, widgets, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  function triggerEntry(entry: SearchEntry) {
    if (entry.kind === 'zone' && entry.zone) {
      onClose();
      onFocusRect?.(entry.zone, entry.zone.id);
      return;
    }
    if (entry.kind === 'note' && entry.note) {
      onClose();
      onFocusRect?.(entry.note, entry.note.id);
      return;
    }
    if (entry.kind === 'folder' && entry.folder) {
      onClose();
      onOpenFolder(entry.folder);
      return;
    }
    if (entry.url) {
      if (openTarget === '_self') {
        window.location.assign(entry.url);
      } else {
        window.open(entry.url, '_blank', 'noopener,noreferrer');
      }
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/35 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bento-modal w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) =>
              results.length === 0 ? 0 : (i - 1 + results.length) % results.length
            );
          } else if (e.key === 'Enter' && results[activeIndex]) {
            e.preventDefault();
            triggerEntry(results[activeIndex]);
          }
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-hair)]">
          <Search size={17} className="text-[var(--ink-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书签、文件夹、分区、便签或拼音首字母..."
            className="w-full bg-transparent text-sm text-[var(--ink-main)] outline-none placeholder:text-[var(--ink-muted)]"
          />
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="bento-scroll max-h-[52vh] overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--ink-muted)]">
              没有找到匹配的书签、文件夹、分区或便签
            </div>
          ) : (
            results.map((entry, idx) => {
              const active = idx === activeIndex;
              const canLocate =
                (entry.kind === 'folder' || entry.kind === 'item') &&
                Boolean(onFocusRect && entry.rect && entry.focusId);

              return (
                <div
                  key={entry.key}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex items-center gap-1.5 rounded-2xl pr-2 transition-colors ${
                    active ? 'bg-[var(--bg-subtle)]' : 'hover:bg-[var(--bg-subtle)]/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => triggerEntry(entry)}
                    className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-2.5 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
                        {entry.kind === 'folder' ? (
                          <Folder
                            size={17}
                            style={entry.accent ? { color: entry.accent } : undefined}
                          />
                        ) : entry.kind === 'zone' ? (
                          <LayoutGrid
                            size={17}
                            style={{ color: entry.accent || 'var(--accent-orange)' }}
                          />
                        ) : entry.kind === 'note' ? (
                          <StickyNote size={17} className="text-amber-500" />
                        ) : (
                          <IconGlyph
                            icon={entry.icon}
                            faviconUrl={entry.faviconUrl}
                            title={entry.title}
                            accent={entry.accent}
                            size={17}
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                          <span className="truncate">{entry.title}</span>
                          {entry.isPrivate && (
                            <Lock size={11} className="text-amber-500 shrink-0" />
                          )}
                          {entry.kind === 'zone' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-hair)] text-[var(--ink-muted)] shrink-0">
                              分区
                            </span>
                          )}
                          {entry.kind === 'note' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-hair)] text-[var(--ink-muted)] shrink-0">
                              便签
                            </span>
                          )}
                          {entry.folderTitle && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-hair)] text-[var(--ink-muted)] shrink-0">
                              {entry.folderTitle}
                            </span>
                          )}
                        </div>
                        {entry.subtitle && (
                          <div className="text-xs text-[var(--ink-muted)] truncate">
                            {entry.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {entry.kind === 'zone' || entry.kind === 'note' ? (
                      <Crosshair size={14} className="text-[var(--accent-orange)] shrink-0" />
                    ) : (
                      <ArrowUpRight size={14} className="text-[var(--ink-muted)] shrink-0" />
                    )}
                  </button>

                  {canLocate && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onFocusRect?.(entry.rect!, entry.focusId!);
                      }}
                      className="h-7 w-7 rounded-xl flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--accent-orange)] hover:bg-[var(--bg-card)] border border-transparent hover:border-[var(--border-hair)] transition-colors cursor-pointer shrink-0"
                      title={
                        entry.kind === 'item' && entry.folderTitle
                          ? `定位到所属文件夹「${entry.folderTitle}」`
                          : '定位到画布'
                      }
                      aria-label="定位到画布"
                    >
                      <Crosshair size={13} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
