import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

interface MarqueeTextProps {
  text: string;
  className?: string;
}

export function MarqueeText({ text, className = '' }: MarqueeTextProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [scrollDist, setScrollDist] = useState(0);

  const activateIfOverflow = useCallback(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const diff = Math.ceil(inner.scrollWidth - outer.clientWidth);
    if (diff > 2) {
      setScrollDist(diff + 4);
    } else {
      setScrollDist(0);
    }
  }, []);

  const deactivate = useCallback(() => {
    setScrollDist(0);
  }, []);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const host = outer.closest('[data-marquee-host]') as HTMLElement | null;
    if (!host) return;

    host.addEventListener('pointerenter', activateIfOverflow);
    host.addEventListener('pointerleave', deactivate);
    return () => {
      host.removeEventListener('pointerenter', activateIfOverflow);
      host.removeEventListener('pointerleave', deactivate);
    };
  }, [activateIfOverflow, deactivate, text]);

  const active = scrollDist > 0;
  const durationSec = Math.max(1.8, Math.min(8, scrollDist / 34));
  const style: CSSProperties | undefined = active
    ? ({
        '--marquee-offset': `-${scrollDist}px`,
        '--marquee-duration': `${durationSec.toFixed(2)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      ref={outerRef}
      onPointerEnter={activateIfOverflow}
      onPointerLeave={deactivate}
      className={`overflow-hidden whitespace-nowrap min-w-0 ${className}`}
    >
      <span
        ref={innerRef}
        style={style}
        className={active ? 'inline-block align-top marquee-active' : 'block truncate'}
      >
        {text}
      </span>
    </div>
  );
}
