import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, FolderOpen, LayoutGrid, Lock, X } from 'lucide-react';
import type { BookmarkItem, FolderContainer, ZoneContainer } from '../../shared/types';
import { isEntityInsideZone } from '../../shared/gridEngine';
import { IconGlyph } from './IconGlyph';

interface FolderNavBarProps {
  folders: FolderContainer[];
  items: BookmarkItem[];
  zones?: ZoneContainer[];
  editMode: boolean;
  onFocusFolder: (folder: FolderContainer) => void;
  onFocusZone?: (zone: ZoneContainer) => void;
  onOpenFolder: (folder: FolderContainer) => void;
}

function compareReadingOrder(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.y - b.y) > 0.4 ? a.y - b.y : a.x - b.x;
}

export function FolderNavBar({
  folders,
  items,
  zones = [],
  editMode,
  onFocusFolder,
  onFocusZone,
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

  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      if (it.parentId) {
        map.set(it.parentId, (map.get(it.parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [items]);

  const { zoneGroups, ungroupedFolders } = useMemo(() => {
    const sortedZones = [...zones].sort(compareReadingOrder);
    const sortedFolders = [...folders].sort(compareReadingOrder);

    const assignedFolderIds = new Set<string>();
    const groups = sortedZones.map((zone) => {
      const inner = sortedFolders.filter((f) => {
        if (assignedFolderIds.has(f.id)) return false;
        if (isEntityInsideZone(f, zone)) {
          assignedFolderIds.add(f.id);
          return true;
        }
        return false;
      });
      return { zone, folders: inner };
    });

    const ungrouped = sortedFolders.filter((f) => !assignedFolderIds.has(f.id));
    return { zoneGroups: groups, ungroupedFolders: ungrouped };
  }, [folders, zones]);

  if (folders.length === 0 && zones.length === 0) return null;

  const renderFolderRow = (f: FolderContainer, indented: boolean) => {
    const color = f.accent || (f.isPrivate ? '#f59e0b' : 'var(--accent-orange)');
    return (
      <div
        key={f.id}
        className={`group flex items-center gap-1 rounded-xl hover:bg-[var(--bg-subtle)] transition-colors pr-1 ${
          indented ? 'pl-2' : ''
        }`}
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
              icon={f.icon || (f.isPrivate ? 'Lock' : 'Folder')}
              title={f.title}
              accent={color}
              size={11}
            />
          </span>
          <span className="text-xs font-medium truncate flex-1">{f.title}</span>
          {f.isPrivate && <Lock size={10} className="text-amber-500 shrink-0" />}
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
  };

  return (
    <div
      ref={rootRef}
      className={`fixed left-4 z-30 transition-[bottom] duration-200 ${
        editMode ? 'bottom-24 sm:bottom-5' : 'bottom-5'
      }`}
    >
      {open && (
        <div className="mb-2 w-68 max-h-[64vh] bento-modal !rounded-2xl overflow-hidden flex flex-col shadow-2xl">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border-hair)]">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Compass size={13} className="text-[var(--accent-orange)]" />
              <span>分区目录导航</span>
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
            {zoneGroups.map(({ zone, folders: innerFolders }) => {
              const zColor = zone.isPrivate ? '#ff5500' : zone.accent || 'var(--accent-orange)';
              return (
                <div key={zone.id} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      onFocusZone?.(zone);
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-xl text-left hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                    title={`平滑居中定位到分区「${zone.title}」`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: zColor }}
                      />
                      <LayoutGrid size={11} className="text-[var(--ink-muted)] shrink-0" />
                      <span className="text-[11px] font-semibold text-[var(--ink-secondary)] truncate">
                        {zone.title}
                      </span>
                      {zone.isPrivate && <Lock size={10} className="text-amber-500 shrink-0" />}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--ink-muted)] shrink-0">
                      {innerFolders.length}
                    </span>
                  </button>

                  {innerFolders.length > 0 && (
                    <div className="space-y-0.5 border-l border-[var(--border-hair)] ml-3 pl-1">
                      {innerFolders.map((f) => renderFolderRow(f, false))}
                    </div>
                  )}
                </div>
              );
            })}

            {ungroupedFolders.length > 0 && (
              <div
                className={`space-y-0.5 ${
                  zoneGroups.length > 0 ? 'pt-1.5 border-t border-[var(--border-hair)]' : ''
                }`}
              >
                <div className="px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">
                  {zoneGroups.length > 0
                    ? `未分组文件夹 (${ungroupedFolders.length})`
                    : `全部文件夹 (${ungroupedFolders.length})`}
                </div>
                {ungroupedFolders.map((f) => renderFolderRow(f, false))}
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
        title="快速定位到任意分区或文件夹"
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
