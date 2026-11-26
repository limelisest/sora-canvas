import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ExternalLink,
  FolderOutput,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { BookmarkItem, FolderContainer } from '../../shared/types';
import { IconGlyph } from './IconGlyph';
import { MarqueeText } from './MarqueeText';

interface FolderModalProps {
  folder: FolderContainer | null;
  items: BookmarkItem[];
  editMode: boolean;
  openTarget?: '_blank' | '_self';
  hiddenForDrag: boolean;
  draggingItemId: string | null;
  onClose: () => void;
  onEditFolderProps: (folder: FolderContainer) => void;
  onRequestDeleteFolder: (folder: FolderContainer) => void;
  onAddItemToFolder: (folderId: string) => void;
  onEditItem: (item: BookmarkItem) => void;
  onReorderItems: (folderId: string, itemIds: string[]) => void;
  onExtractItemToCanvas: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onModalChildPointerDown: (
    e: ReactPointerEvent,
    folder: FolderContainer,
    item: BookmarkItem,
    modalRect: DOMRect | null
  ) => void;
}

export function FolderModal({
  folder,
  items,
  editMode,
  openTarget = '_blank',
  hiddenForDrag,
  draggingItemId,
  onClose,
  onEditFolderProps,
  onRequestDeleteFolder,
  onAddItemToFolder,
  onEditItem,
  onReorderItems,
  onExtractItemToCanvas,
  onDeleteItem,
  onModalChildPointerDown,
}: FolderModalProps) {
  const modalBoxRef = useRef<HTMLDivElement>(null);

  if (!folder) return null;

  function moveItem(idx: number, dir: -1 | 1) {
    if (!folder) return;
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const copy = items.map((i) => i.id);
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    onReorderItems(folder.id, copy);
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-150 ${
        hiddenForDrag
          ? 'opacity-0 pointer-events-none'
          : 'bg-black/35 backdrop-blur-xs opacity-100'
      }`}
      onClick={() => {
        if (!hiddenForDrag) onClose();
      }}
    >
      <div
        ref={modalBoxRef}
        data-folder-modal-box={folder.id}
        className="bento-modal w-full max-w-lg max-h-[84vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-[var(--border-hair)]">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold truncate">{folder.title}</h2>
            {folder.isPrivate && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/12 text-amber-500 shrink-0">
                <Lock size={11} />
                私密
              </span>
            )}
            <span className="text-xs text-[var(--ink-muted)] shrink-0">{items.length} 项</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {editMode && (
              <>
                <button
                  type="button"
                  onClick={() => onAddItemToFolder(folder.id)}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 cursor-pointer"
                >
                  <Plus size={13} />
                  <span>添加项目</span>
                </button>
                <button
                  type="button"
                  onClick={() => onEditFolderProps(folder)}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                  title="编辑文件夹属性"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDeleteFolder(folder)}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
                  title="解散或删除文件夹"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {editMode && items.length > 0 && (
          <div className="px-5 py-1.5 text-[11px] text-[var(--ink-muted)] bg-[var(--bg-subtle)]/65 border-b border-[var(--border-hair)]">
            提示：按住项目可内部排序；直接拖出弹窗边界即可放回桌面或移至其他文件夹
          </div>
        )}

        {/* Items List */}
        <div
          style={{ touchAction: 'pan-y' }}
          className="bento-scroll flex-1 overflow-y-auto p-3 space-y-1.5"
        >
          {items.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--ink-muted)]">
              文件夹还是空的
              {editMode ? '，点击上方「添加项目」或将桌面书签拖入此文件夹' : ''}
            </div>
          ) : (
            items.map((item, idx) => {
              const isDragging = draggingItemId === item.id;
              return (
                <div
                  key={item.id}
                  data-marquee-host
                  data-modal-child-id={item.id}
                  onPointerDown={(e) => {
                    if (!editMode) return;
                    onModalChildPointerDown(
                      e,
                      folder,
                      item,
                      modalBoxRef.current?.getBoundingClientRect() ?? null
                    );
                  }}
                  className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl transition-colors ${
                    isDragging
                      ? 'opacity-35 border border-dashed border-[var(--accent-orange)] bg-[var(--bg-subtle)]'
                      : 'hover:bg-[var(--bg-subtle)]'
                  } ${editMode ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
                >
                  {editMode ? (
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <GripVertical size={14} className="text-[var(--ink-muted)] shrink-0" />
                      <div className="h-9 w-9 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
                        <IconGlyph
                          icon={item.icon}
                          faviconUrl={item.faviconUrl}
                          title={item.title}
                          accent={item.accent}
                          size={17}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <MarqueeText text={item.title} className="text-sm font-medium" />
                        <div className="text-xs text-[var(--ink-muted)] truncate">
                          {item.subtitle || item.url}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <a
                      href={item.url}
                      target={openTarget}
                      rel={openTarget === '_blank' ? 'noopener noreferrer' : undefined}
                      className="flex items-center gap-3 min-w-0 flex-1"
                    >
                      <div className="h-9 w-9 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
                        <IconGlyph
                          icon={item.icon}
                          faviconUrl={item.faviconUrl}
                          title={item.title}
                          accent={item.accent}
                          size={17}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium flex items-center gap-1.5 min-w-0">
                          <MarqueeText text={item.title} className="flex-1" />
                          <ExternalLink
                            size={11}
                            className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                          />
                        </div>
                        <div className="text-xs text-[var(--ink-muted)] truncate">
                          {item.subtitle || item.url}
                        </div>
                      </div>
                    </a>
                  )}

                  {editMode ? (
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onEditItem(item)}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--ink-secondary)] hover:bg-[var(--bg-card)] cursor-pointer"
                        title="编辑项目"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--ink-secondary)] hover:bg-[var(--bg-card)] disabled:opacity-30 cursor-pointer"
                        title="上移"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--ink-secondary)] hover:bg-[var(--bg-card)] disabled:opacity-30 cursor-pointer"
                        title="下移"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onExtractItemToCanvas(item.id)}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--ink-main)] cursor-pointer"
                        title="移出到画布空位"
                      >
                        <FolderOutput size={13} />
                        <span className="hidden sm:inline">移出</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteItem(item.id)}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
                        title="删除项目"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <a
                      href={item.url}
                      target={openTarget}
                      rel={openTarget === '_blank' ? 'noopener noreferrer' : undefined}
                      className="h-7 w-7 rounded-full flex items-center justify-center text-[var(--ink-muted)] group-hover:text-[var(--ink-main)]"
                    >
                      <ArrowUpRight size={14} />
                    </a>
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
