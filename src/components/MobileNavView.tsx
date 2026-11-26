import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import {
  ExternalLink,
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

  const pillRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Build ordered category tabs: Position 2 — desktop standalone items merged as first "常用" tab, then folders
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

  // Smoothly keep the selected category pill centered inside the sticky tab bar
  useEffect(() => {
    if (!activeTab || query.trim()) return;
    const btn = pillRefs.current.get(activeTab.id);
    btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeTab, query]);

  const selectTab = (tabId: string) => {
    setActiveTabId(tabId);
    try {
      sessionStorage.setItem(MOBILE_TAB_STORAGE_KEY, tabId);
    } catch {
      // Ignore storage quota errors
    }
  };

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

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  const searchResults = useMemo(() => {
    if (!isSearching) {
      return { matchedTabs: [] as MobileCategoryTab[], matchedItems: [] as Array<{ item: BookmarkItem; categoryTitle: string; isPrivate: boolean; score: number }> };
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
    if (isSearching || tabs.length <= 1 || e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || isSearching || tabs.length <= 1 || e.changedTouches.length === 0) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    // Require strong horizontal swipe intent so vertical scrolling is never hijacked
    if (Math.abs(dx) < 52 || Math.abs(dx) <= Math.abs(dy) * 1.6) return;

    if (dx < 0 && resolvedTabIndex < tabs.length - 1) {
      selectTab(tabs[resolvedTabIndex + 1].id);
    } else if (dx > 0 && resolvedTabIndex > 0) {
      selectTab(tabs[resolvedTabIndex - 1].id);
    }
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
          <div
            className={`rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0 ${
              mode === 'grid' ? 'h-10 w-10' : 'h-10 w-10'
            }`}
          >
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

  return (
    <div
      className={`relative h-full w-full overflow-hidden text-[var(--ink-main)] ${
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

      <div className="relative h-full w-full overflow-y-auto overscroll-y-contain pb-8">
      {/* Layer 1: Minimal Top Bar */}
      <header className="px-3.5 pt-3.5 pb-2 flex items-center justify-between gap-2 max-w-2xl mx-auto">
        <div className="min-w-0 flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: 'var(--accent-orange)' }}
          />
          <span className="text-[15px] font-bold tracking-tight truncate">
            {settings.siteTitle}
          </span>
          {settings.homeLinkEnabled && settings.homeLinkUrl && (
            <a
              href={settings.homeLinkUrl}
              target={settings.openTarget}
              rel={settings.openTarget === '_blank' ? 'noopener noreferrer' : undefined}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-card)]/85 border border-[var(--border-hair)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-secondary)] shrink-0"
            >
              <span>{settings.homeLinkLabel || 'home'}</span>
              <ExternalLink size={10} />
            </a>
          )}
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

      {/* Layer 2: Embedded Instant Search Box */}
      <div className="px-3.5 pb-2.5 max-w-2xl mx-auto">
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

      {/* Layer 3: Sticky Horizontal Category Tabs (hidden while searching) */}
      {!isSearching && tabs.length > 0 && (
        <nav
          aria-label="书签分类"
          className="sticky top-0 z-20 backdrop-blur-md bg-[var(--bg-canvas)]/82 border-b border-[var(--border-hair)]/70"
        >
          <div className="max-w-2xl mx-auto px-3.5 py-2 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => {
              const isActive = activeTab?.id === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    if (el) pillRefs.current.set(tab.id, el);
                    else pillRefs.current.delete(tab.id);
                  }}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[var(--ink-main)] text-[var(--bg-card)] shadow-sm'
                      : tab.isPrivate
                        ? 'bg-gradient-to-r from-orange-500/12 to-amber-500/10 border border-orange-500/35 text-[var(--ink-main)]'
                        : 'bg-[var(--bg-card)]/90 border border-[var(--border-hair)] text-[var(--ink-secondary)]'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: tab.isPrivate
                        ? '#ff5500'
                        : tab.accent || 'var(--accent-orange)',
                    }}
                  />
                  {tab.isPrivate && (
                    <Lock
                      size={11}
                      className={isActive ? 'text-amber-300 shrink-0' : 'text-amber-500 shrink-0'}
                    />
                  )}
                  <span>{tab.title}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Layer 4: Search Results OR Single-Category Paged Area with Horizontal Swipe */}
      <main className="max-w-2xl mx-auto px-3.5 pt-3.5">
        {loading ? (
          <div className="py-20 text-center text-sm text-[var(--ink-muted)]">正在加载书签...</div>
        ) : isSearching ? (
          <div className="space-y-4">
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
        ) : !activeTab ? (
          <div className="py-20 text-center space-y-3">
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
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="min-h-[calc(100dvh-210px)] flex flex-col justify-between gap-6"
          >
            <div className="space-y-4">
              {activeTab.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)]/60 py-14 px-4 text-center space-y-2.5">
                  <p className="text-xs text-[var(--ink-muted)]">该分类下暂无书签</p>
                  {unlocked && (
                    <button
                      type="button"
                      onClick={() =>
                        onCreateItem(activeTab.kind === 'folder' ? activeTab.id : null)
                      }
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
                  {activeTab.items.map((item) => renderBookmarkCard(item, layoutMode))}
                </div>
              )}

              {unlocked && activeTab.folder && onEditFolder && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => onEditFolder(activeTab.folder!)}
                    className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium bg-[var(--bg-card)]/85 border border-[var(--border-hair)] text-[var(--ink-secondary)] hover:text-[var(--ink-main)] cursor-pointer"
                  >
                    <FolderCog size={13} />
                    <span>编辑此分类</span>
                  </button>
                </div>
              )}
            </div>

            {tabs.length > 1 && (
              <footer className="pt-2 pb-2 flex flex-col items-center gap-2 select-none">
                {tabs.length <= 14 && (
                  <div className="flex items-center gap-1.5">
                    {tabs.map((tab, idx) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => selectTab(tab.id)}
                        aria-label={`切换到 ${tab.title}`}
                        className={`h-1.5 rounded-full transition-all cursor-pointer ${
                          idx === resolvedTabIndex
                            ? 'w-4 bg-[var(--ink-main)]'
                            : 'w-1.5 bg-[var(--border-strong)]'
                        }`}
                      />
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-[var(--ink-muted)]/80">
                  {resolvedTabIndex + 1} / {tabs.length} · 左右滑动切换分类
                </div>
              </footer>
            )}
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
