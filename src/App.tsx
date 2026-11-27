import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BookmarkItem,
  CanvasDocument,
  CanvasGridEntity,
  CanvasResponse,
  CanvasWidget,
  CarouselWidget,
  DefaultThemeMode,
  FolderContainer,
  FolderDisplayMode,
  FreeTextWidget,
  MobileDefaultView,
  NoteWidget,
  PublicLayoutConfig,
  SiteSettings,
  ZoneContainer,
} from '../shared/types';
import { DEFAULT_SITE_SETTINGS } from '../shared/settings';
import {
  buildSyncedPublicLayoutFromCanonical,
  mergeLockedLayoutEdit,
  projectPublicCanvas,
  reconcilePublicLayout,
} from '../shared/dualLayout';
import {
  applyEntityLayoutToDoc,
  clampGridSize,
  clampZoneSize,
  findNearestFreeSlot,
  getTopLevelEntities,
  isEntityInsideZone,
  rectsOverlap,
  snapQuarter,
  solveMove,
  solveMoveZoneGroup,
  solveResize,
} from '../shared/gridEngine';
import {
  fetchCanvas,
  lockAuth,
  saveCanvasCompactApi,
  saveSettingsApi,
} from './api';
import { TopPillBar, type SaveStatus } from './components/TopPillBar';
import { InfiniteCanvas, type InfiniteCanvasHandle } from './components/InfiniteCanvas';
import { ZoomControlPill } from './components/ZoomControlPill';
import {
  computeInitialView,
  isMobileViewport,
  MAX_VIEW_SCALE,
  MIN_VIEW_SCALE,
  resolveActiveViewportMode,
  resolveViewportOrigin,
} from './utils/viewport';
import { FolderModal } from './components/FolderModal';
import { EditDock, type EditInspectorTarget } from './components/EditDock';
import type { ItemEditorDraft, ItemEditorSavePayload } from './components/ItemEditorModal';
import type {
  ZoneWidgetEditorDraft,
  ZoneWidgetSavePayload,
} from './components/ZoneWidgetEditorModal';
import type { ContextMenuState } from './components/ContextMenu';
import { FolderNavBar } from './components/FolderNavBar';
import { MobileNavView } from './components/MobileNavView';
import { TopLoadBar } from './components/TopLoadBar';
import { startLoadCycle } from './utils/loadTracker';

const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const ItemEditorModal = lazy(() =>
  import('./components/ItemEditorModal').then((m) => ({ default: m.ItemEditorModal }))
);
const ZoneWidgetEditorModal = lazy(() =>
  import('./components/ZoneWidgetEditorModal').then((m) => ({ default: m.ZoneWidgetEditorModal }))
);
const DissolveFolderModal = lazy(() =>
  import('./components/DissolveFolderModal').then((m) => ({ default: m.DissolveFolderModal }))
);
const SearchPalette = lazy(() =>
  import('./components/SearchPalette').then((m) => ({ default: m.SearchPalette }))
);
const UnlockModal = lazy(() =>
  import('./components/UnlockModal').then((m) => ({ default: m.UnlockModal }))
);
const ContextMenu = lazy(() =>
  import('./components/ContextMenu').then((m) => ({ default: m.ContextMenu }))
);

const THEME_STORAGE_KEY = 'neko-like-theme';
export type ThemeMode = 'auto' | 'light' | 'dark';
export type EditLayoutTarget = 'unlocked' | 'locked';

function defaultThemeToMode(mode: DefaultThemeMode): ThemeMode {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return 'auto';
}

function readBootPayload(): CanvasResponse | null {
  try {
    const el = document.getElementById('neko-boot');
    if (!el || !el.textContent) return null;
    const parsed = JSON.parse(el.textContent) as CanvasResponse;
    el.remove();
    if (parsed && parsed.version === 2 && Array.isArray(parsed.folders) && Array.isArray(parsed.items)) {
      return parsed;
    }
  } catch {
    // Fallback to fetchCanvas()
  }
  return null;
}

const INITIAL_BOOT = typeof document !== 'undefined' ? readBootPayload() : null;

export default function App() {
  const [doc, setDoc] = useState<CanvasDocument>(() =>
    INITIAL_BOOT
      ? {
          version: 2,
          updatedAt: INITIAL_BOOT.updatedAt,
          grid: INITIAL_BOOT.grid,
          folders: INITIAL_BOOT.folders,
          items: INITIAL_BOOT.items,
          zones: INITIAL_BOOT.zones ?? [],
          widgets: INITIAL_BOOT.widgets ?? [],
        }
      : {
          version: 2,
          updatedAt: '',
          grid: { cellSize: 108, gap: 14 },
          folders: [],
          items: [],
          zones: [],
          widgets: [],
        }
  );
  const docRef = useRef(doc);
  docRef.current = doc;
  const [settings, setSettings] = useState<SiteSettings>(
    () => INITIAL_BOOT?.settings ?? DEFAULT_SITE_SETTINGS
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  const [mobileViewOverride, setMobileViewOverride] = useState<MobileDefaultView | null>(null);
  const [loading, setLoading] = useState(() => !INITIAL_BOOT);
  const [unlocked, setUnlocked] = useState(() => Boolean(INITIAL_BOOT?.unlocked));
  const [hasPrivateHidden, setHasPrivateHidden] = useState(() =>
    Boolean(INITIAL_BOOT?.hasPrivateHidden)
  );
  const [editMode, setEditMode] = useState(false);
  const [layoutTarget, setLayoutTarget] = useState<EditLayoutTarget>('unlocked');
  const [marqueeMode, setMarqueeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const editingLockedLayout = unlocked && editMode && layoutTarget === 'locked';
  const editingLockedRef = useRef(false);
  editingLockedRef.current = editingLockedLayout;

  const displayedDoc = useMemo(
    () => (editingLockedLayout ? projectPublicCanvas(doc).doc : doc),
    [editingLockedLayout, doc]
  );

  const activeViewportOrigin = editingLockedLayout
    ? (doc.publicLayout?.viewportOrigin ?? null)
    : settings.viewportOrigin;
  const activeSettingsForViewport = useMemo(
    () => ({ ...settings, viewportOrigin: activeViewportOrigin }),
    [settings, activeViewportOrigin]
  );

  const [view, setView] = useState(() =>
    INITIAL_BOOT
      ? computeInitialView(
          {
            version: 2,
            updatedAt: INITIAL_BOOT.updatedAt,
            grid: INITIAL_BOOT.grid,
            folders: INITIAL_BOOT.folders,
            items: INITIAL_BOOT.items,
            zones: INITIAL_BOOT.zones ?? [],
            widgets: INITIAL_BOOT.widgets ?? [],
          },
          INITIAL_BOOT.settings ?? DEFAULT_SITE_SETTINGS
        )
      : { scale: 1, panX: 400, panY: 300 }
  );
  const didInitialCenterRef = useRef(Boolean(INITIAL_BOOT));
  const canvasRef = useRef<InfiniteCanvasHandle>(null);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'auto' || stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
      // ignore
    }
    if (INITIAL_BOOT?.settings) {
      return defaultThemeToMode(INITIAL_BOOT.settings.defaultTheme);
    }
    return 'auto';
  });
  const [systemDark, setSystemDark] = useState<boolean>(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );
  const dark = themeMode === 'auto' ? systemDark : themeMode === 'dark';

  const [undoStack, setUndoStack] = useState<
    Array<{
      folders: FolderContainer[];
      items: BookmarkItem[];
      zones: ZoneContainer[];
      widgets: CanvasWidget[];
      publicLayout?: PublicLayoutConfig;
    }>
  >([]);
  const [redoStack, setRedoStack] = useState<
    Array<{
      folders: FolderContainer[];
      items: BookmarkItem[];
      zones: ZoneContainer[];
      widgets: CanvasWidget[];
      publicLayout?: PublicLayoutConfig;
    }>
  >([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [unlockModal, setUnlockModal] = useState<{
    open: boolean;
    reason?: string;
    afterUnlock?: 'edit' | 'none';
    widgetToEdit?: CanvasWidget;
  }>({ open: false });
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [modalHiddenForDrag, setModalHiddenForDrag] = useState(false);
  const [isAnyDragActive, setIsAnyDragActive] = useState(false);
  const [draggingChildId, setDraggingChildId] = useState<string | null>(null);
  const [reorderPreview, setReorderPreview] = useState<{ folderId: string; itemIds: string[] } | null>(null);
  const [editorDraft, setEditorDraft] = useState<ItemEditorDraft | null>(null);
  const [zwDraft, setZwDraft] = useState<ZoneWidgetEditorDraft | null>(null);
  const [dissolveTarget, setDissolveTarget] = useState<FolderContainer | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [flyTransition, setFlyTransition] = useState(false);
  const flyTimerRef = useRef<number | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const newlyCreatedTimerRef = useRef<number | null>(null);
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [finishingEdit, setFinishingEdit] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: 'error' | 'info' | 'success' } | null>(
    null
  );

  const showToast = useCallback(
    (msg: string, tone: 'error' | 'info' | 'success' = 'info') => {
      setToast({ msg, tone });
      setTimeout(() => {
        setToast((cur) => (cur?.msg === msg ? null : cur));
      }, 3200);
    },
    []
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    startLoadCycle();
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(isMobileViewport());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.title = settings.siteTitle;
    document.documentElement.style.setProperty('--accent-orange', settings.brandAccent);
  }, [settings.siteTitle, settings.brandAccent]);

  const toggleDark = useCallback(() => {
    const nextMode: ThemeMode = dark ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // ignore
    }
    setThemeMode(nextMode);
  }, [dark]);

  const setAutoTheme = useCallback(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, 'auto');
    } catch {
      // ignore
    }
    setThemeMode('auto');
  }, []);

  const refreshCanvas = useCallback(
    async (recenter = false) => {
      startLoadCycle();
      try {
        const res = await fetchCanvas();
        const nextDoc: CanvasDocument = {
          version: 2,
          updatedAt: res.updatedAt,
          grid: res.grid,
          folders: res.folders,
          items: res.items,
          zones: res.zones ?? [],
          widgets: res.widgets ?? [],
        };
        docRef.current = nextDoc;
        setDoc(nextDoc);
        setUnlocked(res.unlocked);
        setHasPrivateHidden(res.hasPrivateHidden);
        if (res.settings) {
          setSettings(res.settings);
          try {
            if (localStorage.getItem(THEME_STORAGE_KEY) === null) {
              setThemeMode(defaultThemeToMode(res.settings.defaultTheme));
            }
          } catch {
            // ignore
          }
        }
        if (!res.unlocked) {
          setSettingsOpen(false);
        }
        if (recenter || !didInitialCenterRef.current) {
          didInitialCenterRef.current = true;
          setView(computeInitialView(nextDoc, res.settings ?? DEFAULT_SITE_SETTINGS));
        }
        return nextDoc;
      } catch (err) {
        showToast(err instanceof Error ? err.message : '加载画布失败', 'error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (INITIAL_BOOT) return;
    void refreshCanvas(true);
  }, [refreshCanvas]);

  const commitRevRef = useRef(0);
  const inFlightSaveRef = useRef(false);
  const inFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingSaveRef = useRef<{ rev: number; doc: CanvasDocument } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savedBadgeTimerRef = useRef<number | null>(null);
  const sessionDirtyRef = useRef(false);

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (inFlightPromiseRef.current) {
      return inFlightPromiseRef.current;
    }
    const job = pendingSaveRef.current;
    if (!job) return true;
    pendingSaveRef.current = null;
    inFlightSaveRef.current = true;
    setSaveStatus('saving');

    const run = (async (): Promise<boolean> => {
      let allOk = true;
      try {
        const saved = await saveCanvasCompactApi(job.doc);
        // Only update metadata if no newer local mutation happened while request was in flight
        if (job.rev === commitRevRef.current && !pendingSaveRef.current) {
          setDoc((cur) => {
            const next = {
              ...cur,
              updatedAt: saved.updatedAt,
              grid: saved.grid,
            };
            docRef.current = next;
            return next;
          });
          if (savedBadgeTimerRef.current !== null) {
            window.clearTimeout(savedBadgeTimerRef.current);
          }
          setSaveStatus('saved');
          savedBadgeTimerRef.current = window.setTimeout(() => {
            savedBadgeTimerRef.current = null;
            setSaveStatus((cur) => (cur === 'saved' ? 'idle' : cur));
          }, 2400);
        }
      } catch (err) {
        allOk = false;
        setSaveStatus('error');
        if (!pendingSaveRef.current) {
          showToast(err instanceof Error ? err.message : '保存失败，正在同步最新画布', 'error');
          void refreshCanvas(false);
        }
      } finally {
        inFlightSaveRef.current = false;
        inFlightPromiseRef.current = null;
      }

      if (pendingSaveRef.current) {
        const tailOk = await flushPendingSave();
        return allOk && tailOk;
      }
      return allOk;
    })();

    inFlightPromiseRef.current = run;
    return run;
  }, [refreshCanvas, showToast]);

  const flushAllPendingSaves = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    let ok = true;
    while (inFlightPromiseRef.current || pendingSaveRef.current) {
      if (inFlightPromiseRef.current) {
        const res = await inFlightPromiseRef.current;
        if (!res) ok = false;
      }
      if (pendingSaveRef.current) {
        const res = await flushPendingSave();
        if (!res) ok = false;
      }
    }
    return ok;
  }, [flushPendingSave]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingSaveRef.current || inFlightSaveRef.current || inFlightPromiseRef.current) {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        void flushPendingSave();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushPendingSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (savedBadgeTimerRef.current !== null) {
        window.clearTimeout(savedBadgeTimerRef.current);
      }
    };
  }, []);

  const commitDocState = useCallback(
    (
      nextFolders: FolderContainer[],
      nextItems: BookmarkItem[],
      recordUndo = true,
      nextZones?: ZoneContainer[],
      nextWidgets?: CanvasWidget[],
      options?: { nextPublicLayout?: PublicLayoutConfig; replaceCanonical?: boolean }
    ) => {
      const prevDoc = docRef.current;
      const curZones = prevDoc.zones ?? [];
      const curWidgets = prevDoc.widgets ?? [];
      if (recordUndo) {
        setUndoStack((s) => [
          ...s.slice(-29),
          {
            folders: prevDoc.folders,
            items: prevDoc.items,
            zones: curZones,
            widgets: curWidgets,
            publicLayout: prevDoc.publicLayout,
          },
        ]);
        setRedoStack([]);
      }

      const now = new Date().toISOString();
      let nextDoc: CanvasDocument;
      if (options?.replaceCanonical) {
        const { publicLayout: _omit, ...restPrev } = prevDoc;
        nextDoc = reconcilePublicLayout({
          ...restPrev,
          updatedAt: now,
          folders: nextFolders,
          items: nextItems,
          zones: nextZones ?? curZones,
          widgets: nextWidgets ?? curWidgets,
          ...(options.nextPublicLayout ? { publicLayout: options.nextPublicLayout } : {}),
        });
      } else if (editingLockedRef.current) {
        const curDisplayed = projectPublicCanvas(prevDoc).doc;
        const nextLockedDoc: CanvasDocument = {
          ...prevDoc,
          updatedAt: now,
          folders: nextFolders,
          items: nextItems,
          zones: nextZones ?? curDisplayed.zones ?? [],
          widgets: nextWidgets ?? curDisplayed.widgets ?? [],
        };
        nextDoc = mergeLockedLayoutEdit(prevDoc, nextLockedDoc);
      } else {
        nextDoc = reconcilePublicLayout({
          ...prevDoc,
          updatedAt: now,
          folders: nextFolders,
          items: nextItems,
          zones: nextZones ?? curZones,
          widgets: nextWidgets ?? curWidgets,
        });
      }

      docRef.current = nextDoc;
      setDoc(nextDoc);

      sessionDirtyRef.current = true;
      if (savedBadgeTimerRef.current !== null) {
        window.clearTimeout(savedBadgeTimerRef.current);
        savedBadgeTimerRef.current = null;
      }
      setSaveStatus('saving');

      const nextRev = ++commitRevRef.current;
      pendingSaveRef.current = { rev: nextRev, doc: nextDoc };
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushPendingSave();
      }, 80);
    },
    [flushPendingSave]
  );

  const handleCommitLayout = useCallback(
    (nextEntities: CanvasGridEntity[]) => {
      const updated = applyEntityLayoutToDoc(displayedDoc, nextEntities);
      void commitDocState(
        updated.folders,
        updated.items,
        true,
        updated.zones ?? displayedDoc.zones ?? [],
        updated.widgets ?? displayedDoc.widgets ?? []
      );
    },
    [displayedDoc, commitDocState]
  );

  const handleCommitZones = useCallback(
    (nextZones: ZoneContainer[]) => {
      void commitDocState(
        displayedDoc.folders,
        displayedDoc.items,
        true,
        nextZones,
        displayedDoc.widgets ?? []
      );
    },
    [displayedDoc.folders, displayedDoc.items, displayedDoc.widgets, commitDocState]
  );

  const handleCommitZoneGroup = useCallback(
    (
      nextZone: ZoneContainer,
      nextEntities: CanvasGridEntity[],
      nextTextWidgets: FreeTextWidget[]
    ) => {
      const updated = applyEntityLayoutToDoc(displayedDoc, nextEntities);
      const nextZones = (displayedDoc.zones ?? []).map((z) =>
        z.id === nextZone.id ? nextZone : z
      );
      const textMap = new Map(nextTextWidgets.map((t) => [t.id, t]));
      const nextWidgets = (updated.widgets ?? displayedDoc.widgets ?? []).map((w) =>
        w.kind === 'text' ? (textMap.get(w.id) ?? w) : w
      );
      void commitDocState(updated.folders, updated.items, true, nextZones, nextWidgets);
    },
    [displayedDoc, commitDocState]
  );

  const handleCommitTextWidgets = useCallback(
    (nextTextWidgets: FreeTextWidget[]) => {
      const textMap = new Map(nextTextWidgets.map((t) => [t.id, t]));
      const nextWidgets = (displayedDoc.widgets ?? []).map((w) =>
        w.kind === 'text' ? (textMap.get(w.id) ?? w) : w
      );
      void commitDocState(
        displayedDoc.folders,
        displayedDoc.items,
        true,
        displayedDoc.zones ?? [],
        nextWidgets
      );
    },
    [
      displayedDoc.folders,
      displayedDoc.items,
      displayedDoc.zones,
      displayedDoc.widgets,
      commitDocState,
    ]
  );

  const handleCommitEntitiesAndTexts = useCallback(
    (nextEntities: CanvasGridEntity[], nextTextWidgets: FreeTextWidget[]) => {
      const updated = applyEntityLayoutToDoc(displayedDoc, nextEntities);
      const textMap = new Map(nextTextWidgets.map((t) => [t.id, t]));
      const nextWidgets = (updated.widgets ?? displayedDoc.widgets ?? []).map((w) =>
        w.kind === 'text' ? (textMap.get(w.id) ?? w) : w
      );
      void commitDocState(
        updated.folders,
        updated.items,
        true,
        displayedDoc.zones ?? [],
        nextWidgets
      );
    },
    [displayedDoc, commitDocState]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [
      ...r,
      {
        folders: doc.folders,
        items: doc.items,
        zones: doc.zones ?? [],
        widgets: doc.widgets ?? [],
        publicLayout: doc.publicLayout,
      },
    ]);
    void commitDocState(prev.folders, prev.items, false, prev.zones, prev.widgets, {
      nextPublicLayout: prev.publicLayout,
      replaceCanonical: true,
    });
  }, [undoStack, doc.folders, doc.items, doc.zones, doc.widgets, doc.publicLayout, commitDocState]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((s) => [
      ...s.slice(-29),
      {
        folders: doc.folders,
        items: doc.items,
        zones: doc.zones ?? [],
        widgets: doc.widgets ?? [],
        publicLayout: doc.publicLayout,
      },
    ]);
    void commitDocState(next.folders, next.items, false, next.zones, next.widgets, {
      nextPublicLayout: next.publicLayout,
      replaceCanonical: true,
    });
  }, [redoStack, doc.folders, doc.items, doc.zones, doc.widgets, doc.publicLayout, commitDocState]);

  const topLevelEntities = useMemo(() => getTopLevelEntities(displayedDoc), [displayedDoc]);

  const handleDeleteEntities = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);

      // If deleting a single non-empty folder, open DissolveFolderModal
      if (ids.length === 1) {
        const folder = displayedDoc.folders.find((f) => f.id === ids[0]);
        if (folder) {
          const childCount = displayedDoc.items.filter((i) => i.parentId === folder.id).length;
          if (childCount > 0) {
            setDissolveTarget(folder);
            return;
          }
        }
      }

      // If multiple items/folders deleted via Dock, dissolve any non-empty folders safely to desktop or delete items
      const deletedFolderIds = new Set(
        displayedDoc.folders.filter((f) => idSet.has(f.id)).map((f) => f.id)
      );
      const nextFolders = displayedDoc.folders.filter((f) => !idSet.has(f.id));
      const nextZones = (displayedDoc.zones ?? []).filter((z) => !idSet.has(z.id));
      const nextWidgets = (displayedDoc.widgets ?? []).filter((w) => !idSet.has(w.id));
      const now = new Date().toISOString();

      // Unpack orphaned items from multi-deleted folders if their item wasn't explicitly selected for deletion
      const remainingItems = displayedDoc.items.filter((i) => !idSet.has(i.id));
      const occupied = getTopLevelEntities({
        folders: nextFolders,
        items: remainingItems,
        widgets: nextWidgets,
      }).map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));

      const nextItems = remainingItems.map((it) => {
        if (it.parentId && deletedFolderIds.has(it.parentId)) {
          const srcFolder = displayedDoc.folders.find((f) => f.id === it.parentId);
          const slot = findNearestFreeSlot(occupied, 1, 1, srcFolder?.x ?? 0, srcFolder?.y ?? 0);
          occupied.push({ x: slot.x, y: slot.y, w: 1, h: 1 });
          return {
            ...it,
            parentId: null,
            x: slot.x,
            y: slot.y,
            w: 1,
            h: 1,
            order: 0,
            updatedAt: now,
          };
        }
        return it;
      });

      void commitDocState(nextFolders, nextItems, true, nextZones, nextWidgets);
      setSelectedIds([]);
    },
    [
      displayedDoc.folders,
      displayedDoc.items,
      displayedDoc.zones,
      displayedDoc.widgets,
      commitDocState,
    ]
  );

  const handleDeleteDraggingEntities = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      if (ids.length === 1) {
        const folder = displayedDoc.folders.find((f) => f.id === ids[0]);
        if (folder && displayedDoc.items.some((i) => i.parentId === folder.id)) {
          setDissolveTarget(folder);
          return;
        }
      }
      handleDeleteEntities(ids);
      showToast('已删除（可按撤销恢复）');
    },
    [displayedDoc.folders, displayedDoc.items, handleDeleteEntities, showToast]
  );

  const handleDeleteDraggingChildItem = useCallback(
    (itemId: string) => {
      void commitDocState(
        displayedDoc.folders,
        displayedDoc.items.filter((i) => i.id !== itemId),
        true
      );
      showToast('已删除（可按撤销恢复）');
    },
    [displayedDoc.folders, displayedDoc.items, commitDocState, showToast]
  );

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }

      if (!inInput && e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (!editMode || inInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIds.length > 0) {
        e.preventDefault();
        handleDeleteEntities(selectedIds);
        return;
      }

      const isArrow =
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown';
      const noModalOpen =
        !searchOpen &&
        !activeFolderId &&
        !editorDraft &&
        !zwDraft &&
        !dissolveTarget &&
        !settingsOpen &&
        !unlockModal.open &&
        !contextMenu &&
        !inlineEditingId;

      if (isArrow && noModalOpen && selectedIds.length > 0) {
        e.preventDefault();
        const stepSize = e.shiftKey ? 1 : 0.25;
        const ndx = e.key === 'ArrowLeft' ? -stepSize : e.key === 'ArrowRight' ? stepSize : 0;
        const ndy = e.key === 'ArrowUp' ? -stepSize : e.key === 'ArrowDown' ? stepSize : 0;
        const now = new Date().toISOString();

        if (selectedIds.length === 1) {
          const zone = (displayedDoc.zones ?? []).find((z) => z.id === selectedIds[0]);
          if (zone) {
            if (e.altKey) {
              const nextZones = (displayedDoc.zones ?? []).map((z) =>
                z.id === zone.id
                  ? {
                      ...z,
                      x: snapQuarter(z.x + ndx),
                      y: snapQuarter(z.y + ndy),
                      updatedAt: now,
                    }
                  : z
              );
              handleCommitZones(nextZones);
              return;
            }
            const movingForegroundIds = topLevelEntities
              .filter((ent) => isEntityInsideZone(ent, zone))
              .map((ent) => ent.id);
            const movingTextIds = (displayedDoc.widgets ?? [])
              .filter((w): w is FreeTextWidget => w.kind === 'text' && isEntityInsideZone(w, zone))
              .map((tw) => tw.id);
            const res = solveMoveZoneGroup(topLevelEntities, movingForegroundIds, ndx, ndy);
            if (!res.ok) {
              showToast(res.message, 'error');
              return;
            }
            const nextZone: ZoneContainer = {
              ...zone,
              x: snapQuarter(zone.x + res.dx),
              y: snapQuarter(zone.y + res.dy),
              updatedAt: now,
            };
            const movingTextSet = new Set(movingTextIds);
            const nextTextWidgets = (displayedDoc.widgets ?? [])
              .filter((w): w is FreeTextWidget => w.kind === 'text')
              .map((tw) =>
                movingTextSet.has(tw.id)
                  ? {
                      ...tw,
                      x: snapQuarter(tw.x + res.dx),
                      y: snapQuarter(tw.y + res.dy),
                      updatedAt: now,
                    }
                  : tw
              );
            handleCommitZoneGroup(nextZone, res.entities, nextTextWidgets);
            return;
          }
        }

        const entityIdSet = new Set(topLevelEntities.map((ent) => ent.id));
        const textList = (displayedDoc.widgets ?? []).filter(
          (w): w is FreeTextWidget => w.kind === 'text'
        );
        const textIdSet = new Set(textList.map((tw) => tw.id));
        const movingEntityIds = selectedIds.filter((id) => entityIdSet.has(id));
        const movingTextIds = selectedIds.filter((id) => textIdSet.has(id));

        if (movingEntityIds.length > 0) {
          const res = solveMove(topLevelEntities, movingEntityIds, ndx, ndy);
          if (!res.ok) {
            showToast(res.message, 'error');
            return;
          }
          let actualDx = ndx;
          let actualDy = ndy;
          const firstOrig = topLevelEntities.find((ent) => ent.id === movingEntityIds[0]);
          const firstMoved = res.entities.find((ent) => ent.id === movingEntityIds[0]);
          if (firstOrig && firstMoved) {
            actualDx = snapQuarter(firstMoved.x - firstOrig.x);
            actualDy = snapQuarter(firstMoved.y - firstOrig.y);
          }
          if (movingTextIds.length > 0) {
            const movingTextSet = new Set(movingTextIds);
            const nextTextWidgets = textList.map((tw) =>
              movingTextSet.has(tw.id)
                ? {
                    ...tw,
                    x: snapQuarter(tw.x + actualDx),
                    y: snapQuarter(tw.y + actualDy),
                    updatedAt: now,
                  }
                : tw
            );
            handleCommitEntitiesAndTexts(res.entities, nextTextWidgets);
          } else {
            handleCommitLayout(res.entities);
          }
        } else if (movingTextIds.length > 0) {
          const movingTextSet = new Set(movingTextIds);
          const nextTextWidgets = textList.map((tw) =>
            movingTextSet.has(tw.id)
              ? {
                  ...tw,
                  x: snapQuarter(tw.x + ndx),
                  y: snapQuarter(tw.y + ndy),
                  updatedAt: now,
                }
              : tw
          );
          handleCommitTextWidgets(nextTextWidgets);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    editMode,
    selectedIds,
    searchOpen,
    activeFolderId,
    editorDraft,
    zwDraft,
    dissolveTarget,
    settingsOpen,
    unlockModal.open,
    contextMenu,
    inlineEditingId,
    displayedDoc.zones,
    displayedDoc.widgets,
    topLevelEntities,
    handleUndo,
    handleRedo,
    handleDeleteEntities,
    handleCommitLayout,
    handleCommitZones,
    handleCommitZoneGroup,
    handleCommitTextWidgets,
    handleCommitEntitiesAndTexts,
    showToast,
  ]);

  async function handleLockToggle() {
    if (unlocked) {
      try {
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          activeEl.blur();
          await new Promise<void>((r) => window.setTimeout(r, 0));
        }

        if (
          saveTimerRef.current !== null ||
          pendingSaveRef.current ||
          inFlightSaveRef.current ||
          inFlightPromiseRef.current
        ) {
          const savedOk = await flushAllPendingSaves();
          if (!savedOk) {
            showToast('未保存的布局落盘失败，已中止上锁', 'error');
            return;
          }
        }
        sessionDirtyRef.current = false;
        setInlineEditingId(null);

        await lockAuth();
        setUnlocked(false);
        setSettingsOpen(false);
        setEditMode(false);
        setLayoutTarget('unlocked');
        setMarqueeMode(false);
        setSelectedIds([]);
        setActiveFolderId(null);
        setDoc((cur) => {
          const { doc: pubDoc, hasPrivateHidden: priv } = projectPublicCanvas(cur);
          if (priv) {
            setHasPrivateHidden(true);
          }
          return pubDoc;
        });
        await refreshCanvas(true);
        showToast('已重新上锁，私密文件夹已隐藏');
      } catch (err) {
        showToast(err instanceof Error ? err.message : '上锁失败，请重试', 'error');
      }
    } else {
      setUnlockModal({
        open: true,
        reason: '输入管理密码以解锁私密文件夹',
        afterUnlock: 'none',
      });
    }
  }

  const handleUpdateSettings = useCallback(
    async (patch: Partial<SiteSettings>) => {
      const res = await saveSettingsApi(patch);
      setSettings(res.settings);
      const nextDoc: CanvasDocument = {
        ...doc,
        grid: res.grid,
      };
      docRef.current = nextDoc;
      setDoc(nextDoc);
      if (patch.defaultTheme) {
        try {
          localStorage.removeItem(THEME_STORAGE_KEY);
        } catch {
          // ignore
        }
        setThemeMode(defaultThemeToMode(res.settings.defaultTheme));
      }
      if (
        patch.desktopViewportMode !== undefined ||
        patch.mobileViewportMode !== undefined ||
        patch.gridDensity !== undefined
      ) {
        setView(computeInitialView(nextDoc, res.settings));
      }
      if (patch.mobileDefaultView !== undefined) {
        setMobileViewOverride(null);
      }
    },
    [doc]
  );

  const resolvedOrigin = useMemo(
    () => resolveViewportOrigin(displayedDoc, activeSettingsForViewport),
    [displayedDoc, activeSettingsForViewport]
  );

  const handleZoomStep = useCallback((dir: 'in' | 'out') => {
    setView((prev) => {
      const nextScale =
        dir === 'in'
          ? Math.min(MAX_VIEW_SCALE, Number((Math.floor(prev.scale * 4 + 1.001) * 0.25).toFixed(2)))
          : Math.max(MIN_VIEW_SCALE, Number((Math.ceil(prev.scale * 4 - 1.001) * 0.25).toFixed(2)));
      if (nextScale === prev.scale) return prev;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const wx = (cx - prev.panX) / prev.scale;
      const wy = (cy - prev.panY) / prev.scale;
      return {
        scale: nextScale,
        panX: cx - wx * nextScale,
        panY: cy - wy * nextScale,
      };
    });
  }, []);

  const handleResetView = useCallback(() => {
    setView(computeInitialView(displayedDoc, activeSettingsForViewport));
  }, [displayedDoc, activeSettingsForViewport]);

  const handleSetViewportOrigin = useCallback(async () => {
    const wx = Math.round((window.innerWidth / 2 - view.panX) / view.scale);
    const wy = Math.round((window.innerHeight / 2 - view.panY) / view.scale);
    if (editingLockedRef.current) {
      const prevDoc = docRef.current;
      const curPl = prevDoc.publicLayout ?? { positions: {} };
      commitDocState(prevDoc.folders, prevDoc.items, true, prevDoc.zones, prevDoc.widgets, {
        nextPublicLayout: { ...curPl, viewportOrigin: { x: wx, y: wy } },
        replaceCanonical: true,
      });
      showToast('已将当前屏幕中心设为「解锁前」视野锚点');
      return;
    }
    try {
      await handleUpdateSettings({ viewportOrigin: { x: wx, y: wy } });
      showToast('已将当前屏幕中心设为「解锁后」视野锚点');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '设置视野锚点失败', 'error');
    }
  }, [view.panX, view.panY, view.scale, commitDocState, handleUpdateSettings, showToast]);

  const handleUpdateViewportOrigin = useCallback(
    async (origin: { x: number; y: number }) => {
      if (editingLockedRef.current) {
        const prevDoc = docRef.current;
        const curPl = prevDoc.publicLayout ?? { positions: {} };
        commitDocState(prevDoc.folders, prevDoc.items, true, prevDoc.zones, prevDoc.widgets, {
          nextPublicLayout: { ...curPl, viewportOrigin: origin },
          replaceCanonical: true,
        });
        showToast(`已更新「解锁前」视野锚点 (${origin.x}, ${origin.y})`);
        return;
      }
      try {
        await handleUpdateSettings({ viewportOrigin: origin });
        showToast(`已更新「解锁后」视野锚点 (${origin.x}, ${origin.y})`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : '保存视野锚点失败', 'error');
      }
    },
    [commitDocState, handleUpdateSettings, showToast]
  );

  const flyToViewState = useCallback((nextView: { scale: number; panX: number; panY: number }) => {
    if (flyTimerRef.current !== null) {
      window.clearTimeout(flyTimerRef.current);
    }
    setFlyTransition(true);
    setView(nextView);
    flyTimerRef.current = window.setTimeout(() => {
      flyTimerRef.current = null;
      setFlyTransition(false);
    }, 360);
  }, []);

  const handleSwitchLayoutTarget = useCallback(
    (nextTarget: EditLayoutTarget) => {
      if (nextTarget === layoutTarget) return;
      setSelectedIds([]);
      setInlineEditingId(null);
      setLayoutTarget(nextTarget);
      const curDoc = docRef.current;
      const targetDoc = nextTarget === 'locked' ? projectPublicCanvas(curDoc).doc : curDoc;
      const targetOrigin =
        nextTarget === 'locked'
          ? (curDoc.publicLayout?.viewportOrigin ?? null)
          : settings.viewportOrigin;
      flyToViewState(
        computeInitialView(targetDoc, {
          ...settings,
          viewportOrigin: targetOrigin,
        })
      );
    },
    [layoutTarget, settings, flyToViewState]
  );

  const handleSyncUnlockedToLocked = useCallback(() => {
    const curDoc = docRef.current;
    const syncedPl = buildSyncedPublicLayoutFromCanonical(curDoc);
    commitDocState(curDoc.folders, curDoc.items, true, curDoc.zones, curDoc.widgets, {
      nextPublicLayout: syncedPl,
      replaceCanonical: true,
    });
    setSelectedIds([]);
    showToast('已继承解锁后公开元素排版（可按撤销恢复）');
  }, [commitDocState, showToast]);

  async function handleToggleEditMode() {
    if (editMode) {
      if (finishingEdit) return;
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        activeEl.blur();
        await new Promise<void>((r) => window.setTimeout(r, 0));
      }

      if (
        saveTimerRef.current !== null ||
        pendingSaveRef.current ||
        inFlightSaveRef.current ||
        inFlightPromiseRef.current
      ) {
        setFinishingEdit(true);
        const savedOk = await flushAllPendingSaves();
        setFinishingEdit(false);
        if (!savedOk) {
          showToast('布局保存失败，请检查网络后重试', 'error');
          return;
        }
      }

      const wasLockedTarget = layoutTarget === 'locked';
      setEditMode(false);
      setLayoutTarget('unlocked');
      setMarqueeMode(false);
      setInlineEditingId(null);
      setSelectedIds([]);
      if (wasLockedTarget) {
        flyToViewState(computeInitialView(docRef.current, settings));
      }
      if (sessionDirtyRef.current) {
        sessionDirtyRef.current = false;
        showToast('✓ 布局已保存', 'success');
      }
      return;
    }
    if (!unlocked) {
      setUnlockModal({
        open: true,
        reason: '进入编辑模式前请验证管理密码（同时解锁私密文件夹）',
        afterUnlock: 'edit',
      });
      return;
    }
    sessionDirtyRef.current = false;
    setLayoutTarget('unlocked');
    setEditMode(true);
  }

  function handleSaveEditor(payload: ItemEditorSavePayload): string | null {
    if (!editorDraft) return null;
    const now = new Date().toISOString();

    if (editorDraft.mode === 'edit-folder') {
      const existing = editorDraft.folder;
      let nextDoc = displayedDoc;
      if (payload.w !== existing.w || payload.h !== existing.h) {
        const res = solveResize(topLevelEntities, existing.id, payload.w, payload.h);
        if (!res.ok) return res.message;
        nextDoc = applyEntityLayoutToDoc(displayedDoc, res.entities, now);
      }
      const nextFolders = nextDoc.folders.map((f) =>
        f.id === existing.id
          ? {
              ...f,
              title: payload.title,
              displayMode: payload.displayMode ?? f.displayMode,
              isPrivate: payload.isPrivate ?? f.isPrivate,
              icon: payload.icon,
              accent: payload.accent,
              updatedAt: now,
            }
          : f
      );
      void commitDocState(
        nextFolders,
        nextDoc.items,
        true,
        nextDoc.zones ?? displayedDoc.zones ?? [],
        nextDoc.widgets ?? displayedDoc.widgets ?? []
      );
      setEditorDraft(null);
      return null;
    }

    if (editorDraft.mode === 'edit-item') {
      const existing = editorDraft.item;
      const targetParentId = payload.parentId ?? null;
      let nextDoc = displayedDoc;

      if (targetParentId === null) {
        if (existing.parentId === null) {
          if (payload.w !== existing.w || payload.h !== existing.h) {
            const res = solveResize(topLevelEntities, existing.id, payload.w, payload.h);
            if (!res.ok) return res.message;
            nextDoc = applyEntityLayoutToDoc(displayedDoc, res.entities, now);
          }
        } else {
          // Moving from folder to desktop via editor
          const slot = findNearestFreeSlot(topLevelEntities, payload.w, payload.h, 0, 0);
          nextDoc = {
            ...displayedDoc,
            items: displayedDoc.items.map((it) =>
              it.id === existing.id
                ? { ...it, parentId: null, x: slot.x, y: slot.y, w: payload.w, h: payload.h, order: 0 }
                : it
            ),
          };
        }
      }

      const nextItems = nextDoc.items.map((it) => {
        if (it.id !== existing.id) return it;
        const nextOrder =
          targetParentId !== null && existing.parentId !== targetParentId
            ? nextDoc.items.filter((x) => x.parentId === targetParentId).length
            : targetParentId === null
              ? 0
              : it.order;
        return {
          ...it,
          title: payload.title,
          url: payload.url || it.url,
          subtitle: payload.subtitle,
          icon: payload.icon,
          faviconUrl: payload.faviconUrl,
          accent: payload.accent,
          tags: payload.tags,
          parentId: targetParentId,
          order: nextOrder,
          updatedAt: now,
        };
      });

      void commitDocState(
        nextDoc.folders,
        nextItems,
        true,
        nextDoc.zones ?? displayedDoc.zones ?? [],
        nextDoc.widgets ?? displayedDoc.widgets ?? []
      );
      setEditorDraft(null);
      return null;
    }

    if (editorDraft.mode === 'create-folder') {
      const anchor = editorDraft.initialPos ?? getViewportCenterGrid(payload.w, payload.h);
      const slot = placeNearAnchor(payload.w, payload.h, anchor);
      const id = `folder-${crypto.randomUUID().slice(0, 8)}`;
      const newFolder: FolderContainer = {
        id,
        title: payload.title,
        x: slot.x,
        y: slot.y,
        w: payload.w,
        h: payload.h,
        displayMode: payload.displayMode ?? 'grid',
        isPrivate: payload.isPrivate ?? false,
        icon: payload.icon,
        accent: payload.accent,
        createdAt: now,
        updatedAt: now,
      };
      void commitDocState([...displayedDoc.folders, newFolder], displayedDoc.items);
      revealAndHighlightEntity(newFolder, id);
      setEditorDraft(null);
      return null;
    }

    // create-item
    const targetParentId = payload.parentId ?? null;
    const id = `item-${crypto.randomUUID().slice(0, 8)}`;
    let newItem: BookmarkItem;

    if (targetParentId !== null) {
      const count = displayedDoc.items.filter((it) => it.parentId === targetParentId).length;
      newItem = {
        id,
        title: payload.title,
        url: payload.url || 'https://example.com',
        subtitle: payload.subtitle,
        icon: payload.icon,
        faviconUrl: payload.faviconUrl,
        accent: payload.accent,
        tags: payload.tags,
        parentId: targetParentId,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: count,
        createdAt: now,
        updatedAt: now,
      };
      const parentFolder = displayedDoc.folders.find((f) => f.id === targetParentId);
      if (parentFolder) {
        revealAndHighlightEntity(parentFolder, parentFolder.id);
        showToast(`已添加至「${parentFolder.title}」`);
      }
    } else {
      const anchor = editorDraft.initialPos ?? getViewportCenterGrid(payload.w, payload.h);
      const slot = placeNearAnchor(payload.w, payload.h, anchor);
      newItem = {
        id,
        title: payload.title,
        url: payload.url || 'https://example.com',
        subtitle: payload.subtitle,
        icon: payload.icon,
        faviconUrl: payload.faviconUrl,
        accent: payload.accent,
        tags: payload.tags,
        parentId: null,
        x: slot.x,
        y: slot.y,
        w: payload.w,
        h: payload.h,
        order: 0,
        createdAt: now,
        updatedAt: now,
      };
      revealAndHighlightEntity(newItem, id);
    }

    void commitDocState(displayedDoc.folders, [...displayedDoc.items, newItem]);
    setEditorDraft(null);
    return null;
  }

  function handleCycleFolderMode(folder: FolderContainer) {
    const nextMode: FolderDisplayMode = folder.displayMode === 'grid' ? 'list' : 'grid';
    const now = new Date().toISOString();
    commitDocState(
      displayedDoc.folders.map((f) =>
        f.id === folder.id ? { ...f, displayMode: nextMode, updatedAt: now } : f
      ),
      displayedDoc.items
    );
  }

  function handleSetFolderAccent(folder: FolderContainer, accent?: string) {
    const now = new Date().toISOString();
    commitDocState(
      displayedDoc.folders.map((f) =>
        f.id === folder.id ? { ...f, accent, updatedAt: now } : f
      ),
      displayedDoc.items
    );
  }

  function handleToggleFolderPrivate(folder: FolderContainer) {
    const now = new Date().toISOString();
    const nextPrivate = !folder.isPrivate;
    commitDocState(
      displayedDoc.folders.map((f) =>
        f.id === folder.id ? { ...f, isPrivate: nextPrivate, updatedAt: now } : f
      ),
      displayedDoc.items
    );
    showToast(nextPrivate ? `已将「${folder.title}」设为私密` : `已将「${folder.title}」设为公开`);
  }

  const flyToWorldRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, highlightId?: string) => {
      const step = doc.grid.cellSize + doc.grid.gap;
      const cx = rect.x * step + (rect.w * doc.grid.cellSize + Math.max(0, rect.w - 1) * doc.grid.gap) / 2;
      const cy = rect.y * step + (rect.h * doc.grid.cellSize + Math.max(0, rect.h - 1) * doc.grid.gap) / 2;
      const targetScale = Math.max(0.85, Math.min(1.05, view.scale));
      if (flyTimerRef.current !== null) {
        window.clearTimeout(flyTimerRef.current);
      }
      setFlyTransition(true);
      setView({
        scale: targetScale,
        panX: Math.round(window.innerWidth / 2 - cx * targetScale),
        panY: Math.round(window.innerHeight / 2 - cy * targetScale),
      });
      flyTimerRef.current = window.setTimeout(() => {
        flyTimerRef.current = null;
        setFlyTransition(false);
      }, 360);
      if (highlightId) {
        if (newlyCreatedTimerRef.current !== null) {
          window.clearTimeout(newlyCreatedTimerRef.current);
        }
        setNewlyCreatedId(highlightId);
        newlyCreatedTimerRef.current = window.setTimeout(() => {
          newlyCreatedTimerRef.current = null;
          setNewlyCreatedId((cur) => (cur === highlightId ? null : cur));
        }, 1600);
      }
    },
    [doc.grid.cellSize, doc.grid.gap, view.scale]
  );

  const handleFocusFolder = useCallback(
    (folder: FolderContainer) => {
      flyToWorldRect(folder, folder.id);
    },
    [flyToWorldRect]
  );

  const handleFocusZone = useCallback(
    (zone: ZoneContainer) => {
      flyToWorldRect(zone, zone.id);
    },
    [flyToWorldRect]
  );

  const handleCopyUrl = useCallback(
    (url: string) => {
      navigator.clipboard
        ?.writeText(url)
        .then(() => showToast('已复制链接'))
        .catch(() => showToast('复制失败', 'error'));
    },
    [showToast]
  );

  const handleMoveItemsToFolder = useCallback(
    (itemIds: string[], folderId: string) => {
      const folder = displayedDoc.folders.find((f) => f.id === folderId);
      if (!folder || itemIds.length === 0) return;

      const moveSet = new Set(itemIds);
      const existingCount = displayedDoc.items.filter(
        (i) => i.parentId === folderId && !moveSet.has(i.id)
      ).length;
      const now = new Date().toISOString();
      let offset = 0;

      const nextItems = displayedDoc.items.map((it) => {
        if (!moveSet.has(it.id)) return it;
        return {
          ...it,
          parentId: folderId,
          order: existingCount + offset++,
          updatedAt: now,
        };
      });

      setSelectedIds((prev) => prev.filter((id) => !moveSet.has(id)));
      void commitDocState(displayedDoc.folders, nextItems);
      showToast(`已将 ${itemIds.length} 个项目移入「${folder.title}」`);
    },
    [displayedDoc.folders, displayedDoc.items, commitDocState, showToast]
  );

  const handleMergeItemsToFolder = useCallback(
    (sourceItemId: string, targetItemId: string) => {
      const source = displayedDoc.items.find((i) => i.id === sourceItemId);
      const target = displayedDoc.items.find((i) => i.id === targetItemId);
      if (!source || !target || target.parentId !== null || source.id === target.id) return;

      const now = new Date().toISOString();
      const newFolder: FolderContainer = {
        id: `folder-${crypto.randomUUID().slice(0, 8)}`,
        title: settings.mergedFolderTitle || '新建文件夹',
        x: target.x,
        y: target.y,
        w: target.w,
        h: target.h,
        displayMode: 'grid',
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      };

      const nextItems = displayedDoc.items.map((it) => {
        if (it.id === target.id) {
          return { ...it, parentId: newFolder.id, order: 0, updatedAt: now };
        }
        if (it.id === source.id) {
          return { ...it, parentId: newFolder.id, order: 1, updatedAt: now };
        }
        return it;
      });

      setSelectedIds([newFolder.id]);
      void commitDocState([...displayedDoc.folders, newFolder], nextItems);
      showToast(`已合并「${target.title}」与「${source.title}」为新文件夹`);
    },
    [displayedDoc.folders, displayedDoc.items, commitDocState, showToast, settings.mergedFolderTitle]
  );

  const handleDropChildToCanvas = useCallback(
    (itemId: string, x: number, y: number, nextEntities: CanvasGridEntity[]) => {
      const now = new Date().toISOString();
      const posMap = new Map(nextEntities.map((e) => [e.id, e]));

      const nextFolders = displayedDoc.folders.map((f) => {
        const upd = posMap.get(f.id);
        return upd ? { ...f, x: upd.x, y: upd.y, updatedAt: now } : f;
      });

      const nextItems = displayedDoc.items.map((it) => {
        if (it.id === itemId) {
          const nextW = settings.dragOutItemSizeMode === 'preserve' ? clampGridSize(it.w) : 1;
          const nextH = settings.dragOutItemSizeMode === 'preserve' ? clampGridSize(it.h) : 1;
          return {
            ...it,
            parentId: null,
            x,
            y,
            w: nextW,
            h: nextH,
            order: 0,
            updatedAt: now,
          };
        }
        const upd = posMap.get(it.id);
        if (it.parentId === null && upd) {
          return { ...it, x: upd.x, y: upd.y, updatedAt: now };
        }
        return it;
      });

      const nextWidgets = (displayedDoc.widgets ?? []).map((w) => {
        if (w.kind !== 'carousel' && w.kind !== 'note') return w;
        const upd = posMap.get(w.id);
        return upd ? { ...w, x: upd.x, y: upd.y, updatedAt: now } : w;
      });

      setSelectedIds([itemId]);
      void commitDocState(nextFolders, nextItems, true, displayedDoc.zones ?? [], nextWidgets);
    },
    [
      displayedDoc.folders,
      displayedDoc.items,
      displayedDoc.zones,
      displayedDoc.widgets,
      commitDocState,
      settings.dragOutItemSizeMode,
    ]
  );

  const handleReorderFolderItems = useCallback(
    (folderId: string, itemIds: string[]) => {
      const orderMap = new Map(itemIds.map((id, idx) => [id, idx]));
      const now = new Date().toISOString();
      const nextItems = displayedDoc.items.map((it) => {
        if (it.parentId !== folderId) return it;
        const nextOrder = orderMap.get(it.id);
        return nextOrder !== undefined ? { ...it, order: nextOrder, updatedAt: now } : it;
      });
      void commitDocState(displayedDoc.folders, nextItems);
    },
    [displayedDoc.folders, displayedDoc.items, commitDocState]
  );

  function handleExtractItemToCanvas(itemId: string) {
    const item = displayedDoc.items.find((i) => i.id === itemId);
    if (!item || item.parentId === null) return;
    const srcFolder = displayedDoc.folders.find((f) => f.id === item.parentId);
    const slot = findNearestFreeSlot(topLevelEntities, 1, 1, srcFolder?.x ?? 0, srcFolder?.y ?? 0);
    const now = new Date().toISOString();

    const nextItems = displayedDoc.items.map((it) =>
      it.id === itemId
        ? { ...it, parentId: null, x: slot.x, y: slot.y, w: 1, h: 1, order: 0, updatedAt: now }
        : it
    );
    void commitDocState(displayedDoc.folders, nextItems);
    showToast(`已将「${item.title}」移出到桌面 (${slot.x}, ${slot.y})`);
  }

  function handleRequestDeleteFolder(folder: FolderContainer) {
    const count = displayedDoc.items.filter((i) => i.parentId === folder.id).length;
    if (count === 0) {
      void commitDocState(
        displayedDoc.folders.filter((f) => f.id !== folder.id),
        displayedDoc.items
      );
      if (activeFolderId === folder.id) setActiveFolderId(null);
      if (editorDraft?.mode === 'edit-folder' && editorDraft.folder.id === folder.id) {
        setEditorDraft(null);
      }
      setSelectedIds((prev) => prev.filter((id) => id !== folder.id));
      return;
    }
    setDissolveTarget(folder);
  }

  function handleDissolveKeepItems(folderId: string) {
    const folder = displayedDoc.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const now = new Date().toISOString();
    const nextFolders = displayedDoc.folders.filter((f) => f.id !== folderId);
    const occupied = getTopLevelEntities({
      folders: nextFolders,
      items: displayedDoc.items,
      widgets: displayedDoc.widgets ?? [],
    }).map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));

    const folderChildren = displayedDoc.items
      .filter((i) => i.parentId === folderId)
      .sort((a, b) => a.order - b.order);
    const slotMap = new Map<string, { x: number; y: number }>();

    for (const child of folderChildren) {
      const slot = findNearestFreeSlot(occupied, 1, 1, folder.x, folder.y);
      slotMap.set(child.id, slot);
      occupied.push({ x: slot.x, y: slot.y, w: 1, h: 1 });
    }

    const nextItems = displayedDoc.items.map((it) => {
      const slot = slotMap.get(it.id);
      if (!slot) return it;
      return {
        ...it,
        parentId: null,
        x: slot.x,
        y: slot.y,
        w: 1,
        h: 1,
        order: 0,
        updatedAt: now,
      };
    });

    setDissolveTarget(null);
    if (activeFolderId === folderId) setActiveFolderId(null);
    if (editorDraft?.mode === 'edit-folder' && editorDraft.folder.id === folderId) {
      setEditorDraft(null);
    }
    setSelectedIds((prev) => prev.filter((id) => id !== folderId));
    void commitDocState(nextFolders, nextItems);
    showToast(`已解散「${folder.title}」，${folderChildren.length} 个项目已移回桌面`);
  }

  function handleDeleteFolderAndItems(folderId: string) {
    const folder = displayedDoc.folders.find((f) => f.id === folderId);
    setDissolveTarget(null);
    if (activeFolderId === folderId) setActiveFolderId(null);
    if (editorDraft?.mode === 'edit-folder' && editorDraft.folder.id === folderId) {
      setEditorDraft(null);
    }
    setSelectedIds((prev) => prev.filter((id) => id !== folderId));
    void commitDocState(
      displayedDoc.folders.filter((f) => f.id !== folderId),
      displayedDoc.items.filter((i) => i.parentId !== folderId)
    );
    if (folder) showToast(`已删除「${folder.title}」及其内部项目`);
  }

  function getViewportCenterGrid(w = 1, h = 1): { x: number; y: number } {
    const step = doc.grid.cellSize + doc.grid.gap;
    const cx = (window.innerWidth / 2 - view.panX) / view.scale;
    const cy = ((window.innerHeight - 56) / 2 - view.panY) / view.scale;
    return {
      x: snapQuarter(cx / step - w / 2),
      y: snapQuarter(cy / step - h / 2),
    };
  }

  function placeNearAnchor(w: number, h: number, anchor: { x: number; y: number }) {
    const prefersDirect = !topLevelEntities.some((e) =>
      rectsOverlap({ x: anchor.x, y: anchor.y, w, h }, e)
    );
    return prefersDirect
      ? anchor
      : findNearestFreeSlot(topLevelEntities, w, h, anchor.x, anchor.y);
  }

  const revealAndHighlightEntity = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, id: string) => {
      const step = doc.grid.cellSize + doc.grid.gap;
      const pxLeft = rect.x * step;
      const pxTop = rect.y * step;
      const pxW = rect.w * doc.grid.cellSize + Math.max(0, rect.w - 1) * doc.grid.gap;
      const pxH = rect.h * doc.grid.cellSize + Math.max(0, rect.h - 1) * doc.grid.gap;

      const screenLeft = pxLeft * view.scale + view.panX;
      const screenTop = pxTop * view.scale + view.panY;
      const screenRight = screenLeft + pxW * view.scale;
      const screenBottom = screenTop + pxH * view.scale;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const outOfBounds =
        screenLeft < 36 ||
        screenRight > vw - 36 ||
        screenTop < 72 ||
        screenBottom > vh - 116;

      if (outOfBounds) {
        const cx = pxLeft + pxW / 2;
        const cy = pxTop + pxH / 2;
        if (flyTimerRef.current !== null) {
          window.clearTimeout(flyTimerRef.current);
        }
        setFlyTransition(true);
        setView((prev) => ({
          scale: prev.scale,
          panX: Math.round(vw / 2 - cx * prev.scale),
          panY: Math.round((vh - 56) / 2 - cy * prev.scale),
        }));
        flyTimerRef.current = window.setTimeout(() => {
          flyTimerRef.current = null;
          setFlyTransition(false);
        }, 360);
      }

      setSelectedIds([id]);
      if (newlyCreatedTimerRef.current !== null) {
        window.clearTimeout(newlyCreatedTimerRef.current);
      }
      setNewlyCreatedId(id);
      newlyCreatedTimerRef.current = window.setTimeout(() => {
        newlyCreatedTimerRef.current = null;
        setNewlyCreatedId((cur) => (cur === id ? null : cur));
      }, 1600);
    },
    [doc.grid.cellSize, doc.grid.gap, view.panX, view.panY, view.scale]
  );

  function worldPosToGrid(worldX?: number, worldY?: number, w = 1, h = 1): { x: number; y: number } {
    const step = doc.grid.cellSize + doc.grid.gap;
    if (typeof worldX === 'number' && typeof worldY === 'number') {
      return { x: snapQuarter(worldX / step), y: snapQuarter(worldY / step) };
    }
    return getViewportCenterGrid(w, h);
  }

  function handleCreateZoneQuick(worldX?: number, worldY?: number) {
    if (!editMode) setEditMode(true);
    const now = new Date().toISOString();
    const anchor = worldPosToGrid(worldX, worldY, 4, 2);
    const id = `zone-${crypto.randomUUID().slice(0, 8)}`;
    const newZone: ZoneContainer = {
      id,
      title: '新分区',
      x: anchor.x,
      y: anchor.y,
      w: 4,
      h: 2,
      isPrivate: false,
      createdAt: now,
      updatedAt: now,
    };
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      [...(displayedDoc.zones ?? []), newZone],
      displayedDoc.widgets ?? []
    );
    revealAndHighlightEntity(newZone, id);
    setInlineEditingId(id);
  }

  function handleCreateZoneFromSelection() {
    if (!editMode) setEditMode(true);
    const selSet = new Set(selectedIds);
    const textList = (displayedDoc.widgets ?? []).filter(
      (w): w is FreeTextWidget => w.kind === 'text'
    );
    const selectedBoxes = [
      ...topLevelEntities.filter((e) => selSet.has(e.id)),
      ...textList.filter((t) => selSet.has(t.id)),
    ];
    if (selectedBoxes.length === 0) {
      handleCreateZoneQuick();
      return;
    }
    const minX = Math.min(...selectedBoxes.map((b) => b.x));
    const minY = Math.min(...selectedBoxes.map((b) => b.y));
    const maxX = Math.max(...selectedBoxes.map((b) => b.x + b.w));
    const maxY = Math.max(...selectedBoxes.map((b) => b.y + b.h));
    const now = new Date().toISOString();
    const id = `zone-${crypto.randomUUID().slice(0, 8)}`;
    const newZone: ZoneContainer = {
      id,
      title: '新分区',
      x: snapQuarter(minX),
      y: snapQuarter(minY),
      w: clampZoneSize(maxX - minX),
      h: clampZoneSize(maxY - minY),
      isPrivate: false,
      createdAt: now,
      updatedAt: now,
    };
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      [...(displayedDoc.zones ?? []), newZone],
      displayedDoc.widgets ?? []
    );
    revealAndHighlightEntity(newZone, id);
    setInlineEditingId(id);
  }

  function handleCreateNoteQuick(worldX?: number, worldY?: number) {
    if (!editMode) setEditMode(true);
    const now = new Date().toISOString();
    const anchor = worldPosToGrid(worldX, worldY, 2, 2);
    const slot = placeNearAnchor(2, 2, anchor);
    const id = `note-${crypto.randomUUID().slice(0, 8)}`;
    const newNote: NoteWidget = {
      id,
      kind: 'note',
      title: '随手便签',
      content: '',
      tint: '#fef3c7',
      isPrivate: false,
      x: slot.x,
      y: slot.y,
      w: 2,
      h: 2,
      createdAt: now,
      updatedAt: now,
    };
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      [...(displayedDoc.widgets ?? []), newNote]
    );
    revealAndHighlightEntity(newNote, id);
    setInlineEditingId(id);
  }

  function handleCreateTextQuick(worldX?: number, worldY?: number) {
    if (!editMode) setEditMode(true);
    const now = new Date().toISOString();
    const anchor = worldPosToGrid(worldX, worldY, 3, 1);
    const id = `text-${crypto.randomUUID().slice(0, 8)}`;
    const newText: FreeTextWidget = {
      id,
      kind: 'text',
      text: '双击编辑文字',
      fontSize: 24,
      weight: 'bold',
      align: 'left',
      x: snapQuarter(anchor.x),
      y: snapQuarter(anchor.y),
      w: 3,
      h: 1,
      createdAt: now,
      updatedAt: now,
    };
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      [...(displayedDoc.widgets ?? []), newText]
    );
    revealAndHighlightEntity(newText, id);
    setInlineEditingId(id);
  }

  function openItemCreator(worldX?: number, worldY?: number) {
    const initialPos =
      typeof worldX === 'number' && typeof worldY === 'number'
        ? worldPosToGrid(worldX, worldY)
        : undefined;
    setEditorDraft({ mode: 'create-item', defaultParentId: null, initialPos });
  }

  function openFolderCreator(worldX?: number, worldY?: number) {
    const initialPos =
      typeof worldX === 'number' && typeof worldY === 'number'
        ? worldPosToGrid(worldX, worldY)
        : undefined;
    setEditorDraft({ mode: 'create-folder', initialPos });
  }

  function openZwCreator(
    kind: 'zone' | 'carousel' | 'text' | 'note',
    worldX?: number,
    worldY?: number
  ) {
    if (kind === 'zone') {
      handleCreateZoneQuick(worldX, worldY);
      return;
    }
    if (kind === 'note') {
      handleCreateNoteQuick(worldX, worldY);
      return;
    }
    if (kind === 'text') {
      handleCreateTextQuick(worldX, worldY);
      return;
    }
    const initialPos =
      typeof worldX === 'number' && typeof worldY === 'number'
        ? worldPosToGrid(worldX, worldY)
        : undefined;
    setZwDraft({ mode: 'create-carousel', initialPos });
  }

  function openWidgetDraft(widget: CanvasWidget) {
    if (widget.kind === 'carousel') setZwDraft({ mode: 'edit-carousel', widget });
    else if (widget.kind === 'text') setZwDraft({ mode: 'edit-text', widget });
    else setZwDraft({ mode: 'edit-note', widget });
  }

  function handleRequestEditNote(note: NoteWidget) {
    if (unlocked) {
      setInlineEditingId(note.id);
      return;
    }
    setUnlockModal({
      open: true,
      reason: '编辑便签内容前请验证管理密码',
      afterUnlock: 'none',
      widgetToEdit: note,
    });
  }

  function handleCommitInlineZoneTitle(zone: ZoneContainer, nextTitle: string) {
    setInlineEditingId((cur) => (cur === zone.id ? null : cur));
    if (nextTitle === zone.title) return;
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      (displayedDoc.zones ?? []).map((z) =>
        z.id === zone.id ? { ...z, title: nextTitle, updatedAt: now } : z
      ),
      displayedDoc.widgets ?? []
    );
  }

  function handleCommitInlineNote(note: NoteWidget, title: string, content: string) {
    setInlineEditingId((cur) => (cur === note.id ? null : cur));
    if (title === note.title && content === note.content) return;
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).map((w) =>
        w.id === note.id && w.kind === 'note' ? { ...w, title, content, updatedAt: now } : w
      )
    );
  }

  function handleCommitInlineText(widget: FreeTextWidget, nextText: string) {
    setInlineEditingId((cur) => (cur === widget.id ? null : cur));
    if (nextText === widget.text) return;
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).map((w) =>
        w.id === widget.id && w.kind === 'text' ? { ...w, text: nextText, updatedAt: now } : w
      )
    );
  }

  function handleSetItemAccent(item: BookmarkItem, accent?: string) {
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items.map((it) => (it.id === item.id ? { ...it, accent, updatedAt: now } : it))
    );
  }

  function handlePatchTextWidget(
    widget: FreeTextWidget,
    patch: Partial<Pick<FreeTextWidget, 'fontSize' | 'weight' | 'align' | 'color'>>
  ) {
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).map((w) =>
        w.id === widget.id && w.kind === 'text' ? { ...w, ...patch, updatedAt: now } : w
      )
    );
  }

  function handleSetNoteTint(widget: NoteWidget, tint?: string) {
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).map((w) =>
        w.id === widget.id && w.kind === 'note' ? { ...w, tint, updatedAt: now } : w
      )
    );
  }

  function handlePatchCarouselWidget(
    widget: CarouselWidget,
    patch: Partial<Pick<CarouselWidget, 'transition' | 'fit'>>
  ) {
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).map((w) =>
        w.id === widget.id && w.kind === 'carousel' ? { ...w, ...patch, updatedAt: now } : w
      )
    );
  }

  function handleEditAnyEntity(entity: CanvasGridEntity) {
    if (entity.kind === 'folder') {
      setEditorDraft({ mode: 'edit-folder', folder: entity });
    } else if (entity.kind === 'item') {
      setEditorDraft({ mode: 'edit-item', item: entity });
    } else {
      handleEditWidget(entity);
    }
  }

  function handleEditWidget(widget: CanvasWidget) {
    if (!unlocked) {
      setUnlockModal({
        open: true,
        reason:
          widget.kind === 'note'
            ? '编辑便签内容前请验证管理密码'
            : '编辑小部件前请验证管理密码',
        afterUnlock: 'none',
        widgetToEdit: widget,
      });
      return;
    }
    openWidgetDraft(widget);
  }

  function handleSetZoneAccent(zone: ZoneContainer, accent?: string) {
    const now = new Date().toISOString();
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      (displayedDoc.zones ?? []).map((z) =>
        z.id === zone.id ? { ...z, accent, updatedAt: now } : z
      ),
      displayedDoc.widgets ?? []
    );
  }

  function handleToggleZonePrivate(zone: ZoneContainer) {
    const now = new Date().toISOString();
    const nextPrivate = !zone.isPrivate;
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      (displayedDoc.zones ?? []).map((z) =>
        z.id === zone.id ? { ...z, isPrivate: nextPrivate, updatedAt: now } : z
      ),
      displayedDoc.widgets ?? []
    );
    showToast(nextPrivate ? `已将分区「${zone.title}」设为私密` : `已将分区「${zone.title}」设为公开`);
  }

  function handleDeleteZone(zoneId: string) {
    setZwDraft((cur) => (cur?.mode === 'edit-zone' && cur.zone.id === zoneId ? null : cur));
    setSelectedIds((prev) => prev.filter((id) => id !== zoneId));
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      (displayedDoc.zones ?? []).filter((z) => z.id !== zoneId),
      displayedDoc.widgets ?? []
    );
  }

  function handleToggleNotePrivate(note: NoteWidget) {
    const now = new Date().toISOString();
    const nextPrivate = !note.isPrivate;
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).map((w) =>
        w.id === note.id && w.kind === 'note' ? { ...w, isPrivate: nextPrivate, updatedAt: now } : w
      )
    );
    showToast(nextPrivate ? '已将该便签设为私密' : '已将该便签设为公开');
  }

  function handleDeleteWidget(widgetId: string) {
    setZwDraft((cur) =>
      (cur?.mode === 'edit-carousel' || cur?.mode === 'edit-text' || cur?.mode === 'edit-note') &&
      cur.widget.id === widgetId
        ? null
        : cur
    );
    setSelectedIds((prev) => prev.filter((id) => id !== widgetId));
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      displayedDoc.zones ?? [],
      (displayedDoc.widgets ?? []).filter((w) => w.id !== widgetId)
    );
  }

  function handleMobileSaveNote(payload: {
    id?: string;
    title: string;
    content: string;
    tint?: string;
    isPrivate?: boolean;
  }) {
    const now = new Date().toISOString();
    const curWidgets = doc.widgets ?? [];
    if (payload.id) {
      const nextWidgets = curWidgets.map((w) =>
        w.kind === 'note' && w.id === payload.id
          ? {
              ...w,
              title: payload.title,
              content: payload.content,
              tint: payload.tint,
              isPrivate: Boolean(payload.isPrivate),
              updatedAt: now,
            }
          : w
      );
      void commitDocState(doc.folders, doc.items, true, doc.zones ?? [], nextWidgets);
      showToast('已保存便签');
      return;
    }

    const anchor = worldPosToGrid(undefined, undefined, 2, 2);
    const slot = placeNearAnchor(2, 2, anchor);
    const newNote: NoteWidget = {
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      kind: 'note',
      title: payload.title,
      content: payload.content,
      tint: payload.tint,
      isPrivate: Boolean(payload.isPrivate),
      x: slot.x,
      y: slot.y,
      w: 2,
      h: 2,
      createdAt: now,
      updatedAt: now,
    };
    void commitDocState(doc.folders, doc.items, true, doc.zones ?? [], [...curWidgets, newNote]);
    showToast('已新建便签');
  }

  function handleSaveZoneWidget(payload: ZoneWidgetSavePayload): string | null {
    if (!zwDraft) return null;
    const now = new Date().toISOString();
    const curZones = displayedDoc.zones ?? [];
    const curWidgets = displayedDoc.widgets ?? [];

    if (payload.kind === 'zone') {
      if (zwDraft.mode === 'edit-zone') {
        const nextZones = curZones.map((z) =>
          z.id === zwDraft.zone.id
            ? {
                ...z,
                title: payload.title,
                accent: payload.accent,
                isPrivate: payload.isPrivate,
                w: payload.w,
                h: payload.h,
                updatedAt: now,
              }
            : z
        );
        void commitDocState(displayedDoc.folders, displayedDoc.items, true, nextZones, curWidgets);
        setZwDraft(null);
        return null;
      }
      const base =
        zwDraft.mode === 'create-zone' && zwDraft.initialPos
          ? zwDraft.initialPos
          : getViewportCenterGrid(payload.w, payload.h);
      const id = `zone-${crypto.randomUUID().slice(0, 8)}`;
      const newZone: ZoneContainer = {
        id,
        title: payload.title,
        x: snapQuarter(base.x),
        y: snapQuarter(base.y),
        w: payload.w,
        h: payload.h,
        accent: payload.accent,
        isPrivate: payload.isPrivate,
        createdAt: now,
        updatedAt: now,
      };
      void commitDocState(
        displayedDoc.folders,
        displayedDoc.items,
        true,
        [...curZones, newZone],
        curWidgets
      );
      revealAndHighlightEntity(newZone, id);
      setZwDraft(null);
      return null;
    }

    if (payload.kind === 'text') {
      if (zwDraft.mode === 'edit-text') {
        const nextWidgets = curWidgets.map((w) =>
          w.id === zwDraft.widget.id && w.kind === 'text'
            ? {
                ...w,
                text: payload.text,
                fontSize: payload.fontSize,
                color: payload.color,
                weight: payload.weight,
                align: payload.align,
                w: payload.w,
                h: payload.h,
                updatedAt: now,
              }
            : w
        );
        void commitDocState(displayedDoc.folders, displayedDoc.items, true, curZones, nextWidgets);
        setZwDraft(null);
        return null;
      }
      const base =
        zwDraft.mode === 'create-text' && zwDraft.initialPos
          ? zwDraft.initialPos
          : getViewportCenterGrid(payload.w, payload.h);
      const id = `text-${crypto.randomUUID().slice(0, 8)}`;
      const newText: FreeTextWidget = {
        id,
        kind: 'text',
        text: payload.text,
        fontSize: payload.fontSize,
        color: payload.color,
        weight: payload.weight,
        align: payload.align,
        x: snapQuarter(base.x),
        y: snapQuarter(base.y),
        w: payload.w,
        h: payload.h,
        createdAt: now,
        updatedAt: now,
      };
      void commitDocState(
        displayedDoc.folders,
        displayedDoc.items,
        true,
        curZones,
        [...curWidgets, newText]
      );
      revealAndHighlightEntity(newText, id);
      setZwDraft(null);
      return null;
    }

    if (payload.kind === 'carousel') {
      if (zwDraft.mode === 'edit-carousel') {
        const existing = zwDraft.widget;
        let nextDoc = displayedDoc;
        if (payload.w !== existing.w || payload.h !== existing.h) {
          const res = solveResize(topLevelEntities, existing.id, payload.w, payload.h);
          if (!res.ok) return res.message;
          nextDoc = applyEntityLayoutToDoc(displayedDoc, res.entities, now);
        }
        const nextWidgets = (nextDoc.widgets ?? curWidgets).map((w) =>
          w.id === existing.id && w.kind === 'carousel'
            ? {
                ...w,
                title: payload.title,
                images: payload.images,
                intervalSec: payload.intervalSec,
                transition: payload.transition,
                fit: payload.fit,
                updatedAt: now,
              }
            : w
        );
        void commitDocState(nextDoc.folders, nextDoc.items, true, curZones, nextWidgets);
        setZwDraft(null);
        return null;
      }
      const anchor =
        zwDraft.mode === 'create-carousel' && zwDraft.initialPos
          ? zwDraft.initialPos
          : getViewportCenterGrid(payload.w, payload.h);
      const slot = placeNearAnchor(payload.w, payload.h, anchor);
      const id = `carousel-${crypto.randomUUID().slice(0, 8)}`;
      const newCarousel: CanvasWidget = {
        id,
        kind: 'carousel',
        title: payload.title,
        images: payload.images,
        intervalSec: payload.intervalSec,
        transition: payload.transition,
        fit: payload.fit,
        x: slot.x,
        y: slot.y,
        w: payload.w,
        h: payload.h,
        createdAt: now,
        updatedAt: now,
      };
      void commitDocState(
        displayedDoc.folders,
        displayedDoc.items,
        true,
        curZones,
        [...curWidgets, newCarousel]
      );
      revealAndHighlightEntity(newCarousel, id);
      setZwDraft(null);
      return null;
    }

    // NoteWidget
    if (zwDraft.mode === 'edit-note') {
      const existing = zwDraft.widget;
      let nextDoc = displayedDoc;
      if (payload.w !== existing.w || payload.h !== existing.h) {
        const res = solveResize(topLevelEntities, existing.id, payload.w, payload.h);
        if (!res.ok) return res.message;
        nextDoc = applyEntityLayoutToDoc(displayedDoc, res.entities, now);
      }
      const nextWidgets = (nextDoc.widgets ?? curWidgets).map((w) =>
        w.id === existing.id && w.kind === 'note'
          ? {
              ...w,
              title: payload.title,
              content: payload.content,
              tint: payload.tint,
              isPrivate: payload.isPrivate,
              updatedAt: now,
            }
          : w
      );
      void commitDocState(nextDoc.folders, nextDoc.items, true, curZones, nextWidgets);
      setZwDraft(null);
      return null;
    }

    const anchor =
      zwDraft.mode === 'create-note' && zwDraft.initialPos
        ? zwDraft.initialPos
        : getViewportCenterGrid(payload.w, payload.h);
    const slot = placeNearAnchor(payload.w, payload.h, anchor);
    const id = `note-${crypto.randomUUID().slice(0, 8)}`;
    const newNote: NoteWidget = {
      id,
      kind: 'note',
      title: payload.title,
      content: payload.content,
      tint: payload.tint,
      isPrivate: payload.isPrivate,
      x: slot.x,
      y: slot.y,
      w: payload.w,
      h: payload.h,
      createdAt: now,
      updatedAt: now,
    };
    void commitDocState(
      displayedDoc.folders,
      displayedDoc.items,
      true,
      curZones,
      [...curWidgets, newNote]
    );
    revealAndHighlightEntity(newNote, id);
    setZwDraft(null);
    return null;
  }

  const activeFolder = displayedDoc.folders.find((f) => f.id === activeFolderId) ?? null;
  const activeFolderItems = useMemo(() => {
    if (!activeFolder) return [];
    const base = displayedDoc.items
      .filter((i) => i.parentId === activeFolder.id)
      .sort((a, b) => a.order - b.order);
    if (reorderPreview && reorderPreview.folderId === activeFolder.id) {
      const map = new Map(base.map((i) => [i.id, i]));
      return reorderPreview.itemIds
        .map((id) => map.get(id))
        .filter((x): x is BookmarkItem => Boolean(x));
    }
    return base;
  }, [activeFolder, displayedDoc.items, reorderPreview]);

  const activeMobileView: MobileDefaultView = mobileViewOverride ?? settings.mobileDefaultView;
  const showMobilePaged = isMobile && activeMobileView === 'paged';

  const handleSwitchMobileView = useCallback(
    (mode: MobileDefaultView) => {
      setMobileViewOverride(mode);
      if (mode === 'canvas') {
        setView(computeInitialView(displayedDoc, activeSettingsForViewport));
      }
    },
    [displayedDoc, activeSettingsForViewport]
  );

  const selectedSet = new Set(selectedIds);
  const selectedItemCount = displayedDoc.items.filter(
    (i) => i.parentId === null && selectedSet.has(i.id)
  ).length;
  const canWrapInZone = useMemo(() => {
    const textIds = new Set(
      (displayedDoc.widgets ?? []).filter((w) => w.kind === 'text').map((w) => w.id)
    );
    return (
      topLevelEntities.some((e) => selectedSet.has(e.id)) ||
      selectedIds.some((id) => textIds.has(id))
    );
  }, [displayedDoc.widgets, topLevelEntities, selectedIds, selectedSet]);

  const editInspectorTarget: EditInspectorTarget | null = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const selId = selectedIds[0];
    const ent = topLevelEntities.find((e) => e.id === selId);
    if (ent) {
      if (ent.kind === 'folder') return { kind: 'folder', folder: ent };
      if (ent.kind === 'item') return { kind: 'item', item: ent };
      if (ent.kind === 'note') return { kind: 'note', widget: ent };
      return { kind: 'carousel', widget: ent };
    }
    const zone = (displayedDoc.zones ?? []).find((z) => z.id === selId);
    if (zone) return { kind: 'zone', zone };
    const textW = (displayedDoc.widgets ?? []).find(
      (w): w is FreeTextWidget => w.kind === 'text' && w.id === selId
    );
    if (textW) return { kind: 'text', widget: textW };
    return null;
  }, [selectedIds, topLevelEntities, displayedDoc.zones, displayedDoc.widgets]);

  const visibleNotes = useMemo(
    () => (displayedDoc.widgets ?? []).filter((w): w is NoteWidget => w.kind === 'note'),
    [displayedDoc.widgets]
  );

  return (
    <div className="relative w-full h-full overflow-hidden">
      <TopLoadBar />
      {settingsOpen && unlocked ? (
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center text-xs text-[var(--ink-muted)]">
              正在打开设置中心...
            </div>
          }
        >
          <SettingsView
            settings={settings}
            doc={doc}
            lockedViewportOrigin={doc.publicLayout?.viewportOrigin ?? null}
            onResetLockedViewportOrigin={() => {
              const curDoc = docRef.current;
              const curPl = curDoc.publicLayout ?? { positions: {} };
              commitDocState(
                curDoc.folders,
                curDoc.items,
                true,
                curDoc.zones,
                curDoc.widgets,
                {
                  nextPublicLayout: { ...curPl, viewportOrigin: null },
                  replaceCanonical: true,
                }
              );
              showToast('已重置「解锁前」视野锚点');
            }}
            dark={dark}
            themeMode={themeMode}
            onToggleDark={toggleDark}
            onSetAutoTheme={setAutoTheme}
            onBack={() => setSettingsOpen(false)}
            onLock={() => void handleLockToggle()}
            onUpdateSettings={handleUpdateSettings}
            onCanvasReplaced={(nextDoc, nextSettings) => {
              docRef.current = nextDoc;
              setDoc(nextDoc);
              if (nextSettings) setSettings(nextSettings);
            }}
            onToast={showToast}
          />
        </Suspense>
      ) : (
        <>
          {showMobilePaged ? (
            <MobileNavView
              settings={settings}
              folders={displayedDoc.folders}
              items={displayedDoc.items}
              notes={visibleNotes}
              loading={loading}
              unlocked={unlocked}
              hasPrivateHidden={hasPrivateHidden}
              dark={dark}
              themeMode={themeMode}
              onToggleDark={toggleDark}
              onSetAutoTheme={setAutoTheme}
              onLockToggle={() => void handleLockToggle()}
              onRequestUnlock={(reason) =>
                setUnlockModal({
                  open: true,
                  reason: reason || '请输入管理密码解锁后操作',
                })
              }
              onSwitchToCanvas={() => handleSwitchMobileView('canvas')}
              onOpenSettings={() => setSettingsOpen(true)}
              onCreateItem={(defaultParentId) =>
                setEditorDraft({ mode: 'create-item', defaultParentId })
              }
              onEditItem={(item) => setEditorDraft({ mode: 'edit-item', item })}
              onEditFolder={(folder) => setEditorDraft({ mode: 'edit-folder', folder })}
              onSaveNote={handleMobileSaveNote}
              onDeleteNote={handleDeleteWidget}
            />
          ) : (
            <>
              <TopPillBar
                settings={settings}
                onOpenSearch={() => setSearchOpen(true)}
                unlocked={unlocked}
                hasPrivateHidden={hasPrivateHidden}
                onLockToggle={handleLockToggle}
                editMode={editMode}
                onToggleEditMode={() => void handleToggleEditMode()}
                layoutTarget={layoutTarget}
                onSwitchToUnlockedLayout={() => handleSwitchLayoutTarget('unlocked')}
                saveStatus={saveStatus}
                finishingEdit={finishingEdit}
                onOpenSettings={() => setSettingsOpen(true)}
                dark={dark}
                themeMode={themeMode}
                onToggleDark={toggleDark}
                onSetAutoTheme={setAutoTheme}
                showSwitchToPaged={isMobile && activeMobileView === 'canvas'}
                onSwitchToPaged={() => handleSwitchMobileView('paged')}
              />

              {loading ? (
                <div className="w-full h-full flex items-center justify-center text-sm text-[var(--ink-muted)]">
                  正在加载画布...
                </div>
              ) : (
                <InfiniteCanvas
                  ref={canvasRef}
                  entities={topLevelEntities}
                  folders={displayedDoc.folders}
                  items={displayedDoc.items}
                  zones={displayedDoc.zones ?? []}
                  widgets={displayedDoc.widgets ?? []}
                  grid={displayedDoc.grid}
                  settings={activeSettingsForViewport}
                  editMode={editMode}
                  marqueeMode={marqueeMode}
                  selectedIds={selectedIds}
                  scale={view.scale}
                  panX={view.panX}
                  panY={view.panY}
                  viewportOrigin={resolvedOrigin}
                  onViewportChange={setView}
                  onUpdateViewportOrigin={(origin) => void handleUpdateViewportOrigin(origin)}
                  onSelectIds={setSelectedIds}
                  onCommitLayout={handleCommitLayout}
                  onCommitZones={handleCommitZones}
                  onCommitZoneGroup={handleCommitZoneGroup}
                  onCommitTextWidgets={handleCommitTextWidgets}
                  onCommitEntitiesAndTexts={handleCommitEntitiesAndTexts}
                  onDeleteDraggingEntities={handleDeleteDraggingEntities}
                  onDeleteDraggingChildItem={handleDeleteDraggingChildItem}
                  onDraggingActiveChange={setIsAnyDragActive}
                  onMoveItemsToFolder={handleMoveItemsToFolder}
                  onMergeItemsToFolder={handleMergeItemsToFolder}
                  onDropChildToCanvas={handleDropChildToCanvas}
                  onReorderFolderItems={handleReorderFolderItems}
                  onPreviewReorderChange={setReorderPreview}
                  onModalHiddenForDragChange={setModalHiddenForDrag}
                  onDraggingChildIdChange={setDraggingChildId}
                  onCloseFolderModal={() => setActiveFolderId(null)}
                  onOpenFolder={(folder) => setActiveFolderId(folder.id)}
                  onEditEntity={handleEditAnyEntity}
                  onEditZone={(zone) => setZwDraft({ mode: 'edit-zone', zone })}
                  onEditWidget={handleEditWidget}
                  onRequestEditNote={handleRequestEditNote}
                  onCycleFolderMode={handleCycleFolderMode}
                  onOpenContextMenu={(e, target) =>
                    setContextMenu({ x: e.clientX, y: e.clientY, target })
                  }
                  flyTransition={flyTransition}
                  newlyCreatedId={newlyCreatedId}
                  inlineEditingId={inlineEditingId}
                  onStartInlineEdit={(id) => setInlineEditingId(id)}
                  onCommitInlineZoneTitle={handleCommitInlineZoneTitle}
                  onStartInlineNoteEdit={(note) => setInlineEditingId(note.id)}
                  onCommitInlineNote={handleCommitInlineNote}
                  onCommitInlineText={handleCommitInlineText}
                  onCancelInlineEdit={() => setInlineEditingId(null)}
                  onStatusToast={showToast}
                />
              )}

              {!loading && settings.showFolderNav && (
                <FolderNavBar
                  folders={displayedDoc.folders}
                  items={displayedDoc.items}
                  zones={displayedDoc.zones ?? []}
                  editMode={editMode}
                  onFocusFolder={handleFocusFolder}
                  onFocusZone={handleFocusZone}
                  onOpenFolder={(folder) => setActiveFolderId(folder.id)}
                />
              )}

              {!loading && (
                <ZoomControlPill
                  scale={view.scale}
                  editMode={editMode}
                  anchorMode={resolveActiveViewportMode(settings) === 'anchor'}
                  onZoomIn={() => handleZoomStep('in')}
                  onZoomOut={() => handleZoomStep('out')}
                  onResetView={handleResetView}
                />
              )}

              {editMode && !isAnyDragActive && (
                <EditDock
                  selectedCount={selectedIds.length}
                  selectedItemCount={selectedItemCount}
                  selectedTarget={editInspectorTarget}
                  canWrapInZone={canWrapInZone}
                  folders={displayedDoc.folders}
                  showAnchorButton={
                    settings.desktopViewportMode === 'anchor' ||
                    settings.mobileViewportMode === 'anchor'
                  }
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                  layoutTarget={layoutTarget}
                  onChangeLayoutTarget={handleSwitchLayoutTarget}
                  onSyncUnlockedToLocked={handleSyncUnlockedToLocked}
                  onCreateItem={() => openItemCreator()}
                  onCreateFolder={() => openFolderCreator()}
                  onCreateZone={() =>
                    canWrapInZone ? handleCreateZoneFromSelection() : handleCreateZoneQuick()
                  }
                  onCreateCarousel={() => openZwCreator('carousel')}
                  onCreateText={() => handleCreateTextQuick()}
                  onCreateNote={() => handleCreateNoteQuick()}
                  onCreateZoneFromSelection={handleCreateZoneFromSelection}
                  onSetViewportOrigin={() => void handleSetViewportOrigin()}
                  onEditSelected={() => {
                    if (selectedIds.length !== 1) return;
                    const selId = selectedIds[0];
                    const entity = topLevelEntities.find((e) => e.id === selId);
                    if (entity) {
                      handleEditAnyEntity(entity);
                      return;
                    }
                    const zone = (displayedDoc.zones ?? []).find((z) => z.id === selId);
                    if (zone) {
                      setZwDraft({ mode: 'edit-zone', zone });
                      return;
                    }
                    const widget = (displayedDoc.widgets ?? []).find((w) => w.id === selId);
                    if (widget) {
                      handleEditWidget(widget);
                    }
                  }}
                  onDeleteSelected={() => handleDeleteEntities(selectedIds)}
                  onMoveSelectedItemsToFolder={(folderId) => {
                    const itemIds = displayedDoc.items
                      .filter((i) => i.parentId === null && selectedSet.has(i.id))
                      .map((i) => i.id);
                    handleMoveItemsToFolder(itemIds, folderId);
                  }}
                  onStartInlineEdit={(id) => setInlineEditingId(id)}
                  onSetFolderAccent={handleSetFolderAccent}
                  onCycleFolderMode={handleCycleFolderMode}
                  onToggleFolderPrivate={handleToggleFolderPrivate}
                  onAddItemToFolder={(folderId) =>
                    setEditorDraft({ mode: 'create-item', defaultParentId: folderId })
                  }
                  onSetItemAccent={handleSetItemAccent}
                  onSetZoneAccent={handleSetZoneAccent}
                  onToggleZonePrivate={handleToggleZonePrivate}
                  onPatchTextWidget={handlePatchTextWidget}
                  onSetNoteTint={handleSetNoteTint}
                  onToggleNotePrivate={handleToggleNotePrivate}
                  onPatchCarouselWidget={handlePatchCarouselWidget}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                />
              )}

              <FolderModal
                folder={activeFolder}
                items={activeFolderItems}
                editMode={editMode}
                unlocked={unlocked}
                blockEscapeClose={Boolean(editorDraft || contextMenu)}
                openTarget={settings.openTarget}
                hiddenForDrag={modalHiddenForDrag}
                draggingItemId={draggingChildId}
                onClose={() => setActiveFolderId(null)}
                onOpenContextMenu={(e, target) =>
                  setContextMenu({ x: e.clientX, y: e.clientY, target })
                }
                onEditFolderProps={(folder) => setEditorDraft({ mode: 'edit-folder', folder })}
                onRequestDeleteFolder={handleRequestDeleteFolder}
                onAddItemToFolder={(folderId) =>
                  setEditorDraft({ mode: 'create-item', defaultParentId: folderId })
                }
                onEditItem={(item) => setEditorDraft({ mode: 'edit-item', item })}
                onReorderItems={handleReorderFolderItems}
                onExtractItemToCanvas={handleExtractItemToCanvas}
                onDeleteItem={(itemId) =>
                  void commitDocState(
                    displayedDoc.folders,
                    displayedDoc.items.filter((i) => i.id !== itemId)
                  )
                }
                onModalChildPointerDown={(e, folder, item, modalRect) =>
                  canvasRef.current?.startModalChildPointerDown(e, folder, item, modalRect)
                }
              />
            </>
          )}

          <Suspense fallback={null}>
            {editorDraft && (
              <ItemEditorModal
                draft={editorDraft}
                folders={displayedDoc.folders}
                settings={settings}
                onClose={() => setEditorDraft(null)}
                onSave={handleSaveEditor}
                onRequestDeleteFolder={handleRequestDeleteFolder}
                onRequestDeleteItem={(item) => {
                  setEditorDraft(null);
                  void commitDocState(
                    displayedDoc.folders,
                    displayedDoc.items.filter((i) => i.id !== item.id)
                  );
                  showToast('已删除书签');
                }}
              />
            )}

            {!showMobilePaged && zwDraft && (
              <ZoneWidgetEditorModal
                draft={zwDraft}
                onClose={() => setZwDraft(null)}
                onSave={handleSaveZoneWidget}
                onDeleteZone={handleDeleteZone}
                onDeleteWidget={handleDeleteWidget}
              />
            )}

            {dissolveTarget && (
              <DissolveFolderModal
                folder={dissolveTarget}
                itemCount={
                  displayedDoc.items.filter((i) => i.parentId === dissolveTarget.id).length
                }
                onClose={() => setDissolveTarget(null)}
                onDissolveKeepItems={handleDissolveKeepItems}
                onDeleteFolderAndItems={handleDeleteFolderAndItems}
              />
            )}

            {!showMobilePaged && searchOpen && (
              <SearchPalette
                open={searchOpen}
                folders={displayedDoc.folders}
                items={displayedDoc.items}
                zones={displayedDoc.zones ?? []}
                widgets={displayedDoc.widgets ?? []}
                openTarget={settings.openTarget}
                onClose={() => setSearchOpen(false)}
                onOpenFolder={(folder) => setActiveFolderId(folder.id)}
                onFocusRect={(rect, id) => flyToWorldRect(rect, id)}
              />
            )}

            {!showMobilePaged && contextMenu && (
              <ContextMenu
                menu={contextMenu}
                unlocked={unlocked}
                editMode={editMode}
                folders={displayedDoc.folders}
                onClose={() => setContextMenu(null)}
                onOpenFolder={(folder) => setActiveFolderId(folder.id)}
                onCycleFolderMode={handleCycleFolderMode}
                onSetFolderAccent={handleSetFolderAccent}
                onToggleFolderPrivate={handleToggleFolderPrivate}
                onEditFolder={(folder) => setEditorDraft({ mode: 'edit-folder', folder })}
                onAddItemToFolder={(folderId) =>
                  setEditorDraft({ mode: 'create-item', defaultParentId: folderId })
                }
                onDeleteFolder={handleRequestDeleteFolder}
                onEditItem={(item) => setEditorDraft({ mode: 'edit-item', item })}
                onMoveItemToFolder={(itemId, folderId) => handleMoveItemsToFolder([itemId], folderId)}
                onExtractItemToCanvas={handleExtractItemToCanvas}
                onDeleteItem={(itemId) =>
                  commitDocState(
                    displayedDoc.folders,
                    displayedDoc.items.filter((i) => i.id !== itemId)
                  )
                }
                onCopyUrl={handleCopyUrl}
                onCreateItem={(wx, wy) => openItemCreator(wx, wy)}
                onCreateFolder={(wx, wy) => openFolderCreator(wx, wy)}
                onCreateZone={(wx, wy) => openZwCreator('zone', wx, wy)}
                onCreateCarousel={(wx, wy) => openZwCreator('carousel', wx, wy)}
                onCreateText={(wx, wy) => openZwCreator('text', wx, wy)}
                onCreateNote={(wx, wy) => openZwCreator('note', wx, wy)}
                onEditZone={(zone) => setZwDraft({ mode: 'edit-zone', zone })}
                onSetZoneAccent={handleSetZoneAccent}
                onToggleZonePrivate={handleToggleZonePrivate}
                onDeleteZone={handleDeleteZone}
                onEditWidget={handleEditWidget}
                onRequestEditNote={handleRequestEditNote}
                onToggleNotePrivate={handleToggleNotePrivate}
                onDeleteWidget={handleDeleteWidget}
                onToggleEditMode={handleToggleEditMode}
                onResetView={handleResetView}
                onOpenSearch={() => setSearchOpen(true)}
              />
            )}

            {unlockModal.open && (
              <UnlockModal
                open={unlockModal.open}
                reason={unlockModal.reason}
                onClose={() => setUnlockModal({ open: false })}
                onUnlocked={async () => {
                  const nextAction = unlockModal.afterUnlock;
                  const widgetPending = unlockModal.widgetToEdit;
                  setUnlockModal({ open: false });
                  setLayoutTarget('unlocked');
                  const latestDoc = await refreshCanvas(true);
                  if (nextAction === 'edit') {
                    sessionDirtyRef.current = false;
                    setEditMode(true);
                  }
                  if (widgetPending) {
                    const refreshed = (latestDoc?.widgets ?? []).find(
                      (w) => w.id === widgetPending.id
                    );
                    const targetWidget = refreshed ?? widgetPending;
                    if (targetWidget.kind === 'note') {
                      setInlineEditingId(targetWidget.id);
                    } else {
                      openWidgetDraft(targetWidget);
                    }
                  } else {
                    showToast('已解锁，私密内容已显现');
                  }
                }}
              />
            )}
          </Suspense>
        </>
      )}

      {toast && (
        <div className="pointer-events-none fixed top-20 left-0 right-0 z-50 flex justify-center px-4">
          <div
            className={`rounded-full px-4 py-1.5 text-xs font-medium shadow-lg ${
              toast.tone === 'error'
                ? 'bg-[var(--accent-red)] text-white'
                : toast.tone === 'success'
                  ? 'bg-[var(--accent-emerald)] text-white'
                  : 'bg-[var(--ink-main)] text-[var(--bg-card)]'
            }`}
          >
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}
