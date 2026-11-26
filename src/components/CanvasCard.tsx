import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  Pencil,
} from 'lucide-react';
import type {
  BookmarkItem,
  CanvasGridEntity,
  CanvasWidget,
  FolderContainer,
  GridConfig,
  NoteWidget,
  ZoneContainer,
} from '../../shared/types';
import { IconGlyph } from './IconGlyph';
import { MarqueeText } from './MarqueeText';
import { CarouselWidgetBody, NoteWidgetBody } from './WidgetCard';

export type ContextMenuTarget =
  | { kind: 'folder'; folder: FolderContainer }
  | { kind: 'item'; item: BookmarkItem; folder?: FolderContainer }
  | { kind: 'zone'; zone: ZoneContainer }
  | { kind: 'widget'; widget: CanvasWidget }
  | { kind: 'canvas'; worldX: number; worldY: number };

interface CanvasCardProps {
  entity: CanvasGridEntity;
  folderItems: BookmarkItem[];
  grid: GridConfig;
  editMode: boolean;
  glassMode?: boolean;
  openTarget?: '_blank' | '_self';
  isSelected: boolean;
  isLifted: boolean;
  isPushed: boolean;
  isError: boolean;
  isFolderDropTarget: boolean;
  isMergeTarget: boolean;
  isResizing: boolean;
  isNewlyCreated?: boolean;
  isInlineEditing?: boolean;
  dragOffset?: { dxPx: number; dyPx: number } | null;
  draggingChildId: string | null;
  onCardPointerDown: (e: ReactPointerEvent, entity: CanvasGridEntity) => void;
  onChildPointerDown: (
    e: ReactPointerEvent,
    folder: FolderContainer,
    item: BookmarkItem
  ) => void;
  onResizePointerDown: (e: ReactPointerEvent, entity: CanvasGridEntity) => void;
  onOpenFolder: (folder: FolderContainer) => void;
  onEditEntity: (entity: CanvasGridEntity) => void;
  onRequestEditNote?: (note: NoteWidget) => void;
  onStartInlineNoteEdit?: (note: NoteWidget) => void;
  onCommitInlineNote?: (note: NoteWidget, title: string, content: string) => void;
  onCancelInlineEdit?: () => void;
  onCycleFolderMode?: (folder: FolderContainer) => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const CanvasCard = memo(function CanvasCard({
  entity,
  folderItems,
  grid,
  editMode,
  glassMode = false,
  openTarget = '_blank',
  isSelected,
  isLifted,
  isPushed,
  isError,
  isFolderDropTarget,
  isMergeTarget,
  isResizing,
  isNewlyCreated = false,
  isInlineEditing = false,
  dragOffset,
  draggingChildId,
  onCardPointerDown,
  onChildPointerDown,
  onResizePointerDown,
  onOpenFolder,
  onEditEntity,
  onRequestEditNote,
  onStartInlineNoteEdit,
  onCommitInlineNote,
  onCancelInlineEdit,
  onCycleFolderMode,
  onOpenContextMenu,
}: CanvasCardProps) {
  const step = grid.cellSize + grid.gap;
  const left = entity.x * step;
  const top = entity.y * step;
  const width = entity.w * grid.cellSize + (entity.w - 1) * grid.gap;
  const height = entity.h * grid.cellSize + (entity.h - 1) * grid.gap;
  const is1x1 = entity.w === 1 && entity.h === 1;
  const isActivelyDragged = Boolean(dragOffset);

  // Prevent snap-back animation when releasing an actively dragged card onto its new grid cell
  const prevDraggedRef = useRef(false);
  const [suppressDropTransition, setSuppressDropTransition] = useState(false);

  useEffect(() => {
    if (prevDraggedRef.current && !isActivelyDragged) {
      setSuppressDropTransition(true);
      const raf = window.requestAnimationFrame(() => {
        setSuppressDropTransition(false);
      });
      prevDraggedRef.current = false;
      return () => window.cancelAnimationFrame(raf);
    }
    prevDraggedRef.current = isActivelyDragged;
  }, [isActivelyDragged]);

  const skipTransition =
    isActivelyDragged || suppressDropTransition || (prevDraggedRef.current && !isActivelyDragged);

  const isFolder = entity.kind === 'folder';
  const isNote = entity.kind === 'note';
  const noteTint = isNote ? entity.tint || '' : '';
  const folderAccent = isFolder ? entity.accent || (entity.isPrivate ? '#f59e0b' : '') : '';
  const hasThemedFolder = isFolder && Boolean(folderAccent) && !entity.isPrivate;

  const stateClass = [
    'bento-card',
    glassMode ? 'bento-card-glass' : '',
    is1x1 ? 'bento-card-1x1' : '',
    isNote && noteTint ? 'bento-note-tinted' : '',
    (isFolder && entity.isPrivate) || (isNote && entity.isPrivate) ? 'bento-folder-private' : '',
    hasThemedFolder ? 'bento-folder-themed' : '',
    isSelected ? 'bento-card-selected' : '',
    isResizing ? 'bento-card-resizing' : '',
    isPushed ? 'bento-card-pushed' : '',
    isError ? 'bento-card-error' : '',
    isFolderDropTarget || isMergeTarget ? 'bento-card-drop-target' : '',
    isNewlyCreated ? 'newly-created-pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const transformStyle = isActivelyDragged
    ? `translate3d(${dragOffset!.dxPx}px, ${dragOffset!.dyPx}px, 0)${isLifted ? ' scale(1.05)' : ''}`
    : isLifted
      ? 'scale(1.05)'
      : isFolderDropTarget || isMergeTarget
        ? 'scale(1.04)'
        : undefined;

  const cardStyle: CSSProperties = {
    position: 'absolute',
    left,
    top,
    width,
    height,
    transform: transformStyle,
    transition: skipTransition ? 'none' : undefined,
    willChange: isActivelyDragged ? 'transform' : undefined,
    zIndex: isActivelyDragged || isLifted ? 35 : isError || isResizing || isSelected ? 25 : 10,
    userSelect: 'none',
    boxShadow: isLifted || isActivelyDragged ? '0 16px 36px rgba(255, 85, 0, 0.24)' : undefined,
    ...(folderAccent ? ({ '--folder-accent': folderAccent } as CSSProperties) : {}),
    ...(noteTint ? ({ '--note-tint': noteTint } as CSSProperties) : {}),
  };

  return (
    <div
      data-entity-id={entity.id}
      data-marquee-host={entity.kind === 'item' ? '' : undefined}
      onPointerDown={(e) => onCardPointerDown(e, entity)}
      onContextMenu={(e) => {
        if (!onOpenContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        if (entity.kind === 'folder') {
          onOpenContextMenu(e, { kind: 'folder', folder: entity });
        } else if (entity.kind === 'item') {
          onOpenContextMenu(e, { kind: 'item', item: entity });
        } else {
          onOpenContextMenu(e, { kind: 'widget', widget: entity });
        }
      }}
      onClick={() => {
        if (editMode) return;
        if (entity.kind === 'folder') {
          onOpenFolder(entity);
        }
      }}
      onDoubleClick={(e) => {
        if (!editMode || isInlineEditing) return;
        e.stopPropagation();
        if (entity.kind === 'note' && onStartInlineNoteEdit) {
          onStartInlineNoteEdit(entity);
        } else {
          onEditEntity(entity);
        }
      }}
      style={cardStyle}
      className={`${stateClass} overflow-hidden flex flex-col relative ${
        editMode
          ? isInlineEditing
            ? 'cursor-text'
            : 'cursor-grab active:cursor-grabbing'
          : entity.kind === 'note'
            ? 'cursor-default'
            : 'cursor-pointer'
      }`}
    >
      {entity.kind === 'item' ? (
        <ItemCardBody item={entity} editMode={editMode} openTarget={openTarget} />
      ) : entity.kind === 'folder' ? (
        <FolderCardBody
          folder={entity}
          items={folderItems}
          editMode={editMode}
          openTarget={openTarget}
          draggingChildId={draggingChildId}
          onChildPointerDown={onChildPointerDown}
          onOpenFolder={onOpenFolder}
          onCycleFolderMode={onCycleFolderMode}
          onOpenContextMenu={onOpenContextMenu}
        />
      ) : entity.kind === 'carousel' ? (
        <CarouselWidgetBody
          widget={entity}
          editMode={editMode}
          openTarget={openTarget}
          onEditWidget={(w) => onEditEntity(w)}
        />
      ) : (
        <NoteWidgetBody
          widget={entity}
          editMode={editMode}
          isInlineEditing={isInlineEditing}
          onRequestEditNote={(note) => onRequestEditNote?.(note)}
          onCommitInlineNote={onCommitInlineNote}
          onCancelInlineEdit={onCancelInlineEdit}
        />
      )}

      {/* Drop Into Folder Overlay */}
      {isFolderDropTarget && entity.kind === 'folder' && (
        <div className="pointer-events-none absolute inset-0 bg-[var(--accent-orange)]/12 flex items-center justify-center p-2 z-20">
          <span className="rounded-full bg-[var(--accent-orange)] text-white px-2.5 py-1 text-[11px] font-medium shadow max-w-full truncate">
            放入「{entity.title}」
          </span>
        </div>
      )}

      {/* 600ms Merge-Into-New-Folder Overlay */}
      {isMergeTarget && entity.kind === 'item' && (
        <div className="pointer-events-none absolute inset-0 bg-[var(--accent-orange)]/14 border-2 border-dashed border-[var(--accent-orange)] rounded-[inherit] flex items-center justify-center p-2 z-20 animate-pulse">
          <span className="rounded-full bg-[var(--accent-orange)] text-white px-2.5 py-1 text-[10px] font-semibold shadow text-center leading-tight">
            松手合并新建文件夹
          </span>
        </div>
      )}

      {/* Edit Mode Controls (hover/selected reveal on desktop to keep canvas clean) */}
      {editMode && !isInlineEditing && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditEntity(entity);
            }}
            className="edit-hover-control absolute top-2 right-2 z-20 h-6 w-6 rounded-full bg-[var(--bg-elevated)]/92 border border-[var(--border-hair)] flex items-center justify-center text-[var(--ink-secondary)] hover:text-[var(--ink-main)] hover:border-[var(--border-strong)] cursor-pointer shadow-xs"
            title="编辑属性"
          >
            <Pencil size={11} />
          </button>

          {/* Subtle small corner resize badge */}
          <button
            type="button"
            data-resize-handle={entity.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizePointerDown(e, entity);
            }}
            onClick={(e) => e.stopPropagation()}
            className={`edit-hover-control absolute bottom-1.5 right-1.5 z-20 h-4.5 w-4.5 rounded-md flex items-center justify-center transition-colors cursor-nwse-resize ${
              isError
                ? 'bg-[var(--accent-red)] text-white !opacity-100'
                : isResizing
                  ? 'bg-[var(--accent-orange)] text-white !opacity-100'
                  : 'bg-[var(--bg-subtle)]/85 text-[var(--ink-muted)] hover:bg-[var(--accent-orange)] hover:text-white border border-[var(--border-hair)]/80'
            }`}
            title="拖拽角标调整尺寸"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path
                d="M8.5 2.5L2.5 8.5M8.5 6L6 8.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
});

function ItemCardBody({
  item,
  editMode,
  openTarget,
}: {
  item: BookmarkItem;
  editMode: boolean;
  openTarget: '_blank' | '_self';
}) {
  const is1x1 = item.w === 1 && item.h === 1;
  const isWide1 = item.w >= 2 && item.h === 1;

  const iconBoxStyle: CSSProperties | undefined = item.accent
    ? {
        backgroundColor: `color-mix(in srgb, ${item.accent} 11%, var(--bg-subtle))`,
        borderColor: `color-mix(in srgb, ${item.accent} 24%, var(--border-hair))`,
      }
    : undefined;

  const content = is1x1 ? (
    <div className="h-full w-full p-3 flex flex-col justify-between">
      <div
        style={iconBoxStyle}
        className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0"
      >
        <IconGlyph
          icon={item.icon}
          faviconUrl={item.faviconUrl}
          title={item.title}
          accent={item.accent}
          size={18}
        />
      </div>
      <MarqueeText
        text={item.title}
        className={`text-xs font-medium leading-tight ${editMode ? 'pr-4' : ''}`}
      />
    </div>
  ) : isWide1 ? (
    <div className="h-full w-full px-3.5 py-3 flex items-center gap-3">
      <div
        style={iconBoxStyle}
        className="h-11 w-11 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0"
      >
        <IconGlyph
          icon={item.icon}
          faviconUrl={item.faviconUrl}
          title={item.title}
          accent={item.accent}
          size={20}
        />
      </div>
      <div className={`min-w-0 flex-1 ${editMode ? 'pr-5' : ''}`}>
        <MarqueeText text={item.title} className="text-sm font-semibold" />
        <div className="text-xs text-[var(--ink-muted)] truncate">
          {item.subtitle || getDomain(item.url)}
        </div>
      </div>
      {!editMode && (
        <ArrowUpRight size={14} className="text-[var(--ink-muted)] shrink-0 opacity-70" />
      )}
    </div>
  ) : (
    <div className="h-full w-full p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <div
          style={iconBoxStyle}
          className="h-12 w-12 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0"
        >
          <IconGlyph
            icon={item.icon}
            faviconUrl={item.faviconUrl}
            title={item.title}
            accent={item.accent}
            size={24}
          />
        </div>
        {!editMode && (
          <span className="h-7 w-7 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--ink-muted)]">
            <ArrowUpRight size={14} />
          </span>
        )}
      </div>

      <div className={`space-y-1.5 min-w-0 ${editMode ? 'pr-5' : ''}`}>
        <MarqueeText text={item.title} className="text-base font-semibold" />
        <div className="text-xs text-[var(--ink-muted)] truncate">
          {item.subtitle || getDomain(item.url)}
        </div>
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {item.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-subtle)] border border-[var(--border-hair)] text-[var(--ink-secondary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (editMode) {
    return <div className="h-full w-full">{content}</div>;
  }

  return (
    <a
      href={item.url}
      target={openTarget}
      rel={openTarget === '_blank' ? 'noopener noreferrer' : undefined}
      draggable={false}
      className="h-full w-full block hover:bg-[var(--bg-elevated)]/60 transition-colors"
    >
      {content}
    </a>
  );
}

function FolderCardBody({
  folder,
  items,
  editMode,
  openTarget,
  draggingChildId,
  onChildPointerDown,
  onOpenFolder,
  onCycleFolderMode,
  onOpenContextMenu,
}: {
  folder: FolderContainer;
  items: BookmarkItem[];
  editMode: boolean;
  openTarget: '_blank' | '_self';
  draggingChildId: string | null;
  onChildPointerDown: (
    e: ReactPointerEvent,
    folder: FolderContainer,
    item: BookmarkItem
  ) => void;
  onOpenFolder: (folder: FolderContainer) => void;
  onCycleFolderMode?: (folder: FolderContainer) => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
}) {
  const accentColor = folder.accent || (folder.isPrivate ? '#f59e0b' : 'var(--accent-orange)');
  const isCompactFolder = folder.w === 1 && folder.h === 1;

  const header = (
    <div
      data-marquee-host
      className={`group/hdr flex items-center justify-between gap-2 ${
        isCompactFolder ? 'px-3' : 'pl-[22px] pr-3'
      } pt-2.5 pb-1.5 shrink-0 transition-colors ${
        editMode ? '' : 'hover:bg-[var(--bg-subtle)]/55'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {(folder.accent || folder.isPrivate) && (
          <span
            className="w-1 h-[13px] rounded-full shrink-0 translate-y-[0.5px]"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <MarqueeText text={folder.title} className="text-[13px] leading-[18px] font-semibold tracking-tight" />
      </div>

      {editMode && onCycleFolderMode && (
        <div className="flex items-center shrink-0 pr-6">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCycleFolderMode(folder);
            }}
            className="edit-hover-control whitespace-nowrap shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-card)]/90 border border-[var(--border-hair)] text-[var(--ink-secondary)] hover:text-[var(--ink-main)] cursor-pointer"
            title="切换展现形式 (宫格/列表)"
          >
            {folder.displayMode === 'list' ? '列表' : '宫格'}
          </button>
        </div>
      )}
    </div>
  );

  if (folder.displayMode === 'list') {
    return (
      <div className="h-full w-full flex flex-col">
        {header}
        <div
          className={`bento-scroll flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 grid gap-0.5 content-start ${
            folder.w >= 4 ? 'grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {items.length === 0 ? (
            <div className="py-4 text-center text-[11px] text-[var(--ink-muted)]">空文件夹</div>
          ) : (
            items.map((child) => {
              const isGhost = draggingChildId === child.id;
              return (
                <a
                  key={child.id}
                  data-marquee-host
                  data-folder-child-id={child.id}
                  data-folder-id={folder.id}
                  href={editMode ? undefined : child.url}
                  target={editMode ? undefined : openTarget}
                  rel={editMode || openTarget !== '_blank' ? undefined : 'noopener noreferrer'}
                  draggable={false}
                  onPointerDown={(e) => {
                    if (editMode) {
                      onChildPointerDown(e, folder, child);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (!onOpenContextMenu) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenContextMenu(e, { kind: 'item', item: child, folder });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editMode) e.preventDefault();
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-xl hover:bg-[var(--bg-subtle)] transition-colors min-w-0 ${
                    isGhost ? 'opacity-30 border border-dashed border-[var(--accent-orange)]' : ''
                  } ${editMode ? 'cursor-grab' : ''}`}
                >
                  <div className="h-6 w-6 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
                    <IconGlyph
                      icon={child.icon}
                      faviconUrl={child.faviconUrl}
                      title={child.title}
                      accent={child.accent}
                      size={13}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <MarqueeText text={child.title} className="text-xs font-medium leading-tight" />
                  </div>
                </a>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Grid mode: child cards match external 1x1 Bento item card layout (top-left icon badge + bottom-left scrolling title)
  const cols = Math.max(1, folder.w);
  const rows = Math.max(1, folder.h);
  const capacity = cols * rows;
  const hasOverflow = items.length > capacity;
  const visibleChildren =
    hasOverflow && capacity > 1 ? items.slice(0, capacity - 1) : items.slice(0, capacity);
  const overflowCount = items.length - visibleChildren.length;

  return (
    <div className="h-full w-full flex flex-col">
      {header}
      <div
        className={`flex-1 min-h-0 overflow-hidden px-2.5 pb-2.5 grid ${
          isCompactFolder ? 'gap-1' : 'gap-2'
        }`}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {visibleChildren.map((child) => {
          const isGhost = draggingChildId === child.id;
          return (
            <a
              key={child.id}
              data-marquee-host
              data-folder-child-id={child.id}
              data-folder-id={folder.id}
              href={editMode ? undefined : child.url}
              target={editMode ? undefined : openTarget}
              rel={editMode || openTarget !== '_blank' ? undefined : 'noopener noreferrer'}
              draggable={false}
              onPointerDown={(e) => {
                if (editMode) {
                  onChildPointerDown(e, folder, child);
                }
              }}
              onContextMenu={(e) => {
                if (!onOpenContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onOpenContextMenu(e, { kind: 'item', item: child, folder });
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (editMode) e.preventDefault();
              }}
              className={`rounded-2xl bg-[var(--bg-subtle)]/65 hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] border border-[var(--border-hair)] ${
                isCompactFolder ? 'p-1.5' : 'p-2.5'
              } flex flex-col justify-between transition-colors min-w-0 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${
                isGhost ? 'opacity-30 border-dashed border-[var(--accent-orange)]' : ''
              } ${editMode ? 'cursor-grab' : ''}`}
              title={`${child.title} — ${child.url}`}
            >
              <div
                className={`${
                  isCompactFolder ? 'h-6 w-6 rounded-lg' : 'h-8 w-8 rounded-xl'
                } bg-[var(--bg-card)] border border-[var(--border-hair)] flex items-center justify-center shrink-0`}
              >
                <IconGlyph
                  icon={child.icon}
                  faviconUrl={child.faviconUrl}
                  title={child.title}
                  accent={child.accent}
                  size={isCompactFolder ? 13 : 16}
                />
              </div>
              <MarqueeText
                text={child.title}
                className="text-xs font-medium leading-tight w-full"
              />
            </a>
          );
        })}

        {hasOverflow && capacity > 1 && (
          <button
            type="button"
            onPointerDown={(e) => {
              if (editMode && e.pointerType === 'mouse') {
                e.stopPropagation();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolder(folder);
            }}
            className="rounded-2xl bg-[var(--bg-subtle)]/80 hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] border border-[var(--border-hair)] p-2.5 flex flex-col justify-between text-left cursor-pointer transition-colors overflow-hidden"
          >
            <div className="h-8 px-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)] inline-flex items-center justify-center self-start">
              <span
                className="text-xs font-semibold"
                style={{ color: accentColor }}
              >
                +{overflowCount}
              </span>
            </div>
            <span className="text-xs font-medium text-[var(--ink-secondary)] leading-tight truncate w-full">
              查看全部
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
