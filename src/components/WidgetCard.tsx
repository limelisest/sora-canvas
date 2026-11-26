import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Images,
  Lock,
  Pencil,
  StickyNote,
} from 'lucide-react';
import type {
  CarouselWidget,
  FreeTextWidget,
  GridConfig,
  NoteWidget,
} from '../../shared/types';
import {
  markTrackedAssetSettled,
  registerTrackedAsset,
  useLoadPhase,
} from '../utils/loadTracker';
import type { ContextMenuTarget } from './CanvasCard';

export function CarouselWidgetBody({
  widget,
  editMode,
  openTarget = '_blank',
  onEditWidget,
}: {
  widget: CarouselWidget;
  editMode: boolean;
  openTarget?: '_blank' | '_self';
  onEditWidget: (widget: CarouselWidget) => void;
}) {
  const images = widget.images;
  const loadPhase = useLoadPhase();
  const mediaReady = loadPhase === 'media';
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loadedUrls, setLoadedUrls] = useState<Record<string, true>>({});

  useEffect(() => {
    if (activeIndex >= images.length) {
      setActiveIndex(0);
    }
  }, [images.length, activeIndex]);

  useEffect(() => {
    if (!mediaReady || images.length <= 1 || paused || editMode) return;
    const ms = Math.max(1000, Math.min(30000, Math.round((widget.intervalSec || 3) * 1000)));
    const id = window.setInterval(() => {
      setActiveIndex((cur) => (cur + 1) % images.length);
    }, ms);
    return () => window.clearInterval(id);
  }, [mediaReady, images.length, paused, editMode, widget.intervalSec]);

  const safeIdx = images.length > 0 ? activeIndex % images.length : 0;
  const curr = images[safeIdx];
  const currUrl = curr?.url ?? '';
  const isCurrLoaded = Boolean(currUrl && loadedUrls[currUrl]);

  // Register active slide in loadTracker once media phase begins
  useEffect(() => {
    if (!mediaReady || !currUrl) return;
    registerTrackedAsset(`carousel:${widget.id}:${currUrl}`);
  }, [mediaReady, widget.id, currUrl]);

  // Silently preload ONLY the next slide after the active slide has finished loading
  useEffect(() => {
    if (!mediaReady || !isCurrLoaded || images.length <= 1) return;
    const nextImg = images[(safeIdx + 1) % images.length];
    if (!nextImg?.url || loadedUrls[nextImg.url]) return;

    let cancelled = false;
    const pre = new Image();
    pre.decoding = 'async';
    pre.onload = () => {
      if (!cancelled) {
        setLoadedUrls((prev) => (prev[nextImg.url] ? prev : { ...prev, [nextImg.url]: true }));
      }
    };
    pre.src = nextImg.url;
    if (pre.complete && pre.naturalWidth > 0) {
      setLoadedUrls((prev) => (prev[nextImg.url] ? prev : { ...prev, [nextImg.url]: true }));
    }
    return () => {
      cancelled = true;
    };
  }, [mediaReady, isCurrLoaded, images, safeIdx, loadedUrls]);

  if (images.length === 0) {
    return (
      <div
        onClick={(e) => {
          if (!editMode) {
            e.stopPropagation();
            onEditWidget(widget);
          }
        }}
        className="h-full w-full flex flex-col items-center justify-center gap-2 p-4 text-center bg-[var(--bg-subtle)]/55 cursor-pointer"
      >
        <div className="h-10 w-10 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--ink-muted)]">
          <Images size={18} />
        </div>
        <div className="text-xs font-medium text-[var(--ink-secondary)]">
          {widget.title || '轮播图小部件'}
        </div>
        <div className="text-[11px] text-[var(--ink-muted)]">点击编辑上传本地图片或添加外链</div>
      </div>
    );
  }

  const fitClass = widget.fit === 'contain' ? 'object-contain' : 'object-cover';
  const markSlideSettled = (url: string, success: boolean) => {
    markTrackedAssetSettled(`carousel:${widget.id}:${url}`);
    if (success) {
      setLoadedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
    }
  };

  return (
    <div
      className="group relative h-full w-full overflow-hidden bg-[var(--bg-subtle)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {!mediaReady ? (
        <div className="h-full w-full bg-[var(--bg-subtle)] animate-pulse flex items-center justify-center">
          <Images size={20} className="text-[var(--ink-muted)]/45" />
        </div>
      ) : widget.transition === 'fade' ? (
        <div className="relative h-full w-full">
          {images.map((img, i) => {
            const shouldMount = i === safeIdx || Boolean(loadedUrls[img.url]);
            if (!shouldMount) return null;
            return (
              <img
                key={img.id}
                src={img.url}
                alt={img.caption || widget.title || 'carousel'}
                draggable={false}
                decoding="async"
                onLoad={() => markSlideSettled(img.url, true)}
                onError={() => markSlideSettled(img.url, false)}
                style={{
                  opacity: i === safeIdx ? 1 : 0,
                  transition: 'opacity 500ms ease',
                }}
                className={`absolute inset-0 h-full w-full ${fitClass} pointer-events-none select-none`}
              />
            );
          })}
        </div>
      ) : (
        <div
          className="flex h-full w-full"
          style={{
            transform: `translateX(-${safeIdx * 100}%)`,
            transition: 'transform 480ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {images.map((img, i) => {
            const shouldMount = i === safeIdx || Boolean(loadedUrls[img.url]);
            return (
              <div key={img.id} className="relative h-full w-full shrink-0 bg-[var(--bg-subtle)]">
                {shouldMount && (
                  <img
                    src={img.url}
                    alt={img.caption || widget.title || 'carousel'}
                    draggable={false}
                    decoding="async"
                    onLoad={() => markSlideSettled(img.url, true)}
                    onError={() => markSlideSettled(img.url, false)}
                    className={`h-full w-full ${fitClass} pointer-events-none select-none`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Optional clickable link overlay in browse mode */}
      {!editMode && curr?.linkUrl && (
        <a
          href={curr.linkUrl}
          target={openTarget}
          rel={openTarget === '_blank' ? 'noopener noreferrer' : undefined}
          draggable={false}
          className="absolute inset-0 z-10"
          aria-label={curr.caption || widget.title || '打开轮播链接'}
        />
      )}

      {/* Optional title or caption pill */}
      {(curr?.caption || widget.title) && (
        <div className="pointer-events-none absolute top-2.5 left-2.5 right-10 z-10 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-black/45 text-white backdrop-blur-xs">
            <span className="truncate">{curr?.caption || widget.title}</span>
            {!editMode && curr?.linkUrl && <ArrowUpRight size={11} className="shrink-0" />}
          </span>
        </div>
      )}

      {/* Prev / Next Chevrons on hover */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setActiveIndex((cur) => (cur - 1 + images.length) % images.length);
            }}
            className="opacity-0 group-hover:opacity-100 absolute left-2 top-1/2 -translate-y-1/2 z-20 h-7 w-7 rounded-full bg-black/45 hover:bg-black/65 text-white backdrop-blur-xs flex items-center justify-center transition-opacity cursor-pointer"
            aria-label="上一张"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setActiveIndex((cur) => (cur + 1) % images.length);
            }}
            className="opacity-0 group-hover:opacity-100 absolute right-2 top-1/2 -translate-y-1/2 z-20 h-7 w-7 rounded-full bg-black/45 hover:bg-black/65 text-white backdrop-blur-xs flex items-center justify-center transition-opacity cursor-pointer"
            aria-label="下一张"
          >
            <ChevronRight size={15} />
          </button>

          {/* Bottom indicator dots */}
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full px-2 py-1 bg-black/38 backdrop-blur-xs">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex(i);
                }}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  i === safeIdx ? 'w-4 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'
                }`}
                aria-label={`第 ${i + 1} 张`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function NoteWidgetBody({
  widget,
  editMode,
  isInlineEditing = false,
  onRequestEditNote,
  onCommitInlineNote,
  onCancelInlineEdit,
}: {
  widget: NoteWidget;
  editMode: boolean;
  isInlineEditing?: boolean;
  onRequestEditNote: (note: NoteWidget) => void;
  onCommitInlineNote?: (note: NoteWidget, title: string, content: string) => void;
  onCancelInlineEdit?: () => void;
}) {
  const [draftTitle, setDraftTitle] = useState(widget.title);
  const [draftContent, setDraftContent] = useState(widget.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isInlineEditing) {
      setDraftTitle(widget.title);
      setDraftContent(widget.content);
      const raf = window.requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [isInlineEditing, widget.title, widget.content]);

  const commitNote = () => {
    onCommitInlineNote?.(widget, draftTitle.trim() || '随手便签', draftContent);
  };

  return (
    <div
      className="h-full w-full flex flex-col p-3.5"
      onPointerDown={isInlineEditing ? (e) => e.stopPropagation() : undefined}
      onBlur={
        isInlineEditing
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                commitNote();
              }
            }
          : undefined
      }
      onDoubleClick={(e) => {
        if (editMode || isInlineEditing) return;
        e.stopPropagation();
        onRequestEditNote(widget);
      }}
    >
      <div
        className={`flex items-center justify-between gap-2 pb-2 shrink-0 ${
          editMode && !isInlineEditing ? 'pr-7' : ''
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {widget.isPrivate ? (
            <Lock size={12} className="text-amber-500 shrink-0" />
          ) : (
            <StickyNote size={13} className="text-[var(--accent-orange)] shrink-0" />
          )}
          {isInlineEditing ? (
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commitNote();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  textareaRef.current?.focus();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelInlineEdit?.();
                }
              }}
              placeholder="便签标题"
              className="w-full min-w-0 bg-transparent border-b border-[var(--border-strong)]/60 focus:border-[var(--accent-orange)] text-xs font-semibold text-[var(--ink-main)] outline-none pb-0.5"
            />
          ) : (
            <span className="text-xs font-semibold truncate text-[var(--ink-main)]">
              {widget.title || '便签'}
            </span>
          )}
        </div>

        {!editMode && !isInlineEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestEditNote(widget);
            }}
            className="h-6 w-6 rounded-full inline-flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink-main)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="编辑便签"
            aria-label="编辑便签"
          >
            <Pencil size={11} />
          </button>
        )}
      </div>

      {isInlineEditing ? (
        <textarea
          ref={textareaRef}
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              commitNote();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelInlineEdit?.();
            }
          }}
          placeholder="记录备忘内容… (失焦或 Ctrl/Cmd+Enter 自动保存)"
          className="bento-scroll flex-1 min-h-0 w-full resize-none bg-transparent text-xs leading-relaxed text-[var(--ink-secondary)] placeholder:text-[var(--ink-muted)]/75 outline-none pr-0.5 select-text"
        />
      ) : (
        <div className="bento-scroll flex-1 min-h-0 overflow-y-auto text-xs leading-relaxed text-[var(--ink-secondary)] whitespace-pre-wrap break-words pr-0.5">
          {widget.content ? (
            widget.content
          ) : (
            <span className="text-[var(--ink-muted)] italic">双击或点击编辑图标记录备忘…</span>
          )}
        </div>
      )}
    </div>
  );
}

interface FreeTextCardProps {
  widget: FreeTextWidget;
  grid: GridConfig;
  editMode: boolean;
  isSelected: boolean;
  isResizing: boolean;
  isNewlyCreated?: boolean;
  isInlineEditing?: boolean;
  dragOffset?: { dxPx: number; dyPx: number } | null;
  onTextPointerDown: (e: ReactPointerEvent, widget: FreeTextWidget) => void;
  onTextResizePointerDown: (e: ReactPointerEvent, widget: FreeTextWidget) => void;
  onEditText: (widget: FreeTextWidget) => void;
  onStartInlineEdit?: (widgetId: string) => void;
  onCommitInlineText?: (widget: FreeTextWidget, nextText: string) => void;
  onCancelInlineEdit?: () => void;
  onOpenContextMenu?: (e: ReactMouseEvent, target: ContextMenuTarget) => void;
}

export function FreeTextCard({
  widget,
  grid,
  editMode,
  isSelected,
  isResizing,
  isNewlyCreated = false,
  isInlineEditing = false,
  dragOffset,
  onTextPointerDown,
  onTextResizePointerDown,
  onEditText,
  onStartInlineEdit,
  onCommitInlineText,
  onCancelInlineEdit,
  onOpenContextMenu,
}: FreeTextCardProps) {
  const step = grid.cellSize + grid.gap;
  const left = widget.x * step;
  const top = widget.y * step;
  const width = widget.w * grid.cellSize + Math.max(0, widget.w - 1) * grid.gap;
  const height = widget.h * grid.cellSize + Math.max(0, widget.h - 1) * grid.gap;
  const isActivelyDragged = Boolean(dragOffset);

  const prevDraggedRef = useRef(false);
  const [suppressDropTransition, setSuppressDropTransition] = useState(false);
  const [draftText, setDraftText] = useState(widget.text);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isInlineEditing) {
      setDraftText(widget.text);
      const raf = window.requestAnimationFrame(() => {
        textAreaRef.current?.focus();
        textAreaRef.current?.select();
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [isInlineEditing, widget.text]);

  const commitText = () => {
    const trimmed = draftText.trim();
    if (trimmed) {
      onCommitInlineText?.(widget, trimmed);
    } else {
      setDraftText(widget.text);
      onCancelInlineEdit?.();
    }
  };

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

  const fontWeight = widget.weight === 'normal' ? 400 : widget.weight === 'semibold' ? 600 : 700;

  return (
    <div
      data-text-id={widget.id}
      onPointerDown={editMode && !isInlineEditing ? (e) => onTextPointerDown(e, widget) : undefined}
      onDoubleClick={
        editMode && !isInlineEditing
          ? (e) => {
              e.stopPropagation();
              if (onStartInlineEdit) onStartInlineEdit(widget.id);
              else onEditText(widget);
            }
          : undefined
      }
      onContextMenu={
        editMode && onOpenContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenContextMenu(e, { kind: 'widget', widget });
            }
          : undefined
      }
      style={{
        position: 'absolute',
        left,
        top,
        width,
        minHeight: height,
        transform: isActivelyDragged
          ? `translate3d(${dragOffset!.dxPx}px, ${dragOffset!.dyPx}px, 0)`
          : undefined,
        transition: skipTransition
          ? 'none'
          : 'left 160ms cubic-bezier(0.22, 1, 0.36, 1), top 160ms cubic-bezier(0.22, 1, 0.36, 1), width 120ms ease',
        willChange: isActivelyDragged ? 'transform' : undefined,
        zIndex: isActivelyDragged ? 35 : isInlineEditing ? 30 : 14,
      }}
      className={`group rounded-2xl px-2 py-1 select-none ${
        isNewlyCreated ? 'newly-created-pulse' : ''
      } ${
        editMode
          ? `pointer-events-auto ${isInlineEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'} ${
              isSelected || isResizing || isInlineEditing
                ? 'border border-[var(--accent-orange)] bg-[var(--accent-orange)]/6'
                : 'border border-dashed border-transparent hover:border-[var(--border-strong)] hover:bg-[var(--bg-card)]/35'
            }`
          : 'pointer-events-none'
      }`}
    >
      {editMode && isInlineEditing ? (
        <textarea
          ref={textAreaRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              commitText();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraftText(widget.text);
              onCancelInlineEdit?.();
            }
          }}
          onBlur={commitText}
          rows={Math.max(1, draftText.split('\n').length)}
          style={{
            fontSize: widget.fontSize,
            color: widget.color || 'var(--ink-main)',
            fontWeight,
            textAlign: widget.align,
            lineHeight: 1.3,
          }}
          className="w-full min-h-full resize-none bg-transparent outline-none select-text overflow-hidden"
        />
      ) : (
        <div
          style={{
            fontSize: widget.fontSize,
            color: widget.color || 'var(--ink-main)',
            fontWeight,
            textAlign: widget.align,
            lineHeight: 1.3,
          }}
          className="whitespace-pre-wrap break-words"
        >
          {widget.text || '自由文字'}
        </div>
      )}

      {editMode && !isInlineEditing && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditText(widget);
            }}
            className="opacity-0 group-hover:opacity-100 absolute -top-2.5 right-2 h-6 w-6 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--ink-secondary)] hover:text-[var(--ink-main)] shadow-xs cursor-pointer"
            title="编辑文字样式与详情"
          >
            <Pencil size={10} />
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onTextResizePointerDown(e, widget);
            }}
            className={`opacity-0 group-hover:opacity-100 absolute -bottom-2 -right-2 h-5 w-5 rounded-md flex items-center justify-center cursor-nwse-resize border transition-colors ${
              isResizing
                ? '!opacity-100 bg-[var(--accent-orange)] text-white border-transparent'
                : 'bg-[var(--bg-card)] text-[var(--ink-muted)] border-[var(--border-hair)] hover:bg-[var(--accent-orange)] hover:text-white shadow-sm'
            }`}
            title="调整文本框范围"
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
