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

export const ZONE_OUTSET_PX = 6;

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
    top: logicalTop - ZONE_OUTSET_PX,
    width: logicalW + ZONE_OUTSET_PX * 2,
    height: logicalH + ZONE_OUTSET_PX * 2,
    borderRadius: zone.w === 1 && zone.h === 1 ? 26 : 30,
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
  dragOffset,
}: ZoneCardProps) {
  const box = computeZoneBox(zone, grid);
  const isActivelyDragged = Boolean(dragOffset);
  const skipTransition = useSuppressDropTransition(isActivelyDragged);

  const borderColor = isError
    ? 'var(--accent-red)'
    : isSelected || isResizing
      ? 'var(--accent-orange)'
      : zone.isPrivate
        ? 'color-mix(in srgb, #ff5500 52%, var(--border-strong))'
        : `color-mix(in srgb, ${box.accent} 36%, var(--border-strong))`;

  const fillBg = isError
    ? 'rgba(220, 38, 38, 0.08)'
    : zone.isPrivate
      ? 'color-mix(in srgb, #ff5500 6%, transparent)'
      : `color-mix(in srgb, ${box.accent} 5.5%, transparent)`;

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
        border: `1.5px ${isSelected || zone.isPrivate ? 'solid' : 'dashed'} ${borderColor}`,
        transform: isActivelyDragged
          ? `translate3d(${dragOffset!.dxPx}px, ${dragOffset!.dyPx}px, 0)`
          : undefined,
        transition: skipTransition
          ? 'none'
          : 'left 160ms cubic-bezier(0.22, 1, 0.36, 1), top 160ms cubic-bezier(0.22, 1, 0.36, 1), width 120ms ease, height 120ms ease, border-color 150ms ease',
        willChange: isActivelyDragged ? 'transform' : undefined,
        zIndex: isActivelyDragged ? 34 : isSelected || isResizing ? 4 : 2,
      }}
      className="pointer-events-none select-none"
    />
  );
}

interface ZoneOverlayProps {
  zone: ZoneContainer;
  grid: GridConfig;
  editMode: boolean;
  isResizing: boolean;
  dragOffset?: { dxPx: number; dyPx: number } | null;
  onZonePointerDown: (e: ReactPointerEvent, zone: ZoneContainer) => void;
  onZoneResizePointerDown: (e: ReactPointerEvent, zone: ZoneContainer) => void;
  onEditZone: (zone: ZoneContainer) => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
}

/**
 * Top overlay layer of a ZoneContainer (zIndex 28 / 36 while dragging).
 * Hosts the top-centered floating title pill and edit-mode border hit-strips / resize handle.
 */
export function ZoneOverlay({
  zone,
  grid,
  editMode,
  isResizing,
  dragOffset,
  onZonePointerDown,
  onZoneResizePointerDown,
  onEditZone,
  onOpenContextMenu,
}: ZoneOverlayProps) {
  const box = computeZoneBox(zone, grid);
  const isActivelyDragged = Boolean(dragOffset);
  const skipTransition = useSuppressDropTransition(isActivelyDragged);

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
      {/* Top-centered floating title pill anchored across the top border, shifted inward */}
      <div
        onPointerDown={
          editMode
            ? (e) => {
                onZonePointerDown(e, zone);
              }
            : undefined
        }
        onDoubleClick={
          editMode
            ? (e) => {
                e.stopPropagation();
                onEditZone(zone);
              }
            : undefined
        }
        onContextMenu={editMode ? handleZoneContextMenu : undefined}
        style={{
          borderColor: `color-mix(in srgb, ${box.accent} 28%, var(--border-hair))`,
        }}
        className={`absolute -top-1.5 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-32px)] inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[13px] leading-tight font-semibold bg-[var(--bg-card)]/96 backdrop-blur-md border shadow-sm ${
          editMode
            ? 'pointer-events-auto cursor-grab active:cursor-grabbing'
            : 'pointer-events-none'
        }`}
        title={
          editMode
            ? '拖动移动分区及内部卡片（按住 Alt 仅移动分区框）· 双击编辑属性'
            : zone.title
        }
      >
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: zone.isPrivate ? '#ff5500' : box.accent }}
        />
        {zone.isPrivate && <Lock size={11.5} className="text-amber-500 shrink-0" />}
        <span className="truncate text-[var(--ink-main)]">{zone.title}</span>
        {editMode && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditZone(zone);
            }}
            className="ml-0.5 h-4.5 w-4.5 rounded-full inline-flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] cursor-pointer shrink-0"
            title="编辑分区框"
          >
            <Pencil size={11} />
          </button>
        )}
      </div>

      {/* Edit-mode 8px perimeter hit strips + bottom-right integer resize handle */}
      {editMode && (
        <>
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEditZone(zone);
            }}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-0 left-3 right-3 h-2 cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute bottom-0 left-3 right-7 h-2 cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-3 bottom-3 left-0 w-2 cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-3 bottom-7 right-0 w-2 cursor-grab active:cursor-grabbing"
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
            title="拖拽角标调整分区范围（整格步进）"
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
