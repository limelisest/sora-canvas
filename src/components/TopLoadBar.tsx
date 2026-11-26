import { useTopLoadState } from '../utils/loadTracker';

export function TopLoadBar() {
  const { visible, percent, label } = useTopLoadState();

  return (
    <div
      aria-live="polite"
      className={`fixed top-3.5 left-1/2 -translate-x-1/2 z-[80] pointer-events-none transition-all duration-250 ease-out ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-2 scale-95'
      }`}
    >
      <div className="pill-surface rounded-full px-3.5 py-1.5 shadow-lg flex items-center gap-2.5 text-xs font-medium whitespace-nowrap">
        <div className="w-24 sm:w-28 h-2 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hair)] overflow-hidden relative">
          <div
            style={{ width: `${percent}%` }}
            className="h-full rounded-full load-bar-fill transition-[width] duration-220 ease-out"
          />
        </div>
        <span className="h-3 w-px bg-[var(--border-hair)] shrink-0" />
        <span className="text-[11.5px] font-semibold text-[var(--ink-secondary)] min-w-[48px] text-center">
          {label}
        </span>
      </div>
    </div>
  );
}
