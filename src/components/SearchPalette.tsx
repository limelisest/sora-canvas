import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Folder, Lock, Search, X } from 'lucide-react';
import type { BookmarkItem, FolderContainer } from '../../shared/types';
import { fuzzyScore } from '../../shared/pinyin';
import { IconGlyph } from './IconGlyph';

interface SearchEntry {
  key: string;
  kind: 'item' | 'folder';
  title: string;
  subtitle?: string;
  url?: string;
  icon?: string;
  faviconUrl?: string;
  accent?: string;
  folderTitle?: string;
  isPrivate?: boolean;
  folder?: FolderContainer;
  score: number;
}

interface SearchPaletteProps {
  open: boolean;
  folders: FolderContainer[];
  items: BookmarkItem[];
  openTarget?: '_blank' | '_self';
  onClose: () => void;
  onOpenFolder: (folder: FolderContainer) => void;
}

export function SearchPalette({
  open,
  folders,
  items,
  openTarget = '_blank',
  onClose,
  onOpenFolder,
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
          score,
        });
      }
    }

    entries.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'));
    return entries.slice(0, 24);
  }, [folders, items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  function triggerEntry(entry: SearchEntry) {
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
            placeholder="搜索书签、文件夹或拼音首字母（如 gzt / smsc）..."
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
              没有找到匹配的书签或文件夹
            </div>
          ) : (
            results.map((entry, idx) => {
              const active = idx === activeIndex;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => triggerEntry(entry)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl text-left transition-colors cursor-pointer ${
                    active ? 'bg-[var(--bg-subtle)]' : 'hover:bg-[var(--bg-subtle)]/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
                      {entry.kind === 'folder' ? (
                        <Folder
                          size={17}
                          style={entry.accent ? { color: entry.accent } : undefined}
                        />
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
                  <ArrowUpRight size={14} className="text-[var(--ink-muted)] shrink-0" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
