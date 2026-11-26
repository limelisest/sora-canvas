import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Crosshair } from 'lucide-react';
import type {
  BookmarkItem,
  CanvasGridEntity,
  CanvasWidget,
  FolderContainer,
  FreeTextWidget,
  GridConfig,
  NoteWidget,
  SiteSettings,
  ZoneContainer,
} from '../../shared/types';
import {
  clampGridSize,
  clampZoneSize,
  isEntityInsideZone,
  rectsOverlap,
  snapQuarter,
  solveMove,
  solveMoveZoneGroup,
  solvePlaceExternalItem,
  solveResize,
} from '../../shared/gridEngine';
import { MAX_VIEW_SCALE, MIN_VIEW_SCALE } from '../utils/viewport';
import { useStagedWallpaper } from '../utils/loadTracker';
import { CanvasCard, type ContextMenuTarget } from './CanvasCard';
import { IconGlyph } from './IconGlyph';
import { FreeTextCard } from './WidgetCard';
import { ZoneCard, ZoneOverlay } from './ZoneCard';

export interface InfiniteCanvasHandle {
  startModalChildPointerDown: (
    e: ReactPointerEvent,
    folder: FolderContainer,
    item: BookmarkItem,
    modalRect: DOMRect | null
  ) => void;
}

interface InfiniteCanvasProps {
  entities: CanvasGridEntity[];
  folders: FolderContainer[];
  items: BookmarkItem[];
  zones: ZoneContainer[];
  widgets: CanvasWidget[];
  grid: GridConfig;
  settings: SiteSettings;
  editMode: boolean;
  marqueeMode: boolean;
  selectedIds: string[];
  scale: number;
  panX: number;
  panY: number;
  viewportOrigin: { x: number; y: number };
  onViewportChange: (next: { scale: number; panX: number; panY: number }) => void;
  onUpdateViewportOrigin: (origin: { x: number; y: number }) => void;
  onSelectIds: (ids: string[]) => void;
  onCommitLayout: (nextEntities: CanvasGridEntity[]) => void;
  onCommitZones: (nextZones: ZoneContainer[]) => void;
  onCommitZoneGroup: (
    nextZone: ZoneContainer,
    nextEntities: CanvasGridEntity[],
    nextTextWidgets: FreeTextWidget[]
  ) => void;
  onCommitTextWidgets: (nextTextWidgets: FreeTextWidget[]) => void;
  onMoveItemsToFolder: (itemIds: string[], folderId: string) => void;
  onMergeItemsToFolder: (sourceItemId: string, targetItemId: string) => void;
  onDropChildToCanvas: (
    itemId: string,
    x: number,
    y: number,
    nextEntities: CanvasGridEntity[]
  ) => void;
  onReorderFolderItems: (folderId: string, itemIds: string[]) => void;
  onPreviewReorderChange: (preview: { folderId: string; itemIds: string[] } | null) => void;
  onModalHiddenForDragChange: (hidden: boolean) => void;
  onDraggingChildIdChange: (itemId: string | null) => void;
  onCloseFolderModal: () => void;
  onOpenFolder: (folder: FolderContainer) => void;
  onEditEntity: (entity: CanvasGridEntity) => void;
  onEditZone: (zone: ZoneContainer) => void;
  onEditWidget: (widget: CanvasWidget) => void;
  onRequestEditNote: (note: NoteWidget) => void;
  onCycleFolderMode: (folder: FolderContainer) => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
  flyTransition?: boolean;
  newlyCreatedId?: string | null;
  inlineEditingId?: string | null;
  onStartInlineEdit?: (id: string) => void;
  onCommitInlineZoneTitle?: (zone: ZoneContainer, nextTitle: string) => void;
  onStartInlineNoteEdit?: (note: NoteWidget) => void;
  onCommitInlineNote?: (note: NoteWidget, title: string, content: string) => void;
  onCommitInlineText?: (widget: FreeTextWidget, nextText: string) => void;
  onCancelInlineEdit?: () => void;
  onStatusToast: (msg: string, tone?: 'error' | 'info') => void;
}

interface MarqueeBox {
  startX: number;
  startY: number;
  currX: number;
  currY: number;
}

interface ResizeState {
  entityId: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  targetW: number;
  targetH: number;
  previewEntities: CanvasGridEntity[] | null;
  pushedIds: Set<string>;
  errorMsg: string | null;
}

interface DragState {
  movingIds: string[];
  allItemsOnly: boolean;
  singleItemId: string | null;
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  started: boolean;
  lifted: boolean;
  dx: number;
  dy: number;
  previewEntities: CanvasGridEntity[] | null;
  swappedIds: Set<string>;
  dropFolderId: string | null;
  errorMsg: string | null;
}

interface ChildDragState {
  source: 'canvas-folder' | 'modal';
  sourceFolder: FolderContainer;
  item: BookmarkItem;
  modalRect: DOMRect | null;
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  started: boolean;
  lifted: boolean;
  exitedSource: boolean;
  reorderedIds: string[] | null;
  targetFolderId: string | null;
  targetGrid: { x: number; y: number } | null;
  previewEntities: CanvasGridEntity[] | null;
  pushedIds: Set<string>;
  errorMsg: string | null;
}

interface ZoneDragState {
  zone: ZoneContainer;
  altOnly: boolean;
  movingForegroundIds: string[];
  movingTextIds: string[];
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  started: boolean;
  rawDx: number;
  rawDy: number;
  dx: number;
  dy: number;
  previewEntities: CanvasGridEntity[] | null;
  errorMsg: string | null;
}

interface ZoneResizeState {
  zoneId: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  targetW: number;
  targetH: number;
}

interface TextDragState {
  widget: FreeTextWidget;
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  started: boolean;
  dx: number;
  dy: number;
}

interface TextResizeState {
  widgetId: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  targetW: number;
  targetH: number;
}

type PendingTouch =
  | {
      kind: 'entity';
      entity: CanvasGridEntity;
      selectedIdsForDrag: string[];
      pointerId: number;
      startX: number;
      startY: number;
      timerId: number;
    }
  | {
      kind: 'child';
      source: 'canvas-folder' | 'modal';
      folder: FolderContainer;
      item: BookmarkItem;
      modalRect: DOMRect | null;
      pointerId: number;
      startX: number;
      startY: number;
      timerId: number;
    };

const TOUCH_CANCEL_MOVE_PX = 10;
const HOVER_MERGE_DRIFT_PX = 8;

export const InfiniteCanvas = forwardRef<InfiniteCanvasHandle, InfiniteCanvasProps>(
  function InfiniteCanvas(
    {
      entities,
      folders,
      items,
      zones,
      widgets,
      grid,
      settings,
      editMode,
      marqueeMode,
      selectedIds,
      scale,
      panX,
      panY,
      viewportOrigin,
      onViewportChange,
      onUpdateViewportOrigin,
      onSelectIds,
      onCommitLayout,
      onCommitZones,
      onCommitZoneGroup,
      onCommitTextWidgets,
      onMoveItemsToFolder,
      onMergeItemsToFolder,
      onDropChildToCanvas,
      onReorderFolderItems,
      onPreviewReorderChange,
      onModalHiddenForDragChange,
      onDraggingChildIdChange,
      onCloseFolderModal,
      onOpenFolder,
      onEditEntity,
      onEditZone,
      onEditWidget,
      onRequestEditNote,
      onCycleFolderMode,
      onOpenContextMenu,
      flyTransition = false,
      newlyCreatedId = null,
      inlineEditingId = null,
      onStartInlineEdit,
      onCommitInlineZoneTitle,
      onStartInlineNoteEdit,
      onCommitInlineNote,
      onCommitInlineText,
      onCancelInlineEdit,
      onStatusToast,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const worldLayerRef = useRef<HTMLDivElement>(null);
    const dotLayerRef = useRef<HTMLDivElement>(null);
    const rafViewportRef = useRef<number | null>(null);
    const wheelSyncTimerRef = useRef<number | null>(null);
    const lastDotStepRef = useRef<number>(0);
    const containerRectRef = useRef<{ left: number; top: number } | null>(null);
    const childGhostRef = useRef<HTMLDivElement>(null);
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinchRef = useRef<{
      active: boolean;
      startDist: number;
      startMidX: number;
      startMidY: number;
      startScale: number;
      startPanX: number;
      startPanY: number;
    } | null>(null);
    const panRef = useRef<{
      active: boolean;
      moved: boolean;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
    }>({
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
    });
    const suppressClickRef = useRef(false);

    const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
    const [resizeState, setResizeState] = useState<ResizeState | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [childDrag, setChildDrag] = useState<ChildDragState | null>(null);
    const [zoneDrag, setZoneDrag] = useState<ZoneDragState | null>(null);
    const [zoneResize, setZoneResize] = useState<ZoneResizeState | null>(null);
    const [textDrag, setTextDrag] = useState<TextDragState | null>(null);
    const [textResize, setTextResize] = useState<TextResizeState | null>(null);
    const [originDrag, setOriginDrag] = useState<{
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      currX: number;
      currY: number;
      moved: boolean;
    } | null>(null);
    const [mergeReadyTargetId, setMergeReadyTargetId] = useState<string | null>(null);
    const [pendingTouchActive, setPendingTouchActive] = useState(false);
    const [spacePressed, setSpacePressed] = useState(false);
    const spacePressedRef = useRef(false);

    useEffect(() => {
      function onKeyDown(e: KeyboardEvent) {
        if (e.code !== 'Space' || e.repeat) return;
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        spacePressedRef.current = true;
        setSpacePressed(true);
      }
      function onKeyUp(e: KeyboardEvent) {
        if (e.code !== 'Space') return;
        spacePressedRef.current = false;
        setSpacePressed(false);
      }
      function onBlur() {
        spacePressedRef.current = false;
        setSpacePressed(false);
      }
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      };
    }, []);

    const pendingTouchRef = useRef<PendingTouch | null>(null);
    const dragStateRef = useRef<DragState | null>(null);
    dragStateRef.current = dragState;
    const childDragRef = useRef<ChildDragState | null>(null);
    childDragRef.current = childDrag;
    const mergeReadyRef = useRef<string | null>(null);
    mergeReadyRef.current = mergeReadyTargetId;

    const hoverMergeRef = useRef<{
      targetId: string | null;
      anchorX: number;
      anchorY: number;
      timerId: number | null;
    }>({ targetId: null, anchorX: 0, anchorY: 0, timerId: null });

    const step = grid.cellSize + grid.gap;
    const viewRef = useRef({ scale, panX, panY });
    viewRef.current = { scale, panX, panY };

    const applyViewportDom = useCallback(
      (next: { scale: number; panX: number; panY: number }, active = true) => {
        const px = Math.round(next.panX);
        const py = Math.round(next.panY);
        if (worldLayerRef.current) {
          if (active) {
            worldLayerRef.current.style.willChange = 'transform';
            worldLayerRef.current.style.transform = `translate3d(${px}px, ${py}px, 0) scale(${next.scale})`;
          } else {
            worldLayerRef.current.style.willChange = 'auto';
            worldLayerRef.current.style.transform = `translate(${px}px, ${py}px) scale(${next.scale})`;
          }
        }
        if (dotLayerRef.current) {
          const ds = Math.max(14, (step / 4) * next.scale);
          const ox = ((px % ds) + ds) % ds;
          const oy = ((py % ds) + ds) % ds;
          dotLayerRef.current.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
          if (Math.abs(ds - lastDotStepRef.current) > 0.05) {
            lastDotStepRef.current = ds;
            dotLayerRef.current.style.backgroundSize = `${ds}px ${ds}px`;
          }
        }
      },
      [step]
    );

    const scheduleDomViewportUpdate = useCallback(() => {
      if (rafViewportRef.current !== null) return;
      rafViewportRef.current = window.requestAnimationFrame(() => {
        rafViewportRef.current = null;
        applyViewportDom(viewRef.current, true);
      });
    }, [applyViewportDom]);

    const scheduleViewportStateSync = useCallback(
      (delayMs = 80) => {
        if (wheelSyncTimerRef.current !== null) {
          window.clearTimeout(wheelSyncTimerRef.current);
        }
        wheelSyncTimerRef.current = window.setTimeout(() => {
          wheelSyncTimerRef.current = null;
          const settled = {
            scale: viewRef.current.scale,
            panX: Math.round(viewRef.current.panX),
            panY: Math.round(viewRef.current.panY),
          };
          viewRef.current = settled;
          applyViewportDom(settled, false);
          onViewportChange(settled);
        }, delayMs);
      },
      [applyViewportDom, onViewportChange]
    );

    useEffect(() => {
      return () => {
        if (rafViewportRef.current !== null) {
          window.cancelAnimationFrame(rafViewportRef.current);
        }
        if (wheelSyncTimerRef.current !== null) {
          window.clearTimeout(wheelSyncTimerRef.current);
        }
      };
    }, []);

    const clearHoverMerge = useCallback(() => {
      if (hoverMergeRef.current.timerId !== null) {
        window.clearTimeout(hoverMergeRef.current.timerId);
      }
      hoverMergeRef.current = { targetId: null, anchorX: 0, anchorY: 0, timerId: null };
      mergeReadyRef.current = null;
      setMergeReadyTargetId(null);
    }, []);

    const syncHoverMerge = useCallback(
      (candidateId: string | null, clientX: number, clientY: number) => {
        if (!settings.hoverMergeEnabled || !candidateId) {
          if (hoverMergeRef.current.targetId !== null) {
            clearHoverMerge();
          }
          return;
        }
        const cur = hoverMergeRef.current;
        const movedTooMuch = Math.hypot(clientX - cur.anchorX, clientY - cur.anchorY) > HOVER_MERGE_DRIFT_PX;
        if (cur.targetId === candidateId && !movedTooMuch) {
          return;
        }
        if (cur.timerId !== null) {
          window.clearTimeout(cur.timerId);
        }
        mergeReadyRef.current = null;
        setMergeReadyTargetId(null);

        const timerId = window.setTimeout(() => {
          if (hoverMergeRef.current.targetId === candidateId) {
            mergeReadyRef.current = candidateId;
            setMergeReadyTargetId(candidateId);
            setDragState((prev) =>
              prev
                ? {
                    ...prev,
                    previewEntities: null,
                    swappedIds: new Set(),
                    dropFolderId: null,
                    errorMsg: null,
                  }
                : null
            );
            setChildDrag((prev) =>
              prev
                ? {
                    ...prev,
                    previewEntities: null,
                    pushedIds: new Set(),
                    targetGrid: null,
                    errorMsg: null,
                  }
                : null
            );
            navigator.vibrate?.(12);
          }
        }, settings.hoverMergeMs);

        hoverMergeRef.current = {
          targetId: candidateId,
          anchorX: clientX,
          anchorY: clientY,
          timerId,
        };
      },
      [clearHoverMerge, settings.hoverMergeEnabled, settings.hoverMergeMs]
    );

    const cancelTouchLongPress = useCallback(() => {
      if (pendingTouchRef.current) {
        window.clearTimeout(pendingTouchRef.current.timerId);
        pendingTouchRef.current = null;
        setPendingTouchActive(false);
      }
    }, []);

    useEffect(() => {
      return () => {
        clearHoverMerge();
        cancelTouchLongPress();
      };
    }, [clearHoverMerge, cancelTouchLongPress]);

    const cacheContainerRect = useCallback(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        containerRectRef.current = { left: rect.left, top: rect.top };
      }
    }, []);

    const screenToWorld = useCallback((clientX: number, clientY: number) => {
      const rect = containerRectRef.current ?? containerRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      const { scale: s, panX: px, panY: py } = viewRef.current;
      return {
        sx,
        sy,
        wx: (sx - px) / s,
        wy: (sy - py) / s,
      };
    }, []);

    const isInsideInner60 = useCallback(
      (
        wx: number,
        wy: number,
        entity: { x: number; y: number; w: number; h: number },
        marginRatio = 0.2
      ) => {
        const left = entity.x * step;
        const top = entity.y * step;
        const wPx = entity.w * grid.cellSize + (entity.w - 1) * grid.gap;
        const hPx = entity.h * grid.cellSize + (entity.h - 1) * grid.gap;
        return (
          wx >= left + wPx * marginRatio &&
          wx <= left + wPx * (1 - marginRatio) &&
          wy >= top + hPx * marginRatio &&
          wy <= top + hPx * (1 - marginRatio)
        );
      },
      [step, grid.cellSize, grid.gap]
    );

    const findInner60Folder = useCallback(
      (wx: number, wy: number): FolderContainer | null => {
        for (const f of folders) {
          if (isInsideInner60(wx, wy, f, 0.12)) return f;
        }
        return null;
      },
      [folders, isInsideInner60]
    );

    const findInner60TopItem = useCallback(
      (wx: number, wy: number, excludeIds: Set<string>): BookmarkItem | null => {
        for (const it of items) {
          if (it.parentId !== null || excludeIds.has(it.id)) continue;
          if (isInsideInner60(wx, wy, it)) return it;
        }
        return null;
      },
      [items, isInsideInner60]
    );

    const getFolderChildIds = useCallback(
      (folderId: string, override?: string[] | null): string[] => {
        if (override) return override;
        return items
          .filter((i) => i.parentId === folderId)
          .sort((a, b) => a.order - b.order)
          .map((i) => i.id);
      },
      [items]
    );

    const beginChildTouchOrMouse = useCallback(
      (
        e: ReactPointerEvent,
        source: 'canvas-folder' | 'modal',
        folder: FolderContainer,
        item: BookmarkItem,
        modalRect: DOMRect | null
      ) => {
        if (!editMode) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        cacheContainerRect();

        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
          cancelTouchLongPress();
          const startX = e.clientX;
          const startY = e.clientY;
          const pointerId = e.pointerId;
          const timerId = window.setTimeout(() => {
            pendingTouchRef.current = null;
            setPendingTouchActive(false);
            panRef.current.active = false;
            panRef.current.moved = false;
            navigator.vibrate?.(15);
            onDraggingChildIdChange(item.id);
            setChildDrag({
              source,
              sourceFolder: folder,
              item,
              modalRect,
              startX,
              startY,
              currX: startX,
              currY: startY,
              started: true,
              lifted: true,
              exitedSource: false,
              reorderedIds: null,
              targetFolderId: null,
              targetGrid: null,
              previewEntities: null,
              pushedIds: new Set(),
              errorMsg: null,
            });
          }, settings.touchLongPressMs);

          pendingTouchRef.current = {
            kind: 'child',
            source,
            folder,
            item,
            modalRect,
            pointerId,
            startX,
            startY,
            timerId,
          };
          setPendingTouchActive(true);
          return;
        }

        e.stopPropagation();
        setChildDrag({
          source,
          sourceFolder: folder,
          item,
          modalRect,
          startX: e.clientX,
          startY: e.clientY,
          currX: e.clientX,
          currY: e.clientY,
          started: false,
          lifted: false,
          exitedSource: false,
          reorderedIds: null,
          targetFolderId: null,
          targetGrid: null,
          previewEntities: null,
          pushedIds: new Set(),
          errorMsg: null,
        });
      },
      [
        editMode,
        cacheContainerRect,
        cancelTouchLongPress,
        onDraggingChildIdChange,
        settings.touchLongPressMs,
      ]
    );

    useImperativeHandle(
      ref,
      () => ({
        startModalChildPointerDown: (e, folder, item, modalRect) => {
          beginChildTouchOrMouse(e, 'modal', folder, item, modalRect);
        },
      }),
      [beginChildTouchOrMouse]
    );

    // Non-passive wheel zoom + Safari gesture prevention
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      function handleWheel(e: WheelEvent) {
        if (!e.ctrlKey && !e.metaKey) {
          let cur = e.target as HTMLElement | null;
          while (cur && cur !== el) {
            if (cur.classList.contains('bento-scroll') && cur.scrollHeight > cur.clientHeight) {
              return;
            }
            cur = cur.parentElement;
          }
        }

        e.preventDefault();

        // Pan mode: wheel pans canvas unless Ctrl/Cmd is held (which always zooms)
        if (settings.wheelMode === 'pan' && !e.ctrlKey && !e.metaKey) {
          const curView = viewRef.current;
          const nextView = {
            scale: curView.scale,
            panX: curView.panX - e.deltaX,
            panY: curView.panY - e.deltaY,
          };
          viewRef.current = nextView;
          scheduleDomViewportUpdate();
          scheduleViewportStateSync(120);
          return;
        }

        const rect = el!.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        const { scale: s, panX: px, panY: py } = viewRef.current;
        const worldX = (cx - px) / s;
        const worldY = (cy - py) / s;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nextScale = Math.max(MIN_VIEW_SCALE, Math.min(MAX_VIEW_SCALE, s * factor));

        const nextView = {
          scale: nextScale,
          panX: cx - worldX * nextScale,
          panY: cy - worldY * nextScale,
        };
        viewRef.current = nextView;
        scheduleDomViewportUpdate();
        scheduleViewportStateSync(70);
      }

      function preventGesture(e: Event) {
        e.preventDefault();
      }

      el.addEventListener('wheel', handleWheel, { passive: false });
      el.addEventListener('gesturestart', preventGesture, { passive: false });
      el.addEventListener('gesturechange', preventGesture, { passive: false });
      el.addEventListener('gestureend', preventGesture, { passive: false });
      return () => {
        el.removeEventListener('wheel', handleWheel);
        el.removeEventListener('gesturestart', preventGesture);
        el.removeEventListener('gesturechange', preventGesture);
        el.removeEventListener('gestureend', preventGesture);
      };
    }, [scheduleDomViewportUpdate, scheduleViewportStateSync, settings.wheelMode]);

    // Global window pointer listeners for pending touch long-press & child drags (including out of FolderModal)
    useEffect(() => {
      if (!pendingTouchActive && !childDrag) return;

      function handleWindowMove(e: PointerEvent) {
        const pending = pendingTouchRef.current;
        if (pending && e.pointerId === pending.pointerId) {
          if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > TOUCH_CANCEL_MOVE_PX) {
            cancelTouchLongPress();
          }
          return;
        }

        const cd = childDragRef.current;
        if (!cd) return;

        const dist = Math.hypot(e.clientX - cd.startX, e.clientY - cd.startY);
        const started = cd.started || dist > 5;
        if (!started) return;

        if (!cd.started) {
          onDraggingChildIdChange(cd.item.id);
        }

        cd.currX = e.clientX;
        cd.currY = e.clientY;

        const dropW =
          settings.dragOutItemSizeMode === 'preserve' ? clampGridSize(cd.item.w) : 1;
        const dropH =
          settings.dragOutItemSizeMode === 'preserve' ? clampGridSize(cd.item.h) : 1;
        const viewScale = viewRef.current.scale;
        const ghostW = (dropW * grid.cellSize + (dropW - 1) * grid.gap) * viewScale;
        const ghostH = (dropH * grid.cellSize + (dropH - 1) * grid.gap) * viewScale;

        if (cd.exitedSource && childGhostRef.current) {
          childGhostRef.current.style.transform = `translate3d(${e.clientX - ghostW / 2}px, ${e.clientY - ghostH / 2}px, 0) scale(1.05)`;
        }

        const { wx, wy } = screenToWorld(e.clientX, e.clientY);

        // Check whether pointer is still inside source container / modal
        let stillInsideSource = false;
        if (!cd.exitedSource) {
          if (cd.source === 'modal' && cd.modalRect) {
            stillInsideSource =
              e.clientX >= cd.modalRect.left &&
              e.clientX <= cd.modalRect.right &&
              e.clientY >= cd.modalRect.top &&
              e.clientY <= cd.modalRect.bottom;
          } else if (cd.source === 'canvas-folder') {
            const fLeft = cd.sourceFolder.x * step;
            const fTop = cd.sourceFolder.y * step;
            const fW = cd.sourceFolder.w * grid.cellSize + (cd.sourceFolder.w - 1) * grid.gap;
            const fH = cd.sourceFolder.h * grid.cellSize + (cd.sourceFolder.h - 1) * grid.gap;
            const exitBuf = 24;
            stillInsideSource =
              wx >= fLeft - exitBuf &&
              wx <= fLeft + fW + exitBuf &&
              wy >= fTop - exitBuf &&
              wy <= fTop + fH + exitBuf;
          }
        }

        if (stillInsideSource) {
          const attr = cd.source === 'modal' ? 'data-modal-child-id' : 'data-folder-child-id';
          const els = document.elementsFromPoint(e.clientX, e.clientY);
          let hoveredChildId: string | null = null;
          for (const el of els) {
            const cid = el.getAttribute(attr);
            if (cid && cid !== cd.item.id) {
              hoveredChildId = cid;
              break;
            }
          }

          let nextReordered = cd.reorderedIds;
          if (hoveredChildId) {
            const ids = [...getFolderChildIds(cd.sourceFolder.id, cd.reorderedIds)];
            const fromIdx = ids.indexOf(cd.item.id);
            const toIdx = ids.indexOf(hoveredChildId);
            if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
              ids.splice(fromIdx, 1);
              ids.splice(toIdx, 0, cd.item.id);
              nextReordered = ids;
              onPreviewReorderChange({ folderId: cd.sourceFolder.id, itemIds: ids });
            }
          }

          if (!cd.started || nextReordered !== cd.reorderedIds) {
            setChildDrag({
              ...cd,
              currX: e.clientX,
              currY: e.clientY,
              started: true,
              lifted: true,
              reorderedIds: nextReordered,
            });
          }
          return;
        }

        // Exited source folder / modal!
        if (!cd.exitedSource && cd.source === 'modal') {
          onModalHiddenForDragChange(true);
        }

        // 1. Check inner 60% of any folder
        const targetFolder = findInner60Folder(wx, wy);
        if (targetFolder) {
          clearHoverMerge();
          if (cd.started && cd.exitedSource && cd.targetFolderId === targetFolder.id) {
            return;
          }
          setChildDrag({
            ...cd,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            lifted: true,
            exitedSource: true,
            targetFolderId: targetFolder.id,
            targetGrid: null,
            previewEntities: null,
            pushedIds: new Set(),
            errorMsg: null,
          });
          return;
        }

        // 2. Check hover-hold merge onto top-level BookmarkItem
        const hoverItem = settings.hoverMergeEnabled
          ? findInner60TopItem(wx, wy, new Set([cd.item.id]))
          : null;
        if (hoverItem) {
          syncHoverMerge(hoverItem.id, e.clientX, e.clientY);
          if (mergeReadyRef.current === hoverItem.id) {
            if (
              cd.started &&
              cd.exitedSource &&
              cd.targetFolderId === null &&
              cd.targetGrid === null &&
              cd.previewEntities === null &&
              cd.errorMsg === null
            ) {
              return;
            }
            setChildDrag({
              ...cd,
              currX: e.clientX,
              currY: e.clientY,
              started: true,
              lifted: true,
              exitedSource: true,
              targetFolderId: null,
              targetGrid: null,
              previewEntities: null,
              pushedIds: new Set(),
              errorMsg: null,
            });
            return;
          }
        } else {
          clearHoverMerge();
        }

        // 3. Evaluate placement on canvas grid via solvePlaceExternalItem (0.25-grid deduplicated)
        const gx = snapQuarter((wx - (dropW * grid.cellSize + (dropW - 1) * grid.gap) / 2) / step);
        const gy = snapQuarter((wy - (dropH * grid.cellSize + (dropH - 1) * grid.gap) / 2) / step);
        if (
          cd.started &&
          cd.exitedSource &&
          cd.targetFolderId === null &&
          !hoverItem &&
          cd.targetGrid?.x === gx &&
          cd.targetGrid?.y === gy
        ) {
          return;
        }

        const placed = solvePlaceExternalItem(entities, {
          ...cd.item,
          kind: 'item',
          parentId: null,
          x: gx,
          y: gy,
          w: dropW,
          h: dropH,
        });

        if (placed.ok) {
          setChildDrag({
            ...cd,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            lifted: true,
            exitedSource: true,
            targetFolderId: null,
            targetGrid: { x: gx, y: gy },
            previewEntities: placed.entities,
            pushedIds: new Set(placed.movedIds),
            errorMsg: null,
          });
        } else {
          setChildDrag({
            ...cd,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            lifted: true,
            exitedSource: true,
            targetFolderId: null,
            targetGrid: { x: gx, y: gy },
            previewEntities: null,
            pushedIds: new Set(),
            errorMsg: placed.message,
          });
        }
      }

      function handleWindowUp(e: PointerEvent) {
        containerRectRef.current = null;
        const pending = pendingTouchRef.current;
        if (pending && e.pointerId === pending.pointerId) {
          cancelTouchLongPress();
        }

        const cd = childDragRef.current;
        if (!cd) return;

        const readyMergeId = mergeReadyRef.current;
        clearHoverMerge();

        if (!cd.started) {
          onDraggingChildIdChange(null);
          onPreviewReorderChange(null);
          setChildDrag(null);
          return;
        }

        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);

        if (!cd.exitedSource) {
          if (cd.reorderedIds) {
            onReorderFolderItems(cd.sourceFolder.id, cd.reorderedIds);
          }
          onPreviewReorderChange(null);
          onDraggingChildIdChange(null);
          onModalHiddenForDragChange(false);
          setChildDrag(null);
          return;
        }

        if (cd.targetFolderId) {
          if (cd.targetFolderId !== cd.sourceFolder.id) {
            onMoveItemsToFolder([cd.item.id], cd.targetFolderId);
          }
          onPreviewReorderChange(null);
          onDraggingChildIdChange(null);
          if (cd.source === 'modal') {
            onModalHiddenForDragChange(false);
            onCloseFolderModal();
          }
          setChildDrag(null);
          return;
        }

        if (readyMergeId) {
          onMergeItemsToFolder(cd.item.id, readyMergeId);
          onPreviewReorderChange(null);
          onDraggingChildIdChange(null);
          if (cd.source === 'modal') {
            onModalHiddenForDragChange(false);
            onCloseFolderModal();
          }
          setChildDrag(null);
          return;
        }

        if (cd.errorMsg || !cd.previewEntities || !cd.targetGrid) {
          onStatusToast(cd.errorMsg || '无法放置到该位置', 'error');
          onPreviewReorderChange(null);
          onDraggingChildIdChange(null);
          if (cd.source === 'modal') {
            onModalHiddenForDragChange(false);
          }
          setChildDrag(null);
          return;
        }

        onDropChildToCanvas(cd.item.id, cd.targetGrid.x, cd.targetGrid.y, cd.previewEntities);
        onPreviewReorderChange(null);
        onDraggingChildIdChange(null);
        if (cd.source === 'modal') {
          onModalHiddenForDragChange(false);
          onCloseFolderModal();
        }
        setChildDrag(null);
      }

      window.addEventListener('pointermove', handleWindowMove);
      window.addEventListener('pointerup', handleWindowUp);
      window.addEventListener('pointercancel', handleWindowUp);
      return () => {
        window.removeEventListener('pointermove', handleWindowMove);
        window.removeEventListener('pointerup', handleWindowUp);
        window.removeEventListener('pointercancel', handleWindowUp);
      };
    }, [
      pendingTouchActive,
      childDrag !== null,
      cancelTouchLongPress,
      clearHoverMerge,
      syncHoverMerge,
      screenToWorld,
      findInner60Folder,
      findInner60TopItem,
      getFolderChildIds,
      entities,
      grid.cellSize,
      grid.gap,
      step,
      onDraggingChildIdChange,
      onPreviewReorderChange,
      onModalHiddenForDragChange,
      onReorderFolderItems,
      onMoveItemsToFolder,
      onMergeItemsToFolder,
      onDropChildToCanvas,
      onCloseFolderModal,
      onStatusToast,
      settings.dragOutItemSizeMode,
      settings.hoverMergeEnabled,
    ]);

    function handleCanvasPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
      const isMiddleClick = e.pointerType === 'mouse' && e.button === 1;
      const isSpacePan = e.pointerType === 'mouse' && e.button === 0 && spacePressedRef.current;

      if (isMiddleClick || isSpacePan) {
        e.preventDefault();
        panRef.current = {
          active: true,
          moved: true,
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
        };
        try {
          containerRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }

      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
        containerRef.current?.contains(activeEl)
      ) {
        (activeEl as HTMLElement).blur();
      }

      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2) {
        cancelTouchLongPress();
        panRef.current.active = false;
        panRef.current.moved = false;
        setMarquee(null);
        setOriginDrag(null);
        setZoneDrag(null);
        setZoneResize(null);
        setTextDrag(null);
        setTextResize(null);
        if (dragStateRef.current && !dragStateRef.current.started) {
          setDragState(null);
        }
        const entries = Array.from(pointersRef.current.values());
        const rect = containerRef.current?.getBoundingClientRect();
        const ox = rect?.left ?? 0;
        const oy = rect?.top ?? 0;
        const p1 = entries[0];
        const p2 = entries[1];
        const { scale: s, panX: px, panY: py } = viewRef.current;
        pinchRef.current = {
          active: true,
          startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
          startMidX: (p1.x + p2.x) / 2 - ox,
          startMidY: (p1.y + p2.y) / 2 - oy,
          startScale: s,
          startPanX: px,
          startPanY: py,
        };
        for (const pid of pointersRef.current.keys()) {
          try {
            e.currentTarget.setPointerCapture(pid);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (pointersRef.current.size > 2) {
        return;
      }

      // In edit mode with mouse, left-click drag on blank canvas directly starts marquee selection
      if (editMode && (e.pointerType === 'mouse' || marqueeMode || e.shiftKey)) {
        if (!e.shiftKey) {
          onSelectIds([]);
        }
        const rect = containerRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setMarquee({ startX: x, startY: y, currX: x, currY: y });
        for (const pid of pointersRef.current.keys()) {
          try {
            e.currentTarget.setPointerCapture(pid);
          } catch {
            // ignore
          }
        }
        return;
      }

      if (editMode && e.target === e.currentTarget) {
        onSelectIds([]);
      }

      panRef.current = {
        active: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
    }

    function handleCanvasPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Anchor-based two-finger pinch zoom (runs before pan / drag / marquee)
      if (pointersRef.current.size === 2 && pinchRef.current?.active) {
        const entries = Array.from(pointersRef.current.values());
        if (entries.length === 2) {
          const [p1, p2] = entries;
          const rect = containerRef.current?.getBoundingClientRect();
          const ox = rect?.left ?? 0;
          const oy = rect?.top ?? 0;
          const currMidX = (p1.x + p2.x) / 2 - ox;
          const currMidY = (p1.y + p2.y) / 2 - oy;
          const currDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          const pinch = pinchRef.current;
          const nextScale = Math.max(
            MIN_VIEW_SCALE,
            Math.min(MAX_VIEW_SCALE, pinch.startScale * (currDist / Math.max(10, pinch.startDist)))
          );
          const wx = (pinch.startMidX - pinch.startPanX) / pinch.startScale;
          const wy = (pinch.startMidY - pinch.startPanY) / pinch.startScale;
          const nextView = {
            scale: nextScale,
            panX: currMidX - wx * nextScale,
            panY: currMidY - wy * nextScale,
          };
          viewRef.current = nextView;
          scheduleDomViewportUpdate();
        }
        return;
      }

      // Handle visual Viewport Origin marker drag
      if (originDrag) {
        const moved =
          originDrag.moved ||
          Math.hypot(e.clientX - originDrag.startClientX, e.clientY - originDrag.startClientY) > 3;
        if (!moved) return;
        const { scale: s } = viewRef.current;
        const rawX = originDrag.startX + (e.clientX - originDrag.startClientX) / s;
        const rawY = originDrag.startY + (e.clientY - originDrag.startClientY) / s;
        const halfStep = step / 2;
        const snapX = Math.round(rawX / halfStep) * halfStep;
        const snapY = Math.round(rawY / halfStep) * halfStep;
        const currX = Math.abs(rawX - snapX) <= 8 ? Math.round(snapX) : Math.round(rawX);
        const currY = Math.abs(rawY - snapY) <= 8 ? Math.round(snapY) : Math.round(rawY);
        setOriginDrag({
          ...originDrag,
          moved: true,
          currX,
          currY,
        });
        return;
      }

      // Handle Zone Resize (integer step, 1..40)
      if (zoneResize) {
        const viewScale = viewRef.current.scale;
        const dxGrid = Math.round((e.clientX - zoneResize.startX) / (step * viewScale));
        const dyGrid = Math.round((e.clientY - zoneResize.startY) / (step * viewScale));
        const nextW = clampZoneSize(zoneResize.startW + dxGrid);
        const nextH = clampZoneSize(zoneResize.startH + dyGrid);
        if (nextW === zoneResize.targetW && nextH === zoneResize.targetH) return;
        setZoneResize({ ...zoneResize, targetW: nextW, targetH: nextH });
        return;
      }

      // Handle Zone Linked Group Drag
      if (zoneDrag) {
        const dist = Math.hypot(e.clientX - zoneDrag.startX, e.clientY - zoneDrag.startY);
        const started = zoneDrag.started || dist > 5;
        if (!started) return;
        if (!zoneDrag.started) {
          try {
            containerRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }

        zoneDrag.currX = e.clientX;
        zoneDrag.currY = e.clientY;
        const viewScale = viewRef.current.scale;
        const dxPx = (e.clientX - zoneDrag.startX) / viewScale;
        const dyPx = (e.clientY - zoneDrag.startY) / viewScale;
        if (zoneDrag.started && containerRef.current) {
          containerRef.current
            .querySelectorAll<HTMLElement>(`[data-zone-id="${CSS.escape(zoneDrag.zone.id)}"]`)
            .forEach((zEl) => {
              zEl.style.transform = `translate3d(${dxPx}px, ${dyPx}px, 0)`;
            });
          for (const id of zoneDrag.movingForegroundIds) {
            const cEl = containerRef.current.querySelector<HTMLElement>(
              `[data-entity-id="${CSS.escape(id)}"]`
            );
            if (cEl) cEl.style.transform = `translate3d(${dxPx}px, ${dyPx}px, 0)`;
          }
          for (const id of zoneDrag.movingTextIds) {
            const tEl = containerRef.current.querySelector<HTMLElement>(
              `[data-text-id="${CSS.escape(id)}"]`
            );
            if (tEl) tEl.style.transform = `translate3d(${dxPx}px, ${dyPx}px, 0)`;
          }
        }

        const rawDx = snapQuarter((e.clientX - zoneDrag.startX) / (step * viewScale));
        const rawDy = snapQuarter((e.clientY - zoneDrag.startY) / (step * viewScale));
        if (zoneDrag.started && zoneDrag.rawDx === rawDx && zoneDrag.rawDy === rawDy) {
          return;
        }

        if (zoneDrag.altOnly || zoneDrag.movingForegroundIds.length === 0) {
          setZoneDrag({
            ...zoneDrag,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            rawDx,
            rawDy,
            dx: rawDx,
            dy: rawDy,
            previewEntities: null,
            errorMsg: null,
          });
          return;
        }

        const res = solveMoveZoneGroup(entities, zoneDrag.movingForegroundIds, rawDx, rawDy);
        if (res.ok) {
          setZoneDrag({
            ...zoneDrag,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            rawDx,
            rawDy,
            dx: res.dx,
            dy: res.dy,
            previewEntities: res.entities,
            errorMsg: null,
          });
        } else {
          setZoneDrag({
            ...zoneDrag,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            rawDx,
            rawDy,
            dx: 0,
            dy: 0,
            previewEntities: null,
            errorMsg: res.message,
          });
        }
        return;
      }

      // Handle FreeText Resize (0.25 step)
      if (textResize) {
        const viewScale = viewRef.current.scale;
        const dxGrid = snapQuarter((e.clientX - textResize.startX) / (step * viewScale));
        const dyGrid = snapQuarter((e.clientY - textResize.startY) / (step * viewScale));
        const nextW = Math.max(1, Math.min(40, snapQuarter(textResize.startW + dxGrid)));
        const nextH = Math.max(0.75, Math.min(40, snapQuarter(textResize.startH + dyGrid)));
        if (nextW === textResize.targetW && nextH === textResize.targetH) return;
        setTextResize({ ...textResize, targetW: nextW, targetH: nextH });
        return;
      }

      // Handle FreeText Drag (0.25 step, zero collision)
      if (textDrag) {
        const dist = Math.hypot(e.clientX - textDrag.startX, e.clientY - textDrag.startY);
        const started = textDrag.started || dist > 5;
        if (!started) return;
        if (!textDrag.started) {
          try {
            containerRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }
        textDrag.currX = e.clientX;
        textDrag.currY = e.clientY;
        const viewScale = viewRef.current.scale;
        const dxPx = (e.clientX - textDrag.startX) / viewScale;
        const dyPx = (e.clientY - textDrag.startY) / viewScale;
        if (textDrag.started && containerRef.current) {
          const tEl = containerRef.current.querySelector<HTMLElement>(
            `[data-text-id="${CSS.escape(textDrag.widget.id)}"]`
          );
          if (tEl) tEl.style.transform = `translate3d(${dxPx}px, ${dyPx}px, 0)`;
        }
        const dx = snapQuarter((e.clientX - textDrag.startX) / (step * viewScale));
        const dy = snapQuarter((e.clientY - textDrag.startY) / (step * viewScale));
        if (textDrag.started && textDrag.dx === dx && textDrag.dy === dy) return;
        setTextDrag({
          ...textDrag,
          currX: e.clientX,
          currY: e.clientY,
          started: true,
          dx,
          dy,
        });
        return;
      }

      // Handle active resize session
      if (resizeState) {
        const dxGrid = Math.round((e.clientX - resizeState.startX) / (step * scale));
        const dyGrid = Math.round((e.clientY - resizeState.startY) / (step * scale));
        const nextW = clampGridSize(resizeState.startW + dxGrid);
        const nextH = clampGridSize(resizeState.startH + dyGrid);

        if (nextW === resizeState.targetW && nextH === resizeState.targetH) return;

        const res = solveResize(entities, resizeState.entityId, nextW, nextH);
        if (res.ok) {
          setResizeState({
            ...resizeState,
            targetW: nextW,
            targetH: nextH,
            previewEntities: res.entities,
            pushedIds: new Set(res.movedIds),
            errorMsg: null,
          });
        } else {
          const errorPreview = entities.map((n) =>
            n.id === resizeState.entityId ? { ...n, w: nextW, h: nextH } : n
          );
          setResizeState({
            ...resizeState,
            targetW: nextW,
            targetH: nextH,
            previewEntities: errorPreview,
            pushedIds: new Set(),
            errorMsg: res.message,
          });
        }
        return;
      }

      // Handle active top-level entity drag session
      if (dragState) {
        const dist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
        const started = dragState.started || dist > 5;
        if (!started) return;
        if (!dragState.started) {
          try {
            containerRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }

        dragState.currX = e.clientX;
        dragState.currY = e.clientY;

        const viewScale = viewRef.current.scale;
        const dxPx = (e.clientX - dragState.startX) / viewScale;
        const dyPx = (e.clientY - dragState.startY) / viewScale;
        if (dragState.started && containerRef.current) {
          const suffix = dragState.lifted ? ' scale(1.05)' : '';
          for (const id of dragState.movingIds) {
            const cardEl = containerRef.current.querySelector<HTMLElement>(
              `[data-entity-id="${CSS.escape(id)}"]`
            );
            if (cardEl) {
              cardEl.style.transform = `translate3d(${dxPx}px, ${dyPx}px, 0)${suffix}`;
            }
          }
        }

        const dx = snapQuarter((e.clientX - dragState.startX) / (step * viewScale));
        const dy = snapQuarter((e.clientY - dragState.startY) / (step * viewScale));
        const { wx, wy } = screenToWorld(e.clientX, e.clientY);

        // 1. Drag Desktop Item(s) INTO Folder (Inner 60% Zone)
        if (dragState.allItemsOnly) {
          const targetFolder = findInner60Folder(wx, wy);
          if (targetFolder) {
            clearHoverMerge();
            if (dragState.started && dragState.dropFolderId === targetFolder.id) {
              return;
            }
            setDragState({
              ...dragState,
              currX: e.clientX,
              currY: e.clientY,
              started: true,
              dx,
              dy,
              previewEntities: null,
              swappedIds: new Set(),
              dropFolderId: targetFolder.id,
              errorMsg: null,
            });
            return;
          }
        }

        // 2. Hover-Hold single item onto another top-level BookmarkItem inner 60% -> Merge Folder
        let hoverItem: BookmarkItem | null = null;
        if (dragState.singleItemId && settings.hoverMergeEnabled) {
          hoverItem = findInner60TopItem(wx, wy, new Set([dragState.singleItemId]));
          if (hoverItem) {
            syncHoverMerge(hoverItem.id, e.clientX, e.clientY);
            if (mergeReadyRef.current === hoverItem.id) {
              if (
                dragState.started &&
                dragState.dropFolderId === null &&
                dragState.previewEntities === null &&
                dragState.errorMsg === null
              ) {
                return;
              }
              setDragState({
                ...dragState,
                currX: e.clientX,
                currY: e.clientY,
                started: true,
                dx,
                dy,
                previewEntities: null,
                swappedIds: new Set(),
                dropFolderId: null,
                errorMsg: null,
              });
              return;
            }
          } else {
            clearHoverMerge();
          }
        } else {
          clearHoverMerge();
        }

        if (
          dragState.started &&
          dragState.dropFolderId === null &&
          !hoverItem &&
          dragState.dx === dx &&
          dragState.dy === dy &&
          (dragState.previewEntities !== null || dragState.errorMsg !== null)
        ) {
          return;
        }

        // 3. Normal solveMove grid placement / edge-clamping / swap
        let effDx = dx;
        let effDy = dy;
        let res = solveMove(entities, dragState.movingIds, effDx, effDy);
        if (!res.ok && res.reason === 'blocked' && (!Number.isInteger(dx) || !Number.isInteger(dy))) {
          const rdx = Math.round(dx);
          const rdy = Math.round(dy);
          if (rdx !== 0 || rdy !== 0) {
            const swapTry = solveMove(entities, dragState.movingIds, rdx, rdy);
            if (swapTry.ok && swapTry.swappedIds.length > 0) {
              effDx = rdx;
              effDy = rdy;
              res = swapTry;
            }
          }
        }
        if (res.ok) {
          setDragState({
            ...dragState,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            dx,
            dy,
            previewEntities: res.entities,
            swappedIds: new Set(res.swappedIds),
            dropFolderId: null,
            errorMsg: null,
          });
        } else {
          const movingSet = new Set(dragState.movingIds);
          const errorPreview = entities.map((n) =>
            movingSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
          );
          setDragState({
            ...dragState,
            currX: e.clientX,
            currY: e.clientY,
            started: true,
            dx,
            dy,
            previewEntities: errorPreview,
            swappedIds: new Set(),
            dropFolderId: null,
            errorMsg: res.message,
          });
        }
        return;
      }

      // Marquee selection
      if (marquee) {
        const rect = containerRef.current!.getBoundingClientRect();
        const currX = e.clientX - rect.left;
        const currY = e.clientY - rect.top;
        setMarquee({ ...marquee, currX, currY });

        const { scale: curScale, panX: curPanX, panY: curPanY } = viewRef.current;
        const minX = (Math.min(marquee.startX, currX) - curPanX) / curScale;
        const maxX = (Math.max(marquee.startX, currX) - curPanX) / curScale;
        const minY = (Math.min(marquee.startY, currY) - curPanY) / curScale;
        const maxY = (Math.max(marquee.startY, currY) - curPanY) / curScale;

        const hitIds: string[] = [];
        for (const n of entities) {
          const nl = n.x * step;
          const nt = n.y * step;
          const nw = n.w * grid.cellSize + (n.w - 1) * grid.gap;
          const nh = n.h * grid.cellSize + (n.h - 1) * grid.gap;
          if (
            rectsOverlap(
              { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
              { x: nl, y: nt, w: nw, h: nh }
            )
          ) {
            hitIds.push(n.id);
          }
        }
        for (const w of widgets) {
          if (w.kind !== 'text') continue;
          const tl = w.x * step;
          const tt = w.y * step;
          const tw = w.w * grid.cellSize + Math.max(0, w.w - 1) * grid.gap;
          const th = w.h * grid.cellSize + Math.max(0, w.h - 1) * grid.gap;
          if (
            rectsOverlap(
              { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
              { x: tl, y: tt, w: tw, h: th }
            )
          ) {
            hitIds.push(w.id);
          }
        }
        onSelectIds(hitIds);
        return;
      }

      // Single-pointer pan (only capture and pan after > 5px movement)
      if (panRef.current.active) {
        if (!panRef.current.moved) {
          const moveDist = Math.hypot(
            e.clientX - panRef.current.startX,
            e.clientY - panRef.current.startY
          );
          if (moveDist <= 5) return;
          panRef.current.moved = true;
          panRef.current.lastX = e.clientX;
          panRef.current.lastY = e.clientY;
          try {
            containerRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          return;
        }

        const dx = e.clientX - panRef.current.lastX;
        const dy = e.clientY - panRef.current.lastY;
        panRef.current.lastX = e.clientX;
        panRef.current.lastY = e.clientY;
        const curView = viewRef.current;
        const nextView = {
          scale: curView.scale,
          panX: curView.panX + dx,
          panY: curView.panY + dy,
        };
        viewRef.current = nextView;
        scheduleDomViewportUpdate();
      }
    }

    function handleCanvasPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
      containerRectRef.current = null;
      const wasPinching = Boolean(pinchRef.current?.active);
      pointersRef.current.delete(e.pointerId);
      cancelTouchLongPress();

      if (wasPinching && pointersRef.current.size === 1) {
        pinchRef.current = null;
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
        const remaining = Array.from(pointersRef.current.values())[0];
        if (remaining) {
          panRef.current = {
            active: true,
            moved: true,
            startX: remaining.x,
            startY: remaining.y,
            lastX: remaining.x,
            lastY: remaining.y,
          };
        }
        try {
          if (containerRef.current?.hasPointerCapture(e.pointerId)) {
            containerRef.current.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
        return;
      }

      if (wasPinching && pointersRef.current.size === 0) {
        pinchRef.current = null;
      }

      const didPanOrPinch = wasPinching || panRef.current.moved;
      if (
        didPanOrPinch ||
        originDrag?.moved ||
        zoneResize ||
        zoneDrag?.started ||
        textResize ||
        textDrag?.started ||
        resizeState ||
        dragState?.started ||
        dragState?.lifted
      ) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
      }
      if (didPanOrPinch) {
        const settled = {
          scale: viewRef.current.scale,
          panX: Math.round(viewRef.current.panX),
          panY: Math.round(viewRef.current.panY),
        };
        viewRef.current = settled;
        applyViewportDom(settled, false);
        onViewportChange(settled);
      }
      panRef.current.active = false;
      panRef.current.moved = false;
      setMarquee(null);

      try {
        if (containerRef.current?.hasPointerCapture(e.pointerId)) {
          containerRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }

      if (originDrag) {
        if (originDrag.moved) {
          onUpdateViewportOrigin({ x: originDrag.currX, y: originDrag.currY });
        }
        setOriginDrag(null);
        return;
      }

      if (zoneResize) {
        const z = zones.find((item) => item.id === zoneResize.zoneId);
        if (z && (zoneResize.targetW !== zoneResize.startW || zoneResize.targetH !== zoneResize.startH)) {
          const now = new Date().toISOString();
          onCommitZones(
            zones.map((item) =>
              item.id === z.id
                ? { ...item, w: zoneResize.targetW, h: zoneResize.targetH, updatedAt: now }
                : item
            )
          );
        }
        setZoneResize(null);
        return;
      }

      if (zoneDrag) {
        if (zoneDrag.started) {
          if (zoneDrag.errorMsg) {
            onStatusToast(zoneDrag.errorMsg, 'error');
          } else if (zoneDrag.dx !== 0 || zoneDrag.dy !== 0) {
            const now = new Date().toISOString();
            const nextZone: ZoneContainer = {
              ...zoneDrag.zone,
              x: snapQuarter(zoneDrag.zone.x + zoneDrag.dx),
              y: snapQuarter(zoneDrag.zone.y + zoneDrag.dy),
              updatedAt: now,
            };
            const nextEntities = zoneDrag.previewEntities ?? entities;
            const movingTextSet = new Set(zoneDrag.movingTextIds);
            const nextTextWidgets = widgets
              .filter((w): w is FreeTextWidget => w.kind === 'text')
              .map((tw) =>
                movingTextSet.has(tw.id)
                  ? {
                      ...tw,
                      x: snapQuarter(tw.x + zoneDrag.dx),
                      y: snapQuarter(tw.y + zoneDrag.dy),
                      updatedAt: now,
                    }
                  : tw
              );
            onCommitZoneGroup(nextZone, nextEntities, nextTextWidgets);
          }
        }
        setZoneDrag(null);
        return;
      }

      if (textResize) {
        const tw = widgets.find(
          (w): w is FreeTextWidget => w.kind === 'text' && w.id === textResize.widgetId
        );
        if (tw && (textResize.targetW !== textResize.startW || textResize.targetH !== textResize.startH)) {
          const now = new Date().toISOString();
          onCommitTextWidgets(
            widgets
              .filter((w): w is FreeTextWidget => w.kind === 'text')
              .map((item) =>
                item.id === tw.id
                  ? { ...item, w: textResize.targetW, h: textResize.targetH, updatedAt: now }
                  : item
              )
          );
        }
        setTextResize(null);
        return;
      }

      if (textDrag) {
        if (textDrag.started && (textDrag.dx !== 0 || textDrag.dy !== 0)) {
          const now = new Date().toISOString();
          onCommitTextWidgets(
            widgets
              .filter((w): w is FreeTextWidget => w.kind === 'text')
              .map((item) =>
                item.id === textDrag.widget.id
                  ? {
                      ...item,
                      x: snapQuarter(item.x + textDrag.dx),
                      y: snapQuarter(item.y + textDrag.dy),
                      updatedAt: now,
                    }
                  : item
              )
          );
        }
        setTextDrag(null);
        return;
      }

      if (resizeState) {
        if (resizeState.errorMsg) {
          onStatusToast(resizeState.errorMsg, 'error');
        } else if (
          resizeState.previewEntities &&
          (resizeState.targetW !== resizeState.startW || resizeState.targetH !== resizeState.startH)
        ) {
          onCommitLayout(resizeState.previewEntities);
        }
        setResizeState(null);
        return;
      }

      if (dragState) {
        const readyMergeTarget = mergeReadyRef.current;
        clearHoverMerge();

        if (readyMergeTarget && dragState.singleItemId) {
          onMergeItemsToFolder(dragState.singleItemId, readyMergeTarget);
        } else if (dragState.dropFolderId && dragState.allItemsOnly) {
          onMoveItemsToFolder(dragState.movingIds, dragState.dropFolderId);
          onSelectIds([]);
        } else if (dragState.started) {
          if (dragState.errorMsg) {
            onStatusToast(dragState.errorMsg, 'error');
          } else if (dragState.previewEntities && (dragState.dx !== 0 || dragState.dy !== 0)) {
            onCommitLayout(dragState.previewEntities);
          }
        }
        setDragState(null);
      }
    }

    function handleCardPointerDown(e: ReactPointerEvent, entity: CanvasGridEntity) {
      if (!editMode) return;
      if (e.pointerType === 'mouse' && (e.button === 1 || spacePressedRef.current)) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if ((e.target as HTMLElement | null)?.closest('[data-folder-child-id]')) return;
      cacheContainerRect();

      const entityMap = new Map(entities.map((it) => [it.id, it]));

      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        // Never intercept touch move immediately — 380ms long-press enables drag while swipes pan cleanly!
        const nextSelected = selectedIds.includes(entity.id) ? selectedIds : [entity.id];
        cancelTouchLongPress();
        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        const timerId = window.setTimeout(() => {
          pendingTouchRef.current = null;
          setPendingTouchActive(false);
          panRef.current.active = false;
          panRef.current.moved = false;
          navigator.vibrate?.(15);
          onSelectIds(nextSelected);
          try {
            containerRef.current?.setPointerCapture(pointerId);
          } catch {
            // ignore
          }
          const movingList = nextSelected
            .map((id) => entityMap.get(id))
            .filter((x): x is CanvasGridEntity => Boolean(x));
          const allItemsOnly = movingList.length > 0 && movingList.every((m) => m.kind === 'item');
          const singleItemId =
            movingList.length === 1 && movingList[0].kind === 'item' ? movingList[0].id : null;
          setDragState({
            movingIds: nextSelected,
            allItemsOnly,
            singleItemId,
            startX,
            startY,
            currX: startX,
            currY: startY,
            started: true,
            lifted: true,
            dx: 0,
            dy: 0,
            previewEntities: null,
            swappedIds: new Set(),
            dropFolderId: null,
            errorMsg: null,
          });
        }, settings.touchLongPressMs);

        pendingTouchRef.current = {
          kind: 'entity',
          entity,
          selectedIdsForDrag: nextSelected,
          pointerId,
          startX,
          startY,
          timerId,
        };
        setPendingTouchActive(true);
        return;
      }

      e.stopPropagation();

      let nextSelected: string[];
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        if (selectedIds.includes(entity.id)) {
          nextSelected = selectedIds.filter((id) => id !== entity.id);
          onSelectIds(nextSelected);
          return;
        } else {
          nextSelected = [...selectedIds, entity.id];
        }
      } else if (selectedIds.includes(entity.id)) {
        nextSelected = selectedIds;
      } else {
        nextSelected = [entity.id];
      }

      onSelectIds(nextSelected);

      const movingList = nextSelected
        .map((id) => entityMap.get(id))
        .filter((x): x is CanvasGridEntity => Boolean(x));
      const allItemsOnly = movingList.length > 0 && movingList.every((m) => m.kind === 'item');
      const singleItemId =
        movingList.length === 1 && movingList[0].kind === 'item' ? movingList[0].id : null;

      setDragState({
        movingIds: nextSelected,
        allItemsOnly,
        singleItemId,
        startX: e.clientX,
        startY: e.clientY,
        currX: e.clientX,
        currY: e.clientY,
        started: false,
        lifted: false,
        dx: 0,
        dy: 0,
        previewEntities: null,
        swappedIds: new Set(),
        dropFolderId: null,
        errorMsg: null,
      });
    }

    function handleResizePointerDown(e: ReactPointerEvent, entity: CanvasGridEntity) {
      if (!editMode) return;
      e.stopPropagation();
      onSelectIds([entity.id]);
      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      setResizeState({
        entityId: entity.id,
        startX: e.clientX,
        startY: e.clientY,
        startW: entity.w,
        startH: entity.h,
        targetW: entity.w,
        targetH: entity.h,
        previewEntities: null,
        pushedIds: new Set(),
        errorMsg: null,
      });
    }

    function handleZonePointerDown(e: ReactPointerEvent, zone: ZoneContainer) {
      if (!editMode) return;
      if (e.pointerType === 'mouse' && (e.button === 1 || spacePressedRef.current)) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      cacheContainerRect();
      onSelectIds([zone.id]);

      const altOnly = e.altKey;
      const textList = widgets.filter((w): w is FreeTextWidget => w.kind === 'text');
      const movingForegroundIds = altOnly
        ? []
        : entities.filter((ent) => isEntityInsideZone(ent, zone)).map((ent) => ent.id);
      const movingTextIds = altOnly
        ? []
        : textList.filter((tw) => isEntityInsideZone(tw, zone)).map((tw) => tw.id);

      setZoneDrag({
        zone,
        altOnly,
        movingForegroundIds,
        movingTextIds,
        startX: e.clientX,
        startY: e.clientY,
        currX: e.clientX,
        currY: e.clientY,
        started: false,
        rawDx: 0,
        rawDy: 0,
        dx: 0,
        dy: 0,
        previewEntities: null,
        errorMsg: null,
      });
    }

    function handleZoneResizePointerDown(e: ReactPointerEvent, zone: ZoneContainer) {
      if (!editMode) return;
      e.stopPropagation();
      onSelectIds([zone.id]);
      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setZoneResize({
        zoneId: zone.id,
        startX: e.clientX,
        startY: e.clientY,
        startW: zone.w,
        startH: zone.h,
        targetW: zone.w,
        targetH: zone.h,
      });
    }

    function handleTextPointerDown(e: ReactPointerEvent, widget: FreeTextWidget) {
      if (!editMode) return;
      if (e.pointerType === 'mouse' && (e.button === 1 || spacePressedRef.current)) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      cacheContainerRect();

      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const nextSelected = selectedIds.includes(widget.id)
          ? selectedIds.filter((id) => id !== widget.id)
          : [...selectedIds, widget.id];
        onSelectIds(nextSelected);
        return;
      }

      onSelectIds([widget.id]);
      setTextDrag({
        widget,
        startX: e.clientX,
        startY: e.clientY,
        currX: e.clientX,
        currY: e.clientY,
        started: false,
        dx: 0,
        dy: 0,
      });
    }

    function handleTextResizePointerDown(e: ReactPointerEvent, widget: FreeTextWidget) {
      if (!editMode) return;
      e.stopPropagation();
      onSelectIds([widget.id]);
      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setTextResize({
        widgetId: widget.id,
        startX: e.clientX,
        startY: e.clientY,
        startW: widget.w,
        startH: widget.h,
        targetW: widget.w,
        targetH: widget.h,
      });
    }

    const activeDragMovingSet =
      dragState?.started
        ? new Set(dragState.movingIds)
        : zoneDrag?.started
          ? new Set(zoneDrag.movingForegroundIds)
          : null;
    const origEntityMap = new Map(entities.map((e) => [e.id, e]));

    const baseRenderedEntities =
      resizeState?.previewEntities ??
      dragState?.previewEntities ??
      (zoneDrag?.started && zoneDrag.previewEntities ? zoneDrag.previewEntities : null) ??
      (childDrag?.exitedSource && childDrag.previewEntities
        ? childDrag.previewEntities.filter((e) => e.id !== childDrag.item.id)
        : entities);

    const renderedEntities = activeDragMovingSet
      ? baseRenderedEntities.map((e) =>
          activeDragMovingSet.has(e.id) ? (origEntityMap.get(e.id) ?? e) : e
        )
      : baseRenderedEntities;

    const dragSlotPreviews =
      dragState?.started &&
      dragState.previewEntities &&
      !dragState.dropFolderId &&
      !mergeReadyTargetId
        ? dragState.previewEntities.filter((e) => activeDragMovingSet?.has(e.id))
        : zoneDrag?.started && zoneDrag.previewEntities
          ? zoneDrag.previewEntities.filter((e) => activeDragMovingSet?.has(e.id))
          : [];

    const activeDragOffset = dragState?.started
      ? {
          dxPx: (dragState.currX - dragState.startX) / scale,
          dyPx: (dragState.currY - dragState.startY) / scale,
        }
      : zoneDrag?.started
        ? {
            dxPx: (zoneDrag.currX - zoneDrag.startX) / scale,
            dyPx: (zoneDrag.currY - zoneDrag.startY) / scale,
          }
        : null;

    const zoneOnlyDragOffset = zoneDrag?.started
      ? {
          dxPx: (zoneDrag.currX - zoneDrag.startX) / scale,
          dyPx: (zoneDrag.currY - zoneDrag.startY) / scale,
        }
      : null;

    const textOnlyDragOffset = textDrag?.started
      ? {
          dxPx: (textDrag.currX - textDrag.startX) / scale,
          dyPx: (textDrag.currY - textDrag.startY) / scale,
        }
      : null;

    const renderedZones = zones.map((z) =>
      zoneResize && zoneResize.zoneId === z.id
        ? { ...z, w: zoneResize.targetW, h: zoneResize.targetH }
        : z
    );

    const zoneMovingTextSet = zoneDrag?.started ? new Set(zoneDrag.movingTextIds) : null;
    const textWidgets = widgets
      .filter((w): w is FreeTextWidget => w.kind === 'text')
      .map((tw) =>
        textResize && textResize.widgetId === tw.id
          ? { ...tw, w: textResize.targetW, h: textResize.targetH }
          : tw
      );

    const activeErrorMsg =
      resizeState?.errorMsg ?? dragState?.errorMsg ?? childDrag?.errorMsg ?? zoneDrag?.errorMsg ?? null;
    const dotStep = Math.max(14, (step / 4) * scale);

    // Precompute folder items map (respecting live reorder preview during child drag)
    const folderItemsMap = new Map<string, BookmarkItem[]>();
    const itemById = new Map(items.map((i) => [i.id, i]));
    for (const f of folders) {
      if (childDrag && childDrag.sourceFolder.id === f.id && childDrag.reorderedIds) {
        folderItemsMap.set(
          f.id,
          childDrag.reorderedIds
            .map((id) => itemById.get(id))
            .filter((x): x is BookmarkItem => Boolean(x))
        );
      } else {
        folderItemsMap.set(
          f.id,
          items.filter((i) => i.parentId === f.id).sort((a, b) => a.order - b.order)
        );
      }
    }

    const activeDropFolderId = dragState?.dropFolderId ?? childDrag?.targetFolderId ?? null;
    const childDropW =
      childDrag && settings.dragOutItemSizeMode === 'preserve'
        ? clampGridSize(childDrag.item.w)
        : 1;
    const childDropH =
      childDrag && settings.dragOutItemSizeMode === 'preserve'
        ? clampGridSize(childDrag.item.h)
        : 1;
    const ghostWidth =
      (childDropW * grid.cellSize + (childDropW - 1) * grid.gap) * scale;
    const ghostHeight =
      (childDropH * grid.cellSize + (childDropH - 1) * grid.gap) * scale;
    const showDotGrid =
      settings.dotGridMode === 'always' ||
      (settings.dotGridMode === 'edit-only' && editMode);
    const useWallpaper =
      settings.canvasBgStyle === 'wallpaper' && Boolean(settings.customBgUrl);
    const wallpaperReady = useStagedWallpaper(useWallpaper, settings.customBgUrl);
    const useAurora = settings.canvasBgStyle === 'aurora' && !useWallpaper;

    return (
      <div
        ref={containerRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onContextMenu={(e) => {
          if (!onOpenContextMenu) return;
          e.preventDefault();
          const { wx, wy } = screenToWorld(e.clientX, e.clientY);
          onOpenContextMenu(e, { kind: 'canvas', worldX: wx, worldY: wy });
        }}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressClickRef.current = false;
          }
        }}
        style={{
          touchAction: 'none',
          ...(wallpaperReady
            ? {
                backgroundImage: `url(${settings.customBgUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}),
        }}
        className={`relative w-full h-full overflow-hidden select-none ${
          useAurora ? 'canvas-bg-aurora' : ''
        } ${
          spacePressed
            ? 'cursor-grab active:cursor-grabbing'
            : editMode
              ? 'cursor-default'
              : 'cursor-grab active:cursor-grabbing'
        }`}
      >
        {/* Subtle readability veil when custom wallpaper is active */}
        {useWallpaper && (
          <div className="pointer-events-none absolute inset-0 bg-[var(--bg-canvas)]/38 backdrop-blur-[2px]" />
        )}

        {/* GPU-composited dot grid overlay (translates via translate3d, zero repaint on pan) */}
        {showDotGrid && (
          <div
            ref={dotLayerRef}
            className="pointer-events-none absolute"
            style={{
              inset: -96,
              willChange: 'transform',
              backgroundImage: `radial-gradient(var(--dot-color) 1.25px, transparent 1.25px)`,
              backgroundSize: `${dotStep}px ${dotStep}px`,
              transform: `translate3d(${((panX % dotStep) + dotStep) % dotStep}px, ${((panY % dotStep) + dotStep) % dotStep}px, 0)`,
            }}
          />
        )}

        {/* Transformed Infinite World Layer (crisp vector rasterization at rest; GPU layer during active pan/zoom) */}
        <div
          ref={worldLayerRef}
          style={{
            transform: `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${scale})`,
            transformOrigin: '0 0',
            transition: flyTransition
              ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
              : undefined,
            position: 'absolute',
            left: 0,
            top: 0,
          }}
        >
          {/* Background Zone Frame Layer (zIndex: 2..4 / 34) */}
          {renderedZones.map((zone) => {
            const isZoneDragging = zoneDrag?.started && zoneDrag.zone.id === zone.id;
            return (
              <ZoneCard
                key={zone.id}
                zone={zone}
                grid={grid}
                isSelected={selectedIds.includes(zone.id)}
                isResizing={zoneResize?.zoneId === zone.id}
                isError={Boolean(isZoneDragging && zoneDrag?.errorMsg)}
                isNewlyCreated={newlyCreatedId === zone.id}
                dragOffset={isZoneDragging ? zoneOnlyDragOffset : null}
              />
            );
          })}

          {/* Landing slot preview when dragging an item out of a folder onto canvas */}
          {childDrag?.exitedSource && childDrag.targetGrid && !childDrag.targetFolderId && !mergeReadyTargetId && (
            <div
              style={{
                position: 'absolute',
                left: childDrag.targetGrid.x * step,
                top: childDrag.targetGrid.y * step,
                width: childDropW * grid.cellSize + (childDropW - 1) * grid.gap,
                height: childDropH * grid.cellSize + (childDropH - 1) * grid.gap,
                zIndex: 5,
              }}
              className={`border-2 border-dashed transition-colors ${
                childDropW === 1 && childDropH === 1 ? 'rounded-[20px]' : 'rounded-[24px]'
              } ${
                childDrag.errorMsg
                  ? 'border-[var(--accent-red)] bg-red-500/12'
                  : 'border-[var(--accent-emerald)] bg-emerald-500/10'
              }`}
            />
          )}

          {/* Landing slot previews during active top-level card drag */}
          {dragSlotPreviews.map((slotEntity) => {
            const slotW = slotEntity.w * grid.cellSize + (slotEntity.w - 1) * grid.gap;
            const slotH = slotEntity.h * grid.cellSize + (slotEntity.h - 1) * grid.gap;
            return (
              <div
                key={`slot-${slotEntity.id}`}
                style={{
                  position: 'absolute',
                  left: slotEntity.x * step,
                  top: slotEntity.y * step,
                  width: slotW,
                  height: slotH,
                  zIndex: 5,
                }}
                className={`border-2 border-dashed transition-colors ${
                  slotEntity.w === 1 && slotEntity.h === 1 ? 'rounded-[20px]' : 'rounded-[24px]'
                } ${
                  dragState?.errorMsg
                    ? 'border-[var(--accent-red)] bg-red-500/12'
                    : 'border-[var(--accent-emerald)] bg-emerald-500/10'
                }`}
              />
            );
          })}

          {renderedEntities.map((entity) => {
            const isSelected = selectedIds.includes(entity.id);
            const isResizing = resizeState?.entityId === entity.id;
            const isMovingThis = Boolean(activeDragMovingSet?.has(entity.id));
            const isLifted =
              Boolean(dragState?.lifted) && isMovingThis;
            const isPushed =
              (resizeState?.pushedIds.has(entity.id) ?? false) ||
              (dragState?.swappedIds.has(entity.id) ?? false) ||
              (childDrag?.pushedIds.has(entity.id) ?? false);
            const isError =
              (isResizing && Boolean(resizeState?.errorMsg)) ||
              (Boolean(dragState?.errorMsg) && isMovingThis);
            const isFolderDropTarget =
              entity.kind === 'folder' && activeDropFolderId === entity.id;
            const isMergeTarget = entity.kind === 'item' && mergeReadyTargetId === entity.id;

            return (
              <CanvasCard
                key={entity.id}
                entity={entity}
                folderItems={entity.kind === 'folder' ? (folderItemsMap.get(entity.id) ?? []) : []}
                grid={grid}
                editMode={editMode}
                glassMode={useWallpaper}
                openTarget={settings.openTarget}
                isSelected={isSelected}
                isLifted={isLifted}
                isPushed={isPushed}
                isError={isError}
                isFolderDropTarget={isFolderDropTarget}
                isMergeTarget={isMergeTarget}
                isResizing={isResizing}
                isNewlyCreated={newlyCreatedId === entity.id}
                isInlineEditing={entity.kind === 'note' && inlineEditingId === entity.id}
                dragOffset={isMovingThis ? activeDragOffset : null}
                draggingChildId={childDrag?.started ? childDrag.item.id : null}
                onCardPointerDown={handleCardPointerDown}
                onChildPointerDown={(ev, folder, item) =>
                  beginChildTouchOrMouse(ev, 'canvas-folder', folder, item, null)
                }
                onResizePointerDown={handleResizePointerDown}
                onOpenFolder={onOpenFolder}
                onEditEntity={onEditEntity}
                onRequestEditNote={onRequestEditNote}
                onStartInlineNoteEdit={onStartInlineNoteEdit}
                onCommitInlineNote={onCommitInlineNote}
                onCancelInlineEdit={onCancelInlineEdit}
                onCycleFolderMode={onCycleFolderMode}
                onOpenContextMenu={onOpenContextMenu}
              />
            );
          })}

          {/* Annotation FreeText Layer (zIndex: 14, non-blocking in browse mode) */}
          {textWidgets.map((tw) => {
            const isTextMoving =
              (textDrag?.started && textDrag.widget.id === tw.id) ||
              Boolean(zoneMovingTextSet?.has(tw.id));
            const offset =
              textDrag?.started && textDrag.widget.id === tw.id
                ? textOnlyDragOffset
                : zoneMovingTextSet?.has(tw.id)
                  ? zoneOnlyDragOffset
                  : null;
            return (
              <FreeTextCard
                key={tw.id}
                widget={tw}
                grid={grid}
                editMode={editMode}
                isSelected={selectedIds.includes(tw.id)}
                isResizing={textResize?.widgetId === tw.id}
                isNewlyCreated={newlyCreatedId === tw.id}
                isInlineEditing={inlineEditingId === tw.id}
                dragOffset={isTextMoving ? offset : null}
                onTextPointerDown={handleTextPointerDown}
                onTextResizePointerDown={handleTextResizePointerDown}
                onEditText={(w) => onEditWidget(w)}
                onStartInlineEdit={onStartInlineEdit}
                onCommitInlineText={onCommitInlineText}
                onCancelInlineEdit={onCancelInlineEdit}
                onOpenContextMenu={onOpenContextMenu}
              />
            );
          })}

          {/* Top Zone Overlay Layer (zIndex: 28 / 36): dedicated top header bar + edit handles */}
          {renderedZones.map((zone) => {
            const isZoneDragging = zoneDrag?.started && zoneDrag.zone.id === zone.id;
            return (
              <ZoneOverlay
                key={`overlay-${zone.id}`}
                zone={zone}
                grid={grid}
                editMode={editMode}
                isResizing={zoneResize?.zoneId === zone.id}
                isInlineEditing={inlineEditingId === zone.id}
                dragOffset={isZoneDragging ? zoneOnlyDragOffset : null}
                onZonePointerDown={handleZonePointerDown}
                onZoneResizePointerDown={handleZoneResizePointerDown}
                onEditZone={onEditZone}
                onStartInlineEdit={onStartInlineEdit}
                onCommitInlineTitle={onCommitInlineZoneTitle}
                onCancelInlineEdit={onCancelInlineEdit}
                onOpenContextMenu={onOpenContextMenu}
              />
            );
          })}

          {editMode &&
            (settings.desktopViewportMode === 'anchor' ||
              settings.mobileViewportMode === 'anchor') &&
            (() => {
            const ox = originDrag ? originDrag.currX : viewportOrigin.x;
            const oy = originDrag ? originDrag.currY : viewportOrigin.y;
            return (
              <div
                style={{
                  position: 'absolute',
                  left: ox,
                  top: oy,
                  width: 0,
                  height: 0,
                  zIndex: originDrag ? 50 : 40,
                }}
                className="pointer-events-none"
              >
                {/* Subtle 96px dashed crosshair guide lines centered on (ox, oy) */}
                <div
                  style={{
                    position: 'absolute',
                    left: -48,
                    top: 0,
                    width: 96,
                    height: 0,
                    borderTop: '1px dashed color-mix(in srgb, var(--accent-orange) 45%, transparent)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: -48,
                    width: 0,
                    height: 96,
                    borderLeft: '1px dashed color-mix(in srgb, var(--accent-orange) 45%, transparent)',
                  }}
                />

                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    transform: 'translate(-50%, -16px)',
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0 && e.pointerType === 'mouse') return;
                    e.stopPropagation();
                    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (pointersRef.current.size >= 2) {
                      setOriginDrag(null);
                      return;
                    }
                    try {
                      containerRef.current?.setPointerCapture(e.pointerId);
                    } catch {
                      // ignore
                    }
                    setOriginDrag({
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startX: viewportOrigin.x,
                      startY: viewportOrigin.y,
                      currX: viewportOrigin.x,
                      currY: viewportOrigin.y,
                      moved: false,
                    });
                  }}
                  className="pointer-events-auto group flex flex-col items-center cursor-move touch-none"
                  title={`默认视野锚点 (${ox}, ${oy}) · 可拖拽微调`}
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center border-2 shadow-md transition-transform ${
                      originDrag?.moved
                        ? 'scale-110 bg-[var(--accent-orange)] text-white border-white'
                        : 'bg-[var(--bg-card)]/95 text-[var(--accent-orange)] border-[var(--accent-orange)] hover:scale-105'
                    }`}
                  >
                    <Crosshair size={16} />
                  </div>
                  <span className="mt-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--bg-card)]/92 text-[var(--ink-main)] border border-[var(--border-hair)] shadow-sm">
                    视野锚点{originDrag?.moved ? ` (${ox}, ${oy})` : ''}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Floating Ghost Card when dragging child item out of folder/modal */}
        {childDrag?.started && childDrag.exitedSource && (
          <div
            ref={childGhostRef}
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: ghostWidth,
              height: ghostHeight,
              zIndex: 60,
              transition: 'none',
              willChange: 'transform',
              transform: `translate3d(${childDrag.currX - ghostWidth / 2}px, ${childDrag.currY - ghostHeight / 2}px, 0) scale(1.05)`,
              boxShadow: childDrag.errorMsg
                ? '0 16px 36px rgba(220, 38, 38, 0.28)'
                : '0 16px 36px rgba(255, 85, 0, 0.24)',
            }}
            className={`pointer-events-none bento-card ${
              childDropW === 1 && childDropH === 1 ? 'bento-card-1x1' : ''
            } p-3 flex flex-col justify-between ${
              childDrag.errorMsg ? 'bento-card-error' : 'bento-card-selected'
            }`}
          >
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center">
              <IconGlyph
                icon={childDrag.item.icon}
                faviconUrl={childDrag.item.faviconUrl}
                title={childDrag.item.title}
                accent={childDrag.item.accent}
                size={18}
              />
            </div>
            <div className="text-xs font-medium truncate leading-tight">
              {childDrag.item.title}
            </div>
          </div>
        )}

        {/* Rubber-band Marquee Selection Box */}
        {marquee && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(marquee.startX, marquee.currX),
              top: Math.min(marquee.startY, marquee.currY),
              width: Math.abs(marquee.currX - marquee.startX),
              height: Math.abs(marquee.currY - marquee.startY),
            }}
            className="pointer-events-none z-30 rounded-xl border border-[var(--accent-orange)] bg-[var(--accent-orange)]/10"
          />
        )}

        {/* Live Collision / Deadlock Banner */}
        {activeErrorMsg && (
          <div className="pointer-events-none fixed bottom-20 left-0 right-0 z-40 flex justify-center px-4">
            <div className="rounded-full bg-[var(--accent-red)] text-white px-4 py-1.5 text-xs font-medium shadow-lg">
              {activeErrorMsg}
            </div>
          </div>
        )}
      </div>
    );
  }
);
