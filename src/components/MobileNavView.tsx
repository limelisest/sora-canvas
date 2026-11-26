import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { flushSync } from 'react-dom';
import {
  Check,
  ChevronUp,
  FolderCog,
  LayoutGrid,
  List,
  Lock,
  Map as MapIcon,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sun,
  Unlock,
  X,
} from 'lucide-react';
import type { BookmarkItem, FolderContainer, SiteSettings } from '../../shared/types';
import { fuzzyScore } from '../../shared/pinyin';
import { IconGlyph } from './IconGlyph';

type MobileLayoutMode = 'grid' | 'list';

interface MobileCategoryTab {
  id: string;
  kind: 'root' | 'folder';
  title: string;
  accent?: string;
  isPrivate: boolean;
  folder?: FolderContainer;
  items: BookmarkItem[];
}

interface MobileNavViewProps {
  settings: SiteSettings;
  folders: FolderContainer[];
  items: BookmarkItem[];
  loading?: boolean;
  unlocked: boolean;
  hasPrivateHidden: boolean;
  dark: boolean;
  onToggleDark: () => void;
  onLockToggle: () => void;
  onSwitchToCanvas: () => void;
  onOpenSettings: () => void;
  onCreateItem: (defaultParentId: string | null) => void;
  onEditItem: (item: BookmarkItem) => void;
  onEditFolder?: (folder: FolderContainer) => void;
}

const MOBILE_TAB_STORAGE_KEY = 'neko-like-mobile-tab';
const MOBILE_LAYOUT_STORAGE_KEY = 'neko-like-mobile-layout';

function compareReadingOrder(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.y - b.y) > 0.4 ? a.y - b.y : a.x - b.x;
}

function formatCleanHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function MobileNavView({
  settings,
  folders,
  items,
  loading = false,
  unlocked,
  hasPrivateHidden,
  dark,
  onToggleDark,
  onLockToggle,
  onSwitchToCanvas,
  onOpenSettings,
  onCreateItem,
  onEditItem,
  onEditFolder,
}: MobileNavViewProps) {
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<MobileLayoutMode>(() => {
    try {
      return localStorage.getItem(MOBILE_LAYOUT_STORAGE_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      return sessionStorage.getItem(MOBILE_TAB_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const pagerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pickerItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const swipeRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    axis: 'x' | 'y' | null;
    lastDx: number;
  } | null>(null);

  const animRef = useRef<{
    targetTabId: string | null;
    timerId: number;
  } | null>(null);
  const pendingResetRef = useRef(false);

  // Build ordered category tabs: desktop standalone items merged as first "常用" tab, then folders
  const tabs = useMemo<MobileCategoryTab[]>(() => {
    const list: MobileCategoryTab[] = [];
    const rootItems = items.filter((i) => i.parentId === null).sort(compareReadingOrder);
    if (rootItems.length > 0) {
      list.push({
        id: '__root__',
        kind: 'root',
        title: '常用',
        accent: settings.brandAccent,
        isPrivate: false,
        items: rootItems,
      });
    }

    const itemsByFolder = new Map<string, BookmarkItem[]>();
    for (const item of items) {
      if (!item.parentId) continue;
      const bucket = itemsByFolder.get(item.parentId);
      if (bucket) bucket.push(item);
      else itemsByFolder.set(item.parentId, [item]);
    }
    for (const bucket of itemsByFolder.values()) {
      bucket.sort((a, b) => a.order - b.order);
    }

    const sortedFolders = [...folders].sort(compareReadingOrder);
    for (const folder of sortedFolders) {
      list.push({
        id: folder.id,
        kind: 'folder',
        title: folder.title,
        accent: folder.accent,
        isPrivate: folder.isPrivate,
        folder,
        items: itemsByFolder.get(folder.id) ?? [],
      });
    }

    return list;
  }, [folders, items, settings.brandAccent]);

  const resolvedTabIndex = useMemo(() => {
    if (tabs.length === 0) return -1;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    return idx >= 0 ? idx : 0;
  }, [tabs, activeTabId]);

  const activeTab = resolvedTabIndex >= 0 ? tabs[resolvedTabIndex] : null;
  const prevTab = resolvedTabIndex > 0 ? tabs[resolvedTabIndex - 1] : null;
  const nextTab =
    resolvedTabIndex >= 0 && resolvedTabIndex < tabs.length - 1
      ? tabs[resolvedTabIndex + 1]
      : null;

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    try {
      sessionStorage.setItem(MOBILE_TAB_STORAGE_KEY, tabId);
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  // Keep persisted activeTabId valid (e.g. fall back cleanly when locking hides a private folder)
  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.id !== activeTabId) {
      setActiveTabId(activeTab.id);
    }
    try {
      sessionStorage.setItem(MOBILE_TAB_STORAGE_KEY, activeTab.id);
    } catch {
      // Ignore storage quota errors
    }
  }, [activeTab, activeTabId]);

  // Reset track transform in the exact commit frame after switching activeTabId
  useLayoutEffect(() => {
    if (!pendingResetRef.current) return;
    pendingResetRef.current = false;
    const track = trackRef.current;
    if (track) {
      track.style.transition = 'none';
      track.style.transform = 'translate3d(0, 0, 0)';
    }
  }, [activeTab?.id]);

  // Scroll the active category row into view when the bottom picker opens
  useEffect(() => {
    if (!pickerOpen || !activeTab) return;
    const btn = pickerItemRefs.current.get(activeTab.id);
    btn?.scrollIntoView({ block: 'nearest' });
  }, [pickerOpen, activeTab]);

  // Close picker and clear active timers on search or unmount
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  useEffect(() => {
    if (isSearching && pickerOpen) {
      setPickerOpen(false);
    }
  }, [isSearching, pickerOpen]);

  useEffect(() => {
    return () => {
      if (animRef.current) {
        window.clearTimeout(animRef.current.timerId);
        animRef.current = null;
      }
    };
  }, []);

  const settlePendingAnimation = useCallback(
    (synchronous = false) => {
      const pending = animRef.current;
      if (!pending) return;
      animRef.current = null;
      window.clearTimeout(pending.timerId);

      const track = trackRef.current;
      if (pending.targetTabId) {
        pendingResetRef.current = true;
        if (synchronous) {
          flushSync(() => {
            selectTab(pending.targetTabId!);
          });
          if (track) {
            track.style.transition = 'none';
            track.style.transform = 'translate3d(0, 0, 0)';
            pendingResetRef.current = false;
          }
        } else {
          selectTab(pending.targetTabId);
        }
      } else if (track) {
        track.style.transition = 'none';
        track.style.transform = 'translate3d(0, 0, 0)';
      }
    },
    [selectTab]
  );

  const toggleLayoutMode = () => {
    setLayoutMode((prev) => {
      const next: MobileLayoutMode = prev === 'grid' ? 'list' : 'grid';
      try {
        localStorage.setItem(MOBILE_LAYOUT_STORAGE_KEY, next);
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  };

  const searchResults = useMemo(() => {
    if (!isSearching) {
      return {
        matchedTabs: [] as MobileCategoryTab[],
        matchedItems: [] as Array<{
          item: BookmarkItem;
          categoryTitle: string;
          isPrivate: boolean;
          score: number;
        }>,
      };
    }
    const tabMap = new Map(tabs.map((t) => [t.id, t]));
    const matchedTabs = tabs
      .map((t) => ({ tab: t, score: fuzzyScore(trimmedQuery, t.title) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.tab);

    const matchedItems: Array<{
      item: BookmarkItem;
      categoryTitle: string;
      isPrivate: boolean;
      score: number;
    }> = [];

    for (const item of items) {
      const parentTab = item.parentId ? tabMap.get(item.parentId) : tabMap.get('__root__');
      const categoryTitle = parentTab?.title ?? '常用';
      const score = fuzzyScore(
        trimmedQuery,
        item.title,
        item.subtitle,
        item.url,
        categoryTitle,
        ...(item.tags ?? [])
      );
      if (score > 0) {
        matchedItems.push({
          item,
          categoryTitle,
          isPrivate: Boolean(parentTab?.isPrivate),
          score,
        });
      }
    }

    matchedItems.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-CN'));
    return { matchedTabs, matchedItems };
  }, [isSearching, items, tabs, trimmedQuery]);

  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (pickerOpen || isSearching || tabs.length === 0 || e.touches.length !== 1) {
      swipeRef.current = null;
      return;
    }
    if (animRef.current) {
      settlePendingAnimation(true);
    }
    const t = e.touches[0];
    swipeRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startTime: performance.now(),
      axis: null,
      lastDx: 0,
    };
  };

  const handleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - s.startX;
    const dy = t.clientY - s.startY;

    if (s.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 8) return;
      s.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
    }

    if (s.axis !== 'x') return;

    s.lastDx = dx;
    const isOutOfBounds = (dx > 0 && !prevTab) || (dx < 0 && !nextTab);
    const visualDx = isOutOfBounds ? dx * 0.28 : dx;

    const track = trackRef.current;
    if (track) {
      track.style.transition = 'none';
      track.style.transform = `translate3d(${visualDx}px, 0, 0)`;
    }
  };

  const finishSwipe = (cancelled: boolean) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || s.axis !== 'x') return;

    const track = trackRef.current;
    if (!track) return;

    const dx = s.lastDx;
    const elapsed = Math.max(1, performance.now() - s.startTime);
    const vx = dx / elapsed;
    const width = pagerRef.current?.clientWidth || window.innerWidth || 360;

    const targetTab =
      !cancelled && (Math.abs(dx) > width * 0.22 || (Math.abs(dx) > 24 && Math.abs(vx) > 0.35))
        ? dx < 0
          ? nextTab
          : prevTab
        : null;

    track.style.transition = 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1)';
    track.style.transform = targetTab
      ? `translate3d(${dx < 0 ? '-100%' : '100%'}, 0, 0)`
      : 'translate3d(0, 0, 0)';

    const timerId = window.setTimeout(() => {
      settlePendingAnimation(false);
    }, 225);
    animRef.current = {
      targetTabId: targetTab?.id ?? null,
      timerId,
    };
  };

  const useWallpaper = settings.canvasBgStyle === 'wallpaper' && Boolean(settings.customBgUrl);
  const useAurora = settings.canvasBgStyle === 'aurora' && !useWallpaper;

  const renderBookmarkCard = (
    item: BookmarkItem,
    mode: MobileLayoutMode,
    badgeLabel?: string
  ) => {
    const host = formatCleanHost(item.url);
    const sub = item.subtitle?.trim() || host;

    return (
      <div
        key={item.id}
        className={`relative bento-card overflow-hidden ${
          useWallpaper ? 'bento-card-glass' : ''
        } ${mode === 'grid' ? 'rounded-[20px]' : 'rounded-[18px]'}`}
      >
        <a
          href={item.url}
          target={settings.openTarget}
          rel={settings.openTarget === '_blank' ? 'noopener noreferrer' : undefined}
          className={`flex items-center gap-3 active:scale-[0.99] transition-transform ${
            mode === 'grid' ? 'p-3' : 'px-3.5 py-3'
          } ${unlocked ? 'pr-10' : ''}`}
        >
          <div className="h-10 w-10 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
            <IconGlyph
              icon={item.icon}
              faviconUrl={item.faviconUrl}
              title={item.title}
              accent={item.accent}
              size={20}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13.5px] font-semibold leading-snug text-[var(--ink-main)] truncate">
                {item.title}
              </span>
              {badgeLabel && (
                <span className="shrink-0 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hair)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink-secondary)]">
                  {badgeLabel}
                </span>
              )}
            </div>
            <div className="text-[11px] leading-tight text-[var(--ink-muted)] truncate mt-0.5">
              {sub}
            </div>
            {mode === 'list' && item.subtitle?.trim() && host && item.subtitle.trim() !== host && (
              <div className="text-[10.5px] text-[var(--ink-muted)]/75 truncate mt-0.5 font-mono">
                {host}
              </div>
            )}
          </div>
        </a>

        {unlocked && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEditItem(item);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] active:bg-[var(--bg-subtle)] cursor-pointer"
            title="编辑书签"
            aria-label={`编辑 ${item.title}`}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
    );
  };

  const renderCategoryPanel = (tab: MobileCategoryTab, offsetPct: string) => (
    <section
      key={tab.id}
      style={{ left: offsetPct }}
      className="absolute top-0 bottom-0 w-full overflow-y-auto overscroll-y-contain px-3.5 pt-2 pb-24"
    >
      <div className="max-w-2xl mx-auto space-y-4">
        {tab.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)]/60 py-14 px-4 text-center space-y-2.5">
            <p className="text-xs text-[var(--ink-muted)]">该分类下暂无书签</p>
            {unlocked && (
              <button
                type="button"
                onClick={() => onCreateItem(tab.kind === 'folder' ? tab.id : null)}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-orange)] px-3.5 py-1.5 text-xs font-medium text-white cursor-pointer"
              >
                <Plus size={13} />
                <span>添加到此分类</span>
              </button>
            )}
          </div>
        ) : (
          <div
            className={
              layoutMode === 'grid' ? 'grid grid-cols-2 gap-2.5' : 'flex flex-col gap-2'
            }
          >
            {tab.items.map((item) => renderBookmarkCard(item, layoutMode))}
          </div>
        )}

        {unlocked && tab.folder && onEditFolder && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => onEditFolder(tab.folder!)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium bg-[var(--bg-card)]/85 border border-[var(--border-hair)] text-[var(--ink-secondary)] hover:text-[var(--ink-main)] cursor-pointer"
            >
              <FolderCog size={13} />
              <span>编辑此分类</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div
      className={`relative h-full w-full overflow-hidden flex flex-col text-[var(--ink-main)] ${
        useAurora ? 'canvas-bg-aurora' : 'bg-[var(--bg-canvas)]'
      }`}
    >
      {useWallpaper && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none bg-cover bg-center"
            style={{ backgroundImage: `url(${settings.customBgUrl})` }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none bg-[var(--bg-canvas)]/38"
          />
        </>
      )}

      {/* Top Fixed Area: Minimal Header + Embedded Instant Search */}
      <div className="relative z-20 shrink-0">
        <header className="px-3.5 pt-3.5 pb-2 flex items-center justify-between gap-2 max-w-2xl mx-auto">
          <div className="min-w-0 flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--accent-orange)' }}
            />
            <span className="text-[15px] font-bold tracking-tight truncate">
              {settings.siteTitle}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onLockToggle}
              className={`relative inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium border transition-colors cursor-pointer ${
                unlocked
                  ? 'bg-amber-500/12 border-amber-500/30 text-amber-600 dark:text-amber-400'
                  : 'bg-[var(--bg-card)]/90 border-[var(--border-hair)] text-[var(--ink-secondary)]'
              }`}
              title={unlocked ? '上锁并隐藏私密内容' : '解锁管理与私密分类'}
            >
              {unlocked ? <Unlock size={13} /> : <Lock size={13} />}
              {unlocked && <span>上锁</span>}
              {!unlocked && hasPrivateHidden && (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-orange)]" />
              )}
            </button>

            {unlocked && (
              <button
                type="button"
                onClick={() => onCreateItem(activeTab?.kind === 'folder' ? activeTab.id : null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-orange)] text-white shadow-sm cursor-pointer"
                title="快速新增书签"
                aria-label="快速新增书签"
              >
                <Plus size={15} />
              </button>
            )}

            <button
              type="button"
              onClick={toggleLayoutMode}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-card)]/90 border border-[var(--border-hair)] text-[var(--ink-secondary)] cursor-pointer"
              title={layoutMode === 'grid' ? '切换为单列列表' : '切换为双列卡片'}
              aria-label="切换卡片列数"
            >
              {layoutMode === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
            </button>

            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-card)]/90 border border-[var(--border-hair)] text-[var(--ink-secondary)] cursor-pointer"
              title="切换深浅色主题"
              aria-label="切换深浅色主题"
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            <button
              type="button"
              onClick={onSwitchToCanvas}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-card)]/90 border border-[var(--border-hair)] text-[var(--ink-secondary)] cursor-pointer"
              title="切换至二维画布视图"
              aria-label="切换至二维画布视图"
            >
              <MapIcon size={14} />
            </button>

            {unlocked && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-card)]/90 border border-[var(--border-hair)] text-[var(--ink-secondary)] cursor-pointer"
                title="站点设置"
                aria-label="站点设置"
              >
                <Settings size={14} />
              </button>
            )}
          </div>
        </header>

        <div className="px-3.5 pb-2 max-w-2xl mx-auto">
          <div className="relative flex items-center rounded-2xl bg-[var(--bg-card)]/92 backdrop-blur-md border border-[var(--border-hair)] shadow-sm focus-within:border-[var(--accent-orange)] transition-colors">
            <Search size={15} className="ml-3.5 text-[var(--ink-muted)] shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书签、域名、拼音首字母或分类..."
              className="w-full bg-transparent px-2.5 py-2.5 text-[13.5px] text-[var(--ink-main)] placeholder:text-[var(--ink-muted)] outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mr-2 h-7 w-7 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] cursor-pointer shrink-0"
                aria-label="清空搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area: Search Results OR Full-Width 1:1 Interactive Swipe Pager */}
      <main className="relative flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="h-full w-full flex items-center justify-center text-sm text-[var(--ink-muted)]">
            正在加载书签...
          </div>
        ) : isSearching ? (
          <div className="h-full w-full overflow-y-auto overscroll-y-contain px-3.5 pt-2 pb-24">
            <div className="max-w-2xl mx-auto space-y-4">
              {searchResults.matchedTabs.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-[var(--ink-muted)] px-0.5">
                    分类快捷跳转
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {searchResults.matchedTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setQuery('');
                          selectTab(tab.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--bg-card)] border border-[var(--border-hair)] text-[var(--ink-main)] shadow-sm cursor-pointer"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: tab.isPrivate
                              ? '#ff5500'
                              : tab.accent || 'var(--accent-orange)',
                          }}
                        />
                        {tab.isPrivate && <Lock size={11} className="text-amber-500 shrink-0" />}
                        <span>{tab.title}</span>
                        <span className="text-[10px] text-[var(--ink-muted)]">
                          ({tab.items.length})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.matchedItems.length === 0 ? (
                searchResults.matchedTabs.length === 0 && (
                  <div className="py-16 text-center text-xs text-[var(--ink-muted)]">
                    没有找到匹配 “{trimmedQuery}” 的书签或分类
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-[var(--ink-muted)] px-0.5">
                    匹配书签 ({searchResults.matchedItems.length})
                  </div>
                  <div className="flex flex-col gap-2">
                    {searchResults.matchedItems.map((entry) =>
                      renderBookmarkCard(entry.item, 'list', entry.categoryTitle)
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : !activeTab ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-sm text-[var(--ink-muted)]">当前暂无可展示的书签分类</p>
            {unlocked && (
              <button
                type="button"
                onClick={() => onCreateItem(null)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-orange)] px-4 py-2 text-xs font-medium text-white cursor-pointer"
              >
                <Plus size={14} />
                <span>新建第一个书签</span>
              </button>
            )}
          </div>
        ) : (
          <div
            ref={pagerRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => finishSwipe(false)}
            onTouchCancel={() => finishSwipe(true)}
            style={{ touchAction: 'pan-y' }}
            className="relative h-full w-full overflow-hidden"
          >
            <div
              ref={trackRef}
              onTransitionEnd={(e) => {
                if (e.target === trackRef.current && e.propertyName === 'transform') {
                  settlePendingAnimation(false);
                }
              }}
              style={{ willChange: 'transform' }}
              className="relative h-full w-full"
            >
              {prevTab && renderCategoryPanel(prevTab, '-100%')}
              {renderCategoryPanel(activeTab, '0%')}
              {nextTab && renderCategoryPanel(nextTab, '100%')}
            </div>
          </div>
        )}
      </main>

      {/* Bottom-Center Category Picker Popover */}
      {!isSearching && !loading && tabs.length > 0 && pickerOpen && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setPickerOpen(false)}
            className="fixed inset-0 z-40 bg-black/28 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-label="选择分类"
            className="fixed left-1/2 -translate-x-1/2 bottom-[calc(4.1rem+env(safe-area-inset-bottom))] z-50 w-[min(310px,calc(100vw-28px))] max-h-[56dvh] flex flex-col bento-modal overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border-hair)] shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--ink-main)]">选择分类</span>
                <span className="text-[11px] text-[var(--ink-muted)]">共 {tabs.length} 类</span>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="h-6 w-6 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] cursor-pointer"
                aria-label="关闭分类列表"
              >
                <X size={13} />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-y-contain p-2 flex flex-col gap-1">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab?.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      if (el) pickerItemRefs.current.set(tab.id, el);
                      else pickerItemRefs.current.delete(tab.id);
                    }}
                    type="button"
                    onClick={() => {
                      settlePendingAnimation(true);
                      selectTab(tab.id);
                      setPickerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[var(--bg-subtle)] text-[var(--ink-main)] font-semibold'
                        : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]/65 hover:text-[var(--ink-main)]'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: tab.isPrivate
                            ? '#ff5500'
                            : tab.accent || 'var(--accent-orange)',
                        }}
                      />
                      {tab.isPrivate && <Lock size={11} className="text-amber-500 shrink-0" />}
                      <span className="truncate">{tab.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono text-[var(--ink-muted)]">
                        {tab.items.length}
                      </span>
                      {isActive && <Check size={14} className="text-[var(--accent-orange)]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Bottom-Center Floating Category Pill */}
      {!isSearching && !loading && activeTab && (
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 pill-surface rounded-full pl-3.5 pr-3 py-2 shadow-lg flex items-center gap-2 text-[13px] font-semibold cursor-pointer active:scale-95 transition-transform max-w-[calc(100vw-32px)]"
          aria-expanded={pickerOpen}
          aria-label="切换书签分类"
        >
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{
              backgroundColor: activeTab.isPrivate
                ? '#ff5500'
                : activeTab.accent || 'var(--accent-orange)',
            }}
          />
          {activeTab.isPrivate && <Lock size={11} className="text-amber-500 shrink-0" />}
          <span className="truncate max-w-[150px] text-[var(--ink-main)]">{activeTab.title}</span>
          <span className="text-[11px] font-medium text-[var(--ink-muted)] tabular-nums shrink-0">
            {resolvedTabIndex + 1}/{tabs.length}
          </span>
          <ChevronUp
            size={14}
            className={`text-[var(--ink-muted)] shrink-0 transition-transform duration-150 ${
              pickerOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}
    </div>
  );
}
