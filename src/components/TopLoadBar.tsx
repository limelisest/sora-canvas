import { useTopLoadState } from '../utils/loadTracker';

export function TopLoadBar() {
  const { visible, percent } = useTopLoadState();

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[2.5px] z-[80] pointer-events-none"
    >
      <div
        style={{
          width: `${percent}%`,
          opacity: visible ? 1 : 0,
          transition: 'width 220ms ease-out, opacity 320ms ease',
          background:
            'linear-gradient(90deg, color-mix(in srgb, var(--accent-orange) 72%, #fb923c), var(--accent-orange), #fbbf24)',
          boxShadow: '0 0 8px color-mix(in srgb, var(--accent-orange) 55%, transparent)',
        }}
        className="h-full rounded-r-full"
      />
    </div>
  );
}
