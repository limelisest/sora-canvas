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

interface ZoneCardProps {
  zone: ZoneContainer;
  grid: GridConfig;
  editMode: boolean;
  isSelected: boolean;
  isResizing: boolean;
  isError?: boolean;
  dragOffset?: { dxPx: number; dyPx: number } | null;
  onZonePointerDown: (e: ReactPointerEvent, zone: ZoneContainer) => void;
  onZoneResizePointerDown: (e: ReactPointerEvent, zone: ZoneContainer) => void;
  onEditZone: (zone: ZoneContainer) => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
}

export function ZoneCard({
  zone,
  grid,
  editMode,
  isSelected,
  isResizing,
  isError = false,
  dragOffset,
  onZonePointerDown,
  onZoneResizePointerDown,
  onEditZone,
  onOpenContextMenu,
}: ZoneCardProps) {
  const step = grid.cellSize + grid.gap;
  const left = zone.x * step;
  const top = zone.y * step;
  const width = zone.w * grid.cellSize + (zone.w - 1) * grid.gap;
  const height = zone.h * grid.cellSize + (zone.h - 1) * grid.gap;
  const isActivelyDragged = Boolean(dragOffset);

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

  const accent = zone.accent || (zone.isPrivate ? '#f97316' : '#64748b');
  const borderColor = isError
    ? 'var(--accent-red)'
    : isSelected || isResizing
      ? 'var(--accent-orange)'
      : zone.isPrivate
        ? 'color-mix(in srgb, #ff5500 52%, var(--border-strong))'
        : `color-mix(in srgb, ${accent} 36%, var(--border-strong))`;

  const fillBg = isError
    ? 'rgba(220, 38, 38, 0.08)'
    : zone.isPrivate
      ? 'color-mix(in srgb, #ff5500 6%, transparent)'
      : `color-mix(in srgb, ${accent} 5.5%, transparent)`;

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
        left,
        top,
        width,
        height,
        borderRadius: 28,
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
    >
      {/* Top-left floating/integrated section header pill */}
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
          borderColor: `color-mix(in srgb, ${accent} 28%, var(--border-hair))`,
        }}
        className={`absolute -top-3.5 left-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--bg-card)]/94 backdrop-blur-xs border shadow-xs max-w-[calc(100%-32px)] ${
          editMode ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : 'pointer-events-none'
        }`}
        title={
          editMode
            ? '拖动移动分区及内部卡片（按住 Alt 仅移动分区框）· 双击编辑属性'
            : zone.title
        }
      >
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: zone.isPrivate ? '#ff5500' : accent }}
        />
        {zone.isPrivate && <Lock size={11} className="text-amber-500 shrink-0" />}
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
            <Pencil size={10} />
          </button>
        )}
      </div>

      {/* Edit-mode border hit strips so users can grab or right-click any edge of the Zone */}
      {editMode && (
        <>
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEditZone(zone);
            }}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-0 left-3 right-3 h-2.5 cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute bottom-0 left-3 right-6 h-2.5 cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-3 bottom-3 left-0 w-2.5 cursor-grab active:cursor-grabbing"
          />
          <div
            onPointerDown={(e) => onZonePointerDown(e, zone)}
            onContextMenu={handleZoneContextMenu}
            className="pointer-events-auto absolute top-3 bottom-6 right-0 w-2.5 cursor-grab active:cursor-grabbing"
          />

          <button
            type="button"
            data-zone-resize-handle={zone.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onZoneResizePointerDown(e, zone);
            }}
            onClick={(e) => e.stopPropagation()}
            className={`pointer-events-auto absolute bottom-2 right-2 z-20 h-5 w-5 rounded-md flex items-center justify-center cursor-nwse-resize transition-colors ${
              isResizing
                ? 'bg-[var(--accent-orange)] text-white'
                : 'bg-[var(--bg-card)]/90 text-[var(--ink-muted)] hover:bg-[var(--accent-orange)] hover:text-white border border-[var(--border-hair)] shadow-xs'
            }`}
            title="拖拽角标调整分区范围（0.25 格步进）"
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
