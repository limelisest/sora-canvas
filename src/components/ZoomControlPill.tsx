import { Minus, Plus } from 'lucide-react';
import { MAX_VIEW_SCALE, MIN_VIEW_SCALE } from '../utils/viewport';

interface ZoomControlPillProps {
  scale: number;
  editMode: boolean;
  anchorMode?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}

export function ZoomControlPill({
  scale,
  editMode,
  anchorMode = true,
  onZoomIn,
  onZoomOut,
  onResetView,
}: ZoomControlPillProps) {
  const pct = Math.round(scale * 100);
  const atMax = scale >= MAX_VIEW_SCALE - 0.001;
  const atMin = scale <= MIN_VIEW_SCALE + 0.001;

  return (
    <div
      className={`fixed right-4 z-30 transition-[bottom] duration-200 ${
        editMode ? 'bottom-24 sm:bottom-5' : 'bottom-5'
      }`}
    >
      <div className="pill-surface !rounded-2xl flex flex-col items-stretch w-12 overflow-hidden divide-y divide-[var(--border-hair)]">
        <button
          type="button"
          onClick={onZoomIn}
          disabled={atMax}
          className="h-9 flex items-center justify-center text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] disabled:opacity-35 transition-colors cursor-pointer disabled:cursor-default"
          aria-label="放大 +25%"
          title="放大 +25%"
        >
          <Plus size={14} />
        </button>

        <button
          type="button"
          onClick={onResetView}
          className="h-8 flex items-center justify-center px-1 text-[11px] font-mono font-semibold tabular-nums text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          aria-label={anchorMode ? '重置为 100% 并回到视野锚点' : '重置为自适应缩放全览视图'}
          title={anchorMode ? '点击还原 100% 并回到视野锚点' : '点击还原自适应缩放全览视图'}
        >
          {pct}%
        </button>

        <button
          type="button"
          onClick={onZoomOut}
          disabled={atMin}
          className="h-9 flex items-center justify-center text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] disabled:opacity-35 transition-colors cursor-pointer disabled:cursor-default"
          aria-label="缩小 -25%"
          title="缩小 -25%"
        >
          <Minus size={14} />
        </button>
      </div>
    </div>
  );
}
