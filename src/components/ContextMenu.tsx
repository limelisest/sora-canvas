import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderInput,
  FolderOpen,
  FolderOutput,
  FolderPlus,
  Images,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react';
import type {
  BookmarkItem,
  CanvasWidget,
  FolderContainer,
  NoteWidget,
  ZoneContainer,
} from '../../shared/types';
import type { ContextMenuTarget } from './CanvasCard';

export interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTarget;
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  unlocked: boolean;
  editMode: boolean;
  hideZonePrivateToggle?: boolean;
  folders: FolderContainer[];
  onClose: () => void;
  onOpenFolder: (folder: FolderContainer) => void;
  onCycleFolderMode: (folder: FolderContainer) => void;
  onSetFolderAccent: (folder: FolderContainer, accent?: string) => void;
  onToggleFolderPrivate: (folder: FolderContainer) => void;
  onEditFolder: (folder: FolderContainer) => void;
  onAddItemToFolder: (folderId: string) => void;
  onDeleteFolder: (folder: FolderContainer) => void;
  onEditItem: (item: BookmarkItem) => void;
  onMoveItemToFolder: (itemId: string, folderId: string) => void;
  onExtractItemToCanvas: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onCopyUrl: (url: string) => void;
  onCreateItem: (worldX?: number, worldY?: number) => void;
  onCreateFolder: (worldX?: number, worldY?: number) => void;
  onCreateZone: (worldX?: number, worldY?: number) => void;
  onCreateCarousel: (worldX?: number, worldY?: number) => void;
  onCreateText: (worldX?: number, worldY?: number) => void;
  onCreateNote: (worldX?: number, worldY?: number) => void;
  onEditZone: (zone: ZoneContainer) => void;
  onSetZoneAccent: (zone: ZoneContainer, accent?: string) => void;
  onToggleZonePrivate: (zone: ZoneContainer) => void;
  onDeleteZone: (zoneId: string) => void;
  onEditWidget: (widget: CanvasWidget) => void;
  onRequestEditNote: (note: NoteWidget) => void;
  onToggleNotePrivate: (note: NoteWidget) => void;
  onDeleteWidget: (widgetId: string) => void;
  onToggleEditMode: () => void;
  onResetView: () => void;
  onOpenSearch: () => void;
}

const QUICK_COLORS = [
  '#ec4899',
  '#8b5cf6',
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#10b981',
  '#eab308',
  '#f97316',
];

export function ContextMenu({
  menu,
  unlocked,
  editMode,
  hideZonePrivateToggle = false,
  folders,
  onClose,
  onOpenFolder,
  onCycleFolderMode,
  onSetFolderAccent,
  onToggleFolderPrivate,
  onEditFolder,
  onAddItemToFolder,
  onDeleteFolder,
  onEditItem,
  onMoveItemToFolder,
  onExtractItemToCanvas,
  onDeleteItem,
  onCopyUrl,
  onCreateItem,
  onCreateFolder,
  onCreateZone,
  onCreateCarousel,
  onCreateText,
  onCreateNote,
  onEditZone,
  onSetZoneAccent,
  onToggleZonePrivate,
  onDeleteZone,
  onEditWidget,
  onRequestEditNote,
  onToggleNotePrivate,
  onDeleteWidget,
  onToggleEditMode,
  onResetView,
  onOpenSearch,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [moveListOpen, setMoveListOpen] = useState(false);

  useEffect(() => {
    setMoveListOpen(false);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const estWidth = 228;
  const estHeight = 320;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - estWidth - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - estHeight - 8));

  const itemClass =
    'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-xl text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer';
  const dangerClass =
    'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left rounded-xl text-[var(--accent-red)] hover:bg-red-500/10 transition-colors cursor-pointer';

  const { target } = menu;

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left, top, width: estWidth, zIndex: 70 }}
      className="bento-modal !rounded-2xl p-1.5 shadow-2xl select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {target.kind === 'folder' && (
        <>
          <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] truncate border-b border-[var(--border-hair)] mb-1">
            {target.folder.title}
          </div>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onOpenFolder(target.folder);
              onClose();
            }}
          >
            <FolderOpen size={13} className="text-[var(--ink-secondary)]" />
            <span>打开文件夹</span>
          </button>

          {unlocked && (
            <>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCycleFolderMode(target.folder);
                  onClose();
                }}
              >
                {target.folder.displayMode === 'list' ? (
                  <LayoutGrid size={13} className="text-[var(--ink-secondary)]" />
                ) : (
                  <List size={13} className="text-[var(--ink-secondary)]" />
                )}
                <span>
                  切换为{target.folder.displayMode === 'list' ? '宫格' : '列表'}模式
                </span>
              </button>

              <div className="px-3 py-2 border-y border-[var(--border-hair)] my-1">
                <div className="text-[10px] text-[var(--ink-muted)] mb-1.5">快速主题色</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {QUICK_COLORS.map((hex) => {
                    const active = target.folder.accent === hex;
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => {
                          onSetFolderAccent(target.folder, hex);
                          onClose();
                        }}
                        style={{ backgroundColor: hex }}
                        className={`h-4.5 w-4.5 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${
                          active ? 'ring-2 ring-offset-1 ring-[var(--ink-main)]' : ''
                        }`}
                        title={hex}
                      >
                        {active && <Check size={9} className="text-white" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      onSetFolderAccent(target.folder, undefined);
                      onClose();
                    }}
                    className="h-4.5 px-1.5 rounded-full text-[9px] border border-[var(--border-hair)] text-[var(--ink-muted)] hover:text-[var(--ink-main)] cursor-pointer"
                    title="清除主题色"
                  >
                    无
                  </button>
                </div>
              </div>

              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onEditFolder(target.folder);
                  onClose();
                }}
              >
                <Pencil size={13} className="text-[var(--ink-secondary)]" />
                <span>编辑名称与图标</span>
              </button>

              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onToggleFolderPrivate(target.folder);
                  onClose();
                }}
              >
                {target.folder.isPrivate ? (
                  <Unlock size={13} className="text-amber-500" />
                ) : (
                  <Lock size={13} className="text-amber-500" />
                )}
                <span>{target.folder.isPrivate ? '设为公开文件夹' : '设为私密文件夹'}</span>
              </button>

              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onAddItemToFolder(target.folder.id);
                  onClose();
                }}
              >
                <Plus size={13} className="text-[var(--ink-secondary)]" />
                <span>添加书签至此文件夹</span>
              </button>

              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={dangerClass}
                onClick={() => {
                  onDeleteFolder(target.folder);
                  onClose();
                }}
              >
                <Trash2 size={13} />
                <span>解散或删除文件夹</span>
              </button>
            </>
          )}
        </>
      )}

      {target.kind === 'item' && (
        <>
          <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] truncate border-b border-[var(--border-hair)] mb-1">
            {target.item.title}
          </div>
          <a
            href={target.item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className={itemClass}
          >
            <ExternalLink size={13} className="text-[var(--ink-secondary)]" />
            <span>新标签打开</span>
          </a>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onCopyUrl(target.item.url);
              onClose();
            }}
          >
            <Copy size={13} className="text-[var(--ink-secondary)]" />
            <span>复制链接</span>
          </button>

          {unlocked && (
            <>
              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onEditItem(target.item);
                  onClose();
                }}
              >
                <Pencil size={13} className="text-[var(--ink-secondary)]" />
                <span>编辑书签属性</span>
              </button>

              {target.item.parentId !== null && (
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => {
                    onExtractItemToCanvas(target.item.id);
                    onClose();
                  }}
                >
                  <FolderOutput size={13} className="text-[var(--ink-secondary)]" />
                  <span>移出到桌面</span>
                </button>
              )}

              {folders.filter((f) => f.id !== target.item.parentId).length > 0 && (
                <div>
                  <button
                    type="button"
                    className={itemClass}
                    onClick={() => setMoveListOpen((v) => !v)}
                  >
                    <FolderInput size={13} className="text-[var(--ink-secondary)]" />
                    <span className="flex-1">移入文件夹…</span>
                  </button>
                  {moveListOpen && (
                    <div className="max-h-36 overflow-y-auto bento-scroll pl-4 pr-1 py-1 space-y-0.5">
                      {folders
                        .filter((f) => f.id !== target.item.parentId)
                        .map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              onMoveItemToFolder(target.item.id, f.id);
                              onClose();
                            }}
                            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-left hover:bg-[var(--bg-subtle)] truncate cursor-pointer"
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: f.accent || 'var(--ink-muted)' }}
                            />
                            <span className="truncate flex-1">{f.title}</span>
                            {f.isPrivate && <Lock size={10} className="text-amber-500 shrink-0" />}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={dangerClass}
                onClick={() => {
                  onDeleteItem(target.item.id);
                  onClose();
                }}
              >
                <Trash2 size={13} />
                <span>删除书签</span>
              </button>
            </>
          )}
        </>
      )}

      {target.kind === 'zone' && (
        <>
          <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] truncate border-b border-[var(--border-hair)] mb-1">
            分区 · {target.zone.title}
          </div>
          {unlocked && (
            <>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onEditZone(target.zone);
                  onClose();
                }}
              >
                <Pencil size={13} className="text-[var(--ink-secondary)]" />
                <span>编辑分区属性</span>
              </button>

              <div className="px-3 py-2 border-y border-[var(--border-hair)] my-1">
                <div className="text-[10px] text-[var(--ink-muted)] mb-1.5">分区主题色</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {QUICK_COLORS.map((hex) => {
                    const active = target.zone.accent === hex;
                    return (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => {
                          onSetZoneAccent(target.zone, hex);
                          onClose();
                        }}
                        style={{ backgroundColor: hex }}
                        className={`h-4.5 w-4.5 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${
                          active ? 'ring-2 ring-offset-1 ring-[var(--ink-main)]' : ''
                        }`}
                        title={hex}
                      >
                        {active && <Check size={9} className="text-white" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      onSetZoneAccent(target.zone, undefined);
                      onClose();
                    }}
                    className="h-4.5 px-1.5 rounded-full text-[9px] border border-[var(--border-hair)] text-[var(--ink-muted)] hover:text-[var(--ink-main)] cursor-pointer"
                  >
                    默认
                  </button>
                </div>
              </div>

              {!hideZonePrivateToggle && (
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => {
                    onToggleZonePrivate(target.zone);
                    onClose();
                  }}
                >
                  {target.zone.isPrivate ? (
                    <Unlock size={13} className="text-amber-500" />
                  ) : (
                    <Lock size={13} className="text-amber-500" />
                  )}
                  <span>{target.zone.isPrivate ? '设为公开分区' : '设为私密分区'}</span>
                </button>
              )}

              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={dangerClass}
                onClick={() => {
                  onDeleteZone(target.zone.id);
                  onClose();
                }}
              >
                <Trash2 size={13} />
                <span>删除分区框</span>
              </button>
            </>
          )}
        </>
      )}

      {target.kind === 'widget' && (
        <>
          <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--ink-muted)] truncate border-b border-[var(--border-hair)] mb-1">
            {target.widget.kind === 'carousel'
              ? target.widget.title || '轮播图小部件'
              : target.widget.kind === 'note'
                ? target.widget.title || '便签贴纸'
                : '自由文字标注'}
          </div>

          {target.widget.kind === 'note' ? (
            <>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onRequestEditNote(target.widget as NoteWidget);
                  onClose();
                }}
              >
                <Pencil size={13} className="text-[var(--ink-secondary)]" />
                <span>{unlocked ? '编辑便签内容' : '解锁并编辑便签'}</span>
              </button>
              {unlocked && (
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => {
                    onEditWidget(target.widget);
                    onClose();
                  }}
                >
                  <Pencil size={13} className="text-[var(--ink-secondary)]" />
                  <span>更多设置（尺寸 / 底色）</span>
                </button>
              )}
            </>
          ) : (
            unlocked && (
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onEditWidget(target.widget);
                  onClose();
                }}
              >
                <Pencil size={13} className="text-[var(--ink-secondary)]" />
                <span>编辑小部件属性</span>
              </button>
            )
          )}

          {unlocked && target.widget.kind === 'note' && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onToggleNotePrivate(target.widget as NoteWidget);
                onClose();
              }}
            >
              {target.widget.isPrivate ? (
                <Unlock size={13} className="text-amber-500" />
              ) : (
                <Lock size={13} className="text-amber-500" />
              )}
              <span>{target.widget.isPrivate ? '设为公开便签' : '设为私密便签'}</span>
            </button>
          )}

          {unlocked && (
            <>
              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={dangerClass}
                onClick={() => {
                  onDeleteWidget(target.widget.id);
                  onClose();
                }}
              >
                <Trash2 size={13} />
                <span>删除小部件</span>
              </button>
            </>
          )}
        </>
      )}

      {target.kind === 'canvas' && (
        <>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onOpenSearch();
              onClose();
            }}
          >
            <Search size={13} className="text-[var(--ink-secondary)]" />
            <span>全局搜索</span>
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onResetView();
              onClose();
            }}
          >
            <RotateCcw size={13} className="text-[var(--ink-secondary)]" />
            <span>重置画布视野</span>
          </button>

          {unlocked && (
            <>
              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCreateItem(target.worldX, target.worldY);
                  onClose();
                }}
              >
                <Plus size={13} className="text-[var(--accent-orange)]" />
                <span>新建书签</span>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCreateFolder(target.worldX, target.worldY);
                  onClose();
                }}
              >
                <FolderPlus size={13} className="text-[var(--ink-secondary)]" />
                <span>新建文件夹</span>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCreateZone(target.worldX, target.worldY);
                  onClose();
                }}
              >
                <LayoutGrid size={13} className="text-[var(--accent-orange)]" />
                <span>新建区域分区框</span>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCreateCarousel(target.worldX, target.worldY);
                  onClose();
                }}
              >
                <Images size={13} className="text-sky-500" />
                <span>新建轮播图小部件</span>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCreateText(target.worldX, target.worldY);
                  onClose();
                }}
              >
                <Type size={13} className="text-violet-500" />
                <span>新建自由文字</span>
              </button>
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onCreateNote(target.worldX, target.worldY);
                  onClose();
                }}
              >
                <StickyNote size={13} className="text-amber-500" />
                <span>新建便签贴纸</span>
              </button>
              <div className="my-1 border-t border-[var(--border-hair)]" />
              <button
                type="button"
                className={itemClass}
                onClick={() => {
                  onToggleEditMode();
                  onClose();
                }}
              >
                <Pencil size={13} className="text-[var(--ink-secondary)]" />
                <span>{editMode ? '退出编辑模式' : '进入编辑模式'}</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
