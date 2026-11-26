import { useEffect, useRef, useState } from 'react';
import { Compass, FolderOpen, Lock, X } from 'lucide-react';
import type { BookmarkItem, FolderContainer } from '../../shared/types';
import { IconGlyph } from './IconGlyph';

interface FolderNavBarProps {
  folders: FolderContainer[];
  items: BookmarkItem[];
  editMode: boolean;
  onFocusFolder: (folder: FolderContainer) => void;
  onOpenFolder: (folder: FolderContainer) => void;
}

export function FolderNavBar({
  folders,
  items,
  editMode,
  onFocusFolder,
  onOpenFolder,
}: FolderNavBarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (folders.length === 0) return null;

  const countMap = new Map<string, number>();
  for (const it of items) {
    if (it.parentId) {
      countMap.set(it.parentId, (countMap.get(it.parentId) ?? 0) + 1);
    }
  }

  const publicFolders = folders.filter((f) => !f.isPrivate);
  const privateFolders = folders.filter((f) => f.isPrivate);

  return (
    <div
      ref={rootRef}
      className={`fixed left-4 z-30 transition-[bottom] duration-200 ${
        editMode ? 'bottom-24 sm:bottom-5' : 'bottom-5'
      }`}
    >
      {open && (
        <div className="mb-2 w-64 max-h-[62vh] bento-modal !rounded-2xl overflow-hidden flex flex-col shadow-2xl">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border-hair)]">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Compass size={13} className="text-[var(--accent-orange)]" />
              <span>分区快捷导航</span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-6 w-6 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>

          <div className="bento-scroll overflow-y-auto p-2 space-y-2.5">
            {publicFolders.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">
                  公开分区 ({publicFolders.length})
                </div>
                {publicFolders.map((f) => {
                  const color = f.accent || 'var(--accent-orange)';
                  return (
                    <div
                      key={f.id}
                      className="group flex items-center gap-1 rounded-xl hover:bg-[var(--bg-subtle)] transition-colors pr-1"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onFocusFolder(f);
                          setOpen(false);
                        }}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer"
                        title={`定位到「${f.title}」`}
                      >
                        <span
                          className="h-5 w-5 rounded-md flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${color} 15%, var(--bg-card))`,
                            color,
                          }}
                        >
                          <IconGlyph
                            icon={f.icon || 'Folder'}
                            title={f.title}
                            accent={color}
                            size={11}
                          />
                        </span>
                        <span className="text-xs font-medium truncate flex-1">{f.title}</span>
                        <span className="text-[10px] font-mono text-[var(--ink-muted)] shrink-0">
                          {countMap.get(f.id) ?? 0}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenFolder(f);
                          setOpen(false);
                        }}
                        className="h-6 w-6 rounded-lg flex items-center justify-center text-[var(--ink-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-card)] hover:text-[var(--ink-main)] cursor-pointer shrink-0 transition-opacity"
                        title="直接展开文件夹"
                      >
                        <FolderOpen size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {privateFolders.length > 0 && (
              <div className="space-y-0.5 pt-1 border-t border-[var(--border-hair)]">
                <div className="px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Lock size={9} />
                  <span>私密分区 ({privateFolders.length})</span>
                </div>
                {privateFolders.map((f) => {
                  const color = f.accent || '#f59e0b';
                  return (
                    <div
                      key={f.id}
                      className="group flex items-center gap-1 rounded-xl hover:bg-[var(--bg-subtle)] transition-colors pr-1"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onFocusFolder(f);
                          setOpen(false);
                        }}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer"
                        title={`定位到「${f.title}」`}
                      >
                        <span
                          className="h-5 w-5 rounded-md flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${color} 15%, var(--bg-card))`,
                            color,
                          }}
                        >
                          <IconGlyph
                            icon={f.icon || 'Lock'}
                            title={f.title}
                            accent={color}
                            size={11}
                          />
                        </span>
                        <span className="text-xs font-medium truncate flex-1">{f.title}</span>
                        <span className="text-[10px] font-mono text-[var(--ink-muted)] shrink-0">
                          {countMap.get(f.id) ?? 0}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenFolder(f);
                          setOpen(false);
                        }}
                        className="h-6 w-6 rounded-lg flex items-center justify-center text-[var(--ink-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-card)] hover:text-[var(--ink-main)] cursor-pointer shrink-0 transition-opacity"
                        title="直接展开文件夹"
                      >
                        <FolderOpen size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`pill-surface inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
          open
            ? 'text-[var(--accent-orange)]'
            : 'text-[var(--ink-secondary)] hover:text-[var(--ink-main)]'
        }`}
        title="快速定位到任意文件夹分区"
      >
        <Compass size={14} />
        <span>目录</span>
        <span className="rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hair)] px-1.5 py-0.5 text-[10px] font-mono leading-none">
          {folders.length}
        </span>
      </button>
    </div>
  );
}
