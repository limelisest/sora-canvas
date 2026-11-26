import { useEffect, useSyncExternalStore } from 'react';

export type LoadPhase = 'content' | 'icons' | 'media';

export interface TopLoadState {
  phase: LoadPhase;
  percent: number;
  visible: boolean;
  label: string;
}

let cycleId = 0;
let completed = false;
let snapshot: TopLoadState = {
  phase: 'content',
  percent: 25,
  visible: true,
  label: '加载布局',
};

const registered = new Set<string>();
const settled = new Set<string>();
const listeners = new Set<() => void>();

let raf1: number | null = null;
let raf2: number | null = null;
let mediaTimer: number | null = null;
let settleCheckTimer: number | null = null;
let safetyTimer: number | null = null;
let hideTimer: number | null = null;

function resolveLoadLabel(phase: LoadPhase, percent: number): string {
  if (percent >= 100) return '加载完成';
  if (phase === 'content') return '加载布局';

  const mediaPrefix = `${cycleId}:carousel:`;
  const wallPrefix = `${cycleId}:wallpaper:`;
  let hasUnsettledMedia = false;
  for (const key of registered) {
    if (!settled.has(key) && (key.startsWith(mediaPrefix) || key.startsWith(wallPrefix))) {
      hasUnsettledMedia = true;
      break;
    }
  }
  if (phase === 'media' || hasUnsettledMedia) return '加载图片';
  return '加载图标';
}

function emit() {
  for (const l of listeners) l();
}

function setSnapshot(patch: Partial<Omit<TopLoadState, 'label'>>) {
  const nextPhase = patch.phase ?? snapshot.phase;
  const nextPercent = patch.percent ?? snapshot.percent;
  const nextVisible = patch.visible ?? snapshot.visible;
  const nextLabel = resolveLoadLabel(nextPhase, nextPercent);

  if (
    nextPhase === snapshot.phase &&
    nextPercent === snapshot.percent &&
    nextVisible === snapshot.visible &&
    nextLabel === snapshot.label
  ) {
    return;
  }
  snapshot = {
    phase: nextPhase,
    percent: nextPercent,
    visible: nextVisible,
    label: nextLabel,
  };
  emit();
}

function clearTimers() {
  if (typeof window === 'undefined') return;
  if (raf1 !== null) window.cancelAnimationFrame(raf1);
  if (raf2 !== null) window.cancelAnimationFrame(raf2);
  if (mediaTimer !== null) window.clearTimeout(mediaTimer);
  if (settleCheckTimer !== null) window.clearTimeout(settleCheckTimer);
  if (safetyTimer !== null) window.clearTimeout(safetyTimer);
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  raf1 = null;
  raf2 = null;
  mediaTimer = null;
  settleCheckTimer = null;
  safetyTimer = null;
  hideTimer = null;
}

function finishCycle(targetCycle: number) {
  if (targetCycle !== cycleId || completed) return;
  completed = true;
  if (typeof window !== 'undefined') {
    if (settleCheckTimer !== null) {
      window.clearTimeout(settleCheckTimer);
      settleCheckTimer = null;
    }
    if (safetyTimer !== null) {
      window.clearTimeout(safetyTimer);
      safetyTimer = null;
    }
  }
  setSnapshot({ phase: 'media', percent: 100, visible: true });
  if (typeof window !== 'undefined') {
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (targetCycle === cycleId) {
        setSnapshot({ visible: false });
      }
    }, 260);
  }
}

function recalcProgress() {
  if (completed) return;
  if (snapshot.phase === 'media' && registered.size > 0 && settled.size >= registered.size) {
    finishCycle(cycleId);
    return;
  }
  if (snapshot.phase !== 'content' && registered.size > 0) {
    const ratio = Math.min(1, settled.size / registered.size);
    const nextPct = Math.max(snapshot.percent, Math.min(95, 45 + Math.round(ratio * 50)));
    setSnapshot({ percent: nextPct });
  }
}

export function startLoadCycle(): void {
  clearTimers();
  cycleId += 1;
  const myCycle = cycleId;
  completed = false;
  registered.clear();
  settled.clear();

  setSnapshot({ phase: 'content', percent: 25, visible: true });

  if (typeof window === 'undefined') return;

  // Phase 2 unlocks right after the browser paints the core content first frame (double rAF)
  raf1 = window.requestAnimationFrame(() => {
    raf1 = null;
    if (myCycle !== cycleId) return;
    raf2 = window.requestAnimationFrame(() => {
      raf2 = null;
      if (myCycle !== cycleId) return;
      setSnapshot({ phase: 'icons', percent: Math.max(snapshot.percent, 45) });

      // Phase 3 unlocks decorative media (carousel & wallpaper) 120ms after icons start
      mediaTimer = window.setTimeout(() => {
        mediaTimer = null;
        if (myCycle !== cycleId) return;
        setSnapshot({ phase: 'media' });

        settleCheckTimer = window.setTimeout(() => {
          settleCheckTimer = null;
          if (myCycle !== cycleId || completed) return;
          if (registered.size === 0 || settled.size >= registered.size) {
            finishCycle(myCycle);
          }
        }, 80);
      }, 120);
    });
  });

  // Safety cap so a dead third-party favicon never stalls the bar past 3800ms
  safetyTimer = window.setTimeout(() => {
    safetyTimer = null;
    finishCycle(myCycle);
  }, 3800);
}

export function registerTrackedAsset(key: string): void {
  if (!key || completed) return;
  const fullKey = `${cycleId}:${key}`;
  if (!registered.has(fullKey)) {
    registered.add(fullKey);
    recalcProgress();
  }
}

export function markTrackedAssetSettled(key: string): void {
  if (!key || completed) return;
  const fullKey = `${cycleId}:${key}`;
  registered.add(fullKey);
  if (!settled.has(fullKey)) {
    settled.add(fullKey);
    recalcProgress();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TopLoadState {
  return snapshot;
}

export function useLoadPhase(): LoadPhase {
  return useSyncExternalStore(subscribe, () => getSnapshot().phase, () => 'content');
}

export function useTopLoadState(): TopLoadState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useStagedWallpaper(enabled: boolean, url: string | undefined): boolean {
  const phase = useLoadPhase();
  const ready = enabled && Boolean(url) && phase === 'media';

  useEffect(() => {
    if (!ready || !url) return;
    const key = `wallpaper:${url}`;
    registerTrackedAsset(key);
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!cancelled) markTrackedAssetSettled(key);
    };
    img.onerror = () => {
      if (!cancelled) markTrackedAssetSettled(key);
    };
    img.src = url;
    if (img.complete) {
      markTrackedAssetSettled(key);
    }
    return () => {
      cancelled = true;
    };
  }, [ready, url]);

  return ready;
}
