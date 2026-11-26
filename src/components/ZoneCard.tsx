import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Lock, Pencil } from 'lucide-react';
import type { GridConfig, ZoneContainer } from '../../shared/types';
import type { ContextMenuTarget } from './CanvasCard';

export const ZONE_OUTSET_PX = 5;
export const ZONE_HEADER_PX = 28;

interface ZoneBox {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
  accent: string;
}

function computeZoneBox(zone: ZoneContainer, grid: GridConfig): ZoneBox {
  const step = grid.cellSize + grid.gap;
  const logicalLeft = zone.x * step;
  const logicalTop = zone.y * step;
  const logicalW = zone.w * grid.cellSize + (zone.w - 1) * grid.gap;
  const logicalH = zone.h * grid.cellSize + (zone.h - 1) * grid.gap;

  return {
    left: logicalLeft - ZONE_OUTSET_PX,
    top: logicalTop - ZONE_HEADER_PX,
    width: logicalW + ZONE_OUTSET_PX * 2,
    height: logicalH + ZONE_HEADER_PX + ZONE_OUTSET_PX,
    borderRadius: zone.w <= 1 && zone.h <= 1 ? 25 : 29,
    accent: zone.accent || (zone.isPrivate ? '#f97316' : '#64748b'),
  };
}

function useSuppressDropTransition(isActivelyDragged: boolean): boolean {
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

  return isActivelyDragged || suppressDropTransition || (prevDraggedRef.current && !isActivelyDragged);
}

interface ZoneCardProps {
  zone: ZoneContainer;
  grid: GridConfig;
  isSelected: boolean;
  isResizing: boolean;
  isError?: boolean;
  isNewlyCreated?: boolean;
  dragOffset?: { dxPx: number; dyPx: number } | null;
}

/**
 * Background layer of a ZoneContainer (zIndex 2..4 / 34 while dragging).
 * Strictly pointer-events-none so internal cards & canvas remain seamlessly interactive.
 */
export function ZoneCard({
  zone,
  grid,
  isSelected,
  isResizing,
  isError = false,
  isNewlyCreated = false,
  dragOffset,
}: ZoneCardProps) {
  const box = computeZoneBox(zone, grid);
  const isActivelyDragged = Boolean(dragOffset);
  const skipTransition = useSuppressDropTransition(isActivelyDragged);

  const fillBg = isError
    ? 'rgba(220, 38, 38, 0.08)'
    : zone.isPrivate
      ? 'color-mix(in srgb, #ff5500 9.5%, transparent)'
      : `color-mix(in srgb, ${box.accent} 9.5%, transparent)`;

  const borderStyle = isError
    ? '1.5px solid var(--accent-red)'
    : isSelected || isResizing
      ? '1.5px solid var(--accent-orange)'
      : zone.isPrivate
        ? '1px solid color-mix(in srgb, #ff5500 42%, var(--border-strong))'
        : `1px solid color-mix(in srgb, ${box.accent} 26%, var(--border-hair))`;

  return (
    <div
      data-zone-id={zone.id}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderRadius: box.borderRadius,
        backgroundColor: fillBg,
        border: borderStyle,
        boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.03)',
        transform: isActivelyDragged
          ? `translate3d(${dragOffset!.dxPx}px, ${dragOffset!.dyPx}px, 0)`
          : undefined,
        transition: skipTransition
          ? 'none'
          : 'left 160ms cubic-bezier(0.22, 1, 0.36, 1), top 160ms cubic-bezier(0.22, 1, 0.36, 1), width 120ms ease, height 120ms ease, border-color 150ms ease',
        willChange: isActivelyDragged ? 'transform' : undefined,
        zIndex: isActivelyDragged ? 34 : isSelected || isResizing ? 4 : 2,
      }}
      className={`pointer-events-none select-none ${isNewlyCreated ? 'newly-created-pulse' : ''}`}
    />
  );
}

interface ZoneOverlayProps {
  zone: ZoneContainer;
  grid: GridConfig;
  editMode: boolean;
  isResizing: boolean;
  isInlineEditing?: boolean;
  dragOffset?: { dxPx: number; dyPx: number } | null;
  onZonePointerDown: (e: ReactPointerEvent, zone: ZoneContainer) => void;
  onZoneResizePointerDown: (e: ReactPointerEvent, zone: ZoneContainer) => void;
  onEditZone: (zone: ZoneContainer) => void;
  onStartInlineEdit?: (zoneId: string) => void;
  onCommitInlineTitle?: (zone: ZoneContainer, nextTitle: string) => void;
  onCancelInlineEdit?: () => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
}

/**
 * Top overlay layer of a ZoneContainer (zIndex 28 / 36 while dragging).
 * Hosts the top 28px dedicated tray header bar and edit-mode border hit-strips / resize handle.
 */
export function ZoneOverlay({
  zone,
  grid,
  editMode,
  isResizing,
  isInlineEditing = false,
  dragOffset,
  onZonePointerDown,
  onZoneResizePointerDown,
  onEditZone,
  onStartInlineEdit,
  onCommitInlineTitle,
  onCancelInlineEdit,
  onOpenContextMenu,
}: ZoneOverlayProps) {
  const box = computeZoneBox(zone, grid);
  const isActivelyDragged = Boolean(dragOffset);
  const skipTransition = useSuppressDropTransition(isActivelyDragged);
  const [draftTitle, setDraftTitle] = useState(zone.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isInlineEditing) {
      setDraftTitle(zone.title);
      const raf = window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [isInlineEditing, zone.title]);

  const commitTitle = () => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      onCommitInlineTitle?.(zone, trimmed);
    } else {
      setDraftTitle(zone.title);
      onCancelInlineEdit?.();
    }
  };

  const handleZoneContextMenu = (e: ReactMouseEvent) => {
    if (!onOpenContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onOpenContextMenu(e, { kind: 'zone', zone });
  };

  return (
    <div
      data-zone-id={zone.id}
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderRadius: box.borderRadius,
        transform: isActivelyDragged
          ? `translate3d(${dragOffset!.dxPx}px, ${dragOffset!.dyPx}px, 0)`
          : undefined,
        transition: skipTransition
          ? 'none'
          : 'left 160ms cubic-bezier(0.22, 1, 0.36, 1), top 160ms cubic-bezier(0.22, 1, 0.36, 1), width 120ms ease, height 120ms ease',
        willChange: isActivelyDragged ? 'transform' : undefined,
        zIndex: isActivelyDragged ? 36 : 28,
      }}
      className="pointer-events-none select-none"
    >
      {/* Dedicated 28px tray header bar integrated into top zone area */}
      <div
        onPointerDown={
          editMode && !isInlineEditing
            ? (e) => {
                onZonePointerDown(e, zone);
              }
            : undefined
        }
        onDoubleClick={
          editMode && !isInlineEditing
            ? (e) => {
                e.stopPropagation();
                if (onStartInlineEdit) onStartInlineEdit(zone.id);
                else onEditZone(zone);
              }
            : undefined
        }
        onContextMenu={editMode ? handleZoneContextMenu : undefined}
        className={`absolute top-0 left-0 right-0 h-[28px] pl-[25px] pr-3.5 flex items-center justify-between gap-2 z-20 ${
          editMode
            ? `pointer-events-auto rounded-t-[28px] ${
                isInlineEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'
              }`
            : 'pointer-events-none'
        }`}
        title={
          editMode
            ? '拖动移动分区及内部卡片（按住 Alt 仅移动分区框）· 双击原地改名'
            : zone.title
        }
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className="h-2 w-2 rounded-full shrink-0 translate-y-[0.5px]"
            style={{ backgroundColor: zone.isPrivate ? '#ff5500' : box.accent }}
          />
          {zone.isPrivate && <Lock size={11} className="text-amber-500 shrink-0" />}
          {editMode && isInlineEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setDraftTitle(zone.title);
                  onCancelInlineEdit?.();
                }
              }}
              onBlur={commitTitle}
              className="w-full min-w-0 bg-[var(--bg-card)]/90 border border-[var(--accent-orange)] rounded-md px-1.5 py-0 text-[12px] leading-[18px] font-bold text-[var(--ink-main)] outline-none"
            />
          ) : (
            <span className="text-[12.5px] leading-[18px] font-bold tracking-wide text-[var(--ink-main)] truncate">
              {zone.title}
            </span>
          )}
        </div>
        {editMode && !isInlineEditing && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditZone(zone);
            }}
            className="h-4.5 w-4.5 rounded-full inline-flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] cursor-pointer shrink-0"
            title="编辑分区框详情"
          >
            <Pencil size={11} />
          </button>
        )}
      </div>

      {/* Edit-mode 6px left/right/bottom perimeter hit strips + bottom-right integer resize handle */}
      {editMode && (
        <>
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute bottom-0 left-3 right-7 h-[6px] cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-7 bottom-3 left-0 w-[6px] cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-7 bottom-7 right-0 w-[6px] cursor-grab active:cursor-grabbing"
          />

          <button
            type="button"
            data-zone-resize-handle={zone.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onZoneResizePointerDown(e, zone);
            }}
            onClick={(e) => e.stopPropagation()}
            className={`pointer-events-auto absolute bottom-1 right-1 z-20 h-5 w-5 rounded-md flex items-center justify-center cursor-nwse-resize transition-colors ${
              isResizing
                ? 'bg-[var(--accent-orange)] text-white'
                : 'bg-[var(--bg-card)]/96 text-[var(--ink-muted)] hover:bg-[var(--accent-orange)] hover:text-white border border-[var(--border-hair)] shadow-sm'
            }`}
            title="拖拽角标调整分区范围（1/4 格步进）"
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
}
