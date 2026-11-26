import { useState } from 'react';
import {
  Crosshair,
  FolderInput,
  FolderPlus,
  Images,
  LayoutGrid,
  Lock,
  Pencil,
  Plus,
  Redo2,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import type { FolderContainer } from '../../shared/types';
import { SHORTCUT_REDO, SHORTCUT_UNDO } from '../utils/platform';

interface EditDockProps {
  selectedCount: number;
  selectedItemCount: number;
  folders: FolderContainer[];
  marqueeMode?: boolean;
  showAnchorButton?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onCreateItem: () => void;
  onCreateFolder: () => void;
  onCreateZone: () => void;
  onCreateCarousel: () => void;
  onCreateText: () => void;
  onCreateNote: () => void;
  onToggleMarquee?: () => void;
  onSetViewportOrigin: () => void;
  onEditSelected: () => void;
  onDeleteSelected: () => void;
  onMoveSelectedItemsToFolder: (folderId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditDock({
  selectedCount,
  selectedItemCount,
  folders,
  showAnchorButton = true,
  canUndo,
  canRedo,
  onCreateItem,
  onCreateFolder,
  onCreateZone,
  onCreateCarousel,
  onCreateText,
  onCreateNote,
  onSetViewportOrigin,
  onEditSelected,
  onDeleteSelected,
  onMoveSelectedItemsToFolder,
  onUndo,
  onRedo,
}: EditDockProps) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [widgetMenuOpen, setWidgetMenuOpen] = useState(false);

  return (
    <div className="pointer-events-none fixed bottom-5 left-0 right-0 z-30 flex flex-col items-center gap-2 px-4">
      {widgetMenuOpen && (
        <div className="pointer-events-auto bento-modal !rounded-2xl p-1.5 grid grid-cols-2 gap-1 max-w-sm shadow-xl">
          <button
            type="button"
            onClick={() => {
              onCreateZone();
              setWidgetMenuOpen(false);
            }}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-left hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <LayoutGrid size={14} className="text-[var(--accent-orange)] shrink-0" />
            <span>新建区域分区框</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCreateCarousel();
              setWidgetMenuOpen(false);
            }}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-left hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <Images size={14} className="text-sky-500 shrink-0" />
            <span>新建轮播图小部件</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCreateText();
              setWidgetMenuOpen(false);
            }}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-left hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <Type size={14} className="text-violet-500 shrink-0" />
            <span>新建自由文字</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCreateNote();
              setWidgetMenuOpen(false);
            }}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-left hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <StickyNote size={14} className="text-amber-500 shrink-0" />
            <span>新建便签贴纸</span>
          </button>
        </div>
      )}

      {folderPickerOpen && selectedItemCount > 0 && folders.length > 0 && (
        <div className="pointer-events-auto bento-modal px-2 py-2 flex flex-wrap items-center justify-center gap-1 max-w-md shadow-xl">
          <span className="text-[11px] text-[var(--ink-muted)] px-2">
            将 {selectedItemCount} 个项目移入：
          </span>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => {
                onMoveSelectedItemsToFolder(folder.id);
                setFolderPickerOpen(false);
              }}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-[var(--bg-subtle)] hover:bg-[var(--accent-orange)] hover:text-white border border-[var(--border-hair)] transition-colors cursor-pointer"
            >
              {folder.isPrivate && <Lock size={10} className="text-amber-500" />}
              <span>{folder.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="pointer-events-auto pill-surface flex flex-wrap items-center justify-center gap-1 px-3 py-1.5 text-xs">
        <button
          type="button"
          onClick={onCreateItem}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus size={13} />
          <span>新建项目</span>
        </button>

        <button
          type="button"
          onClick={onCreateFolder}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
        >
          <FolderPlus size={13} />
          <span>新建文件夹</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setFolderPickerOpen(false);
            setWidgetMenuOpen((v) => !v);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors cursor-pointer ${
            widgetMenuOpen
              ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
              : 'text-[var(--ink-main)] hover:bg-[var(--bg-subtle)]'
          }`}
          title="新建分区框、轮播图、自由文字或便签"
        >
          <LayoutGrid size={13} />
          <span>小部件 / 分区</span>
        </button>

        <span className="h-4 w-px bg-[var(--border-hair)] mx-0.5" />

        {showAnchorButton && (
          <button
            type="button"
            onClick={onSetViewportOrigin}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
            title="将当前屏幕正中心保存为默认视野锚点"
          >
            <Crosshair size={13} />
            <span>设为锚点</span>
          </button>
        )}

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] disabled:opacity-35 cursor-pointer disabled:cursor-default"
          title={`撤销 (${SHORTCUT_UNDO})`}
        >
          <Undo2 size={13} />
          <span className="hidden sm:inline">撤销</span>
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] disabled:opacity-35 cursor-pointer disabled:cursor-default"
          title={`重做 (${SHORTCUT_REDO})`}
        >
          <Redo2 size={13} />
          <span className="hidden sm:inline">重做</span>
        </button>

        {selectedCount > 0 && (
          <>
            <span className="h-4 w-px bg-[var(--border-hair)] mx-0.5" />
            <span className="px-2 text-[var(--ink-muted)] font-medium">
              已选 {selectedCount}
            </span>
            {selectedCount === 1 && (
              <button
                type="button"
                onClick={onEditSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                <Pencil size={12} />
                <span>属性</span>
              </button>
            )}
            {selectedItemCount > 0 && folders.length > 0 && (
              <button
                type="button"
                onClick={() => setFolderPickerOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium cursor-pointer ${
                  folderPickerOpen
                    ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
                    : 'text-[var(--ink-main)] hover:bg-[var(--bg-subtle)]'
                }`}
                title="将选中的书签项目移入文件夹"
              >
                <FolderInput size={12} />
                <span>移入文件夹</span>
              </button>
            )}
            <button
              type="button"
              onClick={onDeleteSelected}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
            >
              <Trash2 size={12} />
              <span>删除</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
