import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Copy,
  Crosshair,
  FolderInput,
  FolderPlus,
  Images,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Plus,
  Redo2,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import type {
  BookmarkItem,
  CarouselWidget,
  FolderContainer,
  FreeTextWidget,
  NoteWidget,
  ZoneContainer,
} from '../../shared/types';
import type { EditLayoutTarget } from '../App';
import { SHORTCUT_REDO, SHORTCUT_UNDO } from '../utils/platform';

export type EditInspectorTarget =
  | { kind: 'folder'; folder: FolderContainer }
  | { kind: 'item'; item: BookmarkItem }
  | { kind: 'zone'; zone: ZoneContainer }
  | { kind: 'text'; widget: FreeTextWidget }
  | { kind: 'note'; widget: NoteWidget }
  | { kind: 'carousel'; widget: CarouselWidget };

const QUICK_ACCENTS = [
  '#ff5500',
  '#ec4899',
  '#8b5cf6',
  '#0ea5e9',
  '#10b981',
  '#eab308',
];

const TEXT_COLORS = [
  { value: '', label: '默认字色' },
  { value: '#141413', label: '墨黑' },
  { value: '#ff5500', label: '炽橙' },
  { value: '#0ea5e9', label: '晴空蓝' },
  { value: '#10b981', label: '翡翠绿' },
  { value: '#8b5cf6', label: '罗兰紫' },
  { value: '#f4f3ef', label: '暖白' },
];

const NOTE_TINTS = [
  { value: '', label: '素纸' },
  { value: '#fef3c7', label: '琥珀黄' },
  { value: '#d1fae5', label: '薄荷绿' },
  { value: '#e0f2fe', label: '晴空蓝' },
  { value: '#ffe4e6', label: '樱花粉' },
  { value: '#ede9fe', label: '薰衣紫' },
];

interface EditDockProps {
  selectedCount: number;
  selectedItemCount: number;
  selectedTarget: EditInspectorTarget | null;
  canWrapInZone: boolean;
  folders: FolderContainer[];
  showAnchorButton?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  layoutTarget: EditLayoutTarget;
  onChangeLayoutTarget: (target: EditLayoutTarget) => void;
  onSyncUnlockedToLocked: () => void;
  onCreateItem: () => void;
  onCreateFolder: () => void;
  onCreateZone: () => void;
  onCreateCarousel: () => void;
  onCreateText: () => void;
  onCreateNote: () => void;
  onCreateZoneFromSelection: () => void;
  onSetViewportOrigin: () => void;
  onEditSelected: () => void;
  onDeleteSelected: () => void;
  onMoveSelectedItemsToFolder: (folderId: string) => void;
  onStartInlineEdit: (id: string) => void;
  onSetFolderAccent: (folder: FolderContainer, accent?: string) => void;
  onCycleFolderMode: (folder: FolderContainer) => void;
  onToggleFolderPrivate: (folder: FolderContainer) => void;
  onAddItemToFolder: (folderId: string) => void;
  onSetItemAccent: (item: BookmarkItem, accent?: string) => void;
  onSetZoneAccent: (zone: ZoneContainer, accent?: string) => void;
  onToggleZonePrivate: (zone: ZoneContainer) => void;
  onPatchTextWidget: (
    widget: FreeTextWidget,
    patch: Partial<Pick<FreeTextWidget, 'fontSize' | 'weight' | 'align' | 'color'>>
  ) => void;
  onSetNoteTint: (widget: NoteWidget, tint?: string) => void;
  onToggleNotePrivate: (widget: NoteWidget) => void;
  onPatchCarouselWidget: (
    widget: CarouselWidget,
    patch: Partial<Pick<CarouselWidget, 'transition' | 'fit'>>
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditDock({
  selectedCount,
  selectedItemCount,
  selectedTarget,
  canWrapInZone,
  folders,
  showAnchorButton = true,
  canUndo,
  canRedo,
  layoutTarget,
  onChangeLayoutTarget,
  onSyncUnlockedToLocked,
  onCreateItem,
  onCreateFolder,
  onCreateZone,
  onCreateCarousel,
  onCreateText,
  onCreateNote,
  onCreateZoneFromSelection,
  onSetViewportOrigin,
  onEditSelected,
  onDeleteSelected,
  onMoveSelectedItemsToFolder,
  onStartInlineEdit,
  onSetFolderAccent,
  onCycleFolderMode,
  onToggleFolderPrivate,
  onAddItemToFolder,
  onSetItemAccent,
  onSetZoneAccent,
  onToggleZonePrivate,
  onPatchTextWidget,
  onSetNoteTint,
  onToggleNotePrivate,
  onPatchCarouselWidget,
  onUndo,
  onRedo,
}: EditDockProps) {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const syncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedItemCount === 0) {
      setFolderPickerOpen(false);
    }
  }, [selectedItemCount]);

  useEffect(() => {
    setConfirmSync(false);
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, [layoutTarget]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  const divider = <span className="h-4 w-px bg-[var(--border-hair)] mx-0.5 shrink-0" />;
  const chipBtn =
    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer shrink-0';

  const renderColorDots = (
    activeColor: string | undefined,
    onSelect: (hex?: string) => void
  ) => (
    <div className="flex items-center gap-1 shrink-0">
      {QUICK_ACCENTS.map((hex) => {
        const active = activeColor === hex;
        return (
          <button
            key={hex}
            type="button"
            onClick={() => onSelect(hex)}
            style={{ backgroundColor: hex }}
            className={`h-4 w-4 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${
              active ? 'ring-2 ring-offset-1 ring-[var(--ink-main)]' : ''
            }`}
            title={hex}
          >
            {active && <Check size={9} className="text-white" />}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onSelect(undefined)}
        className={`h-4 px-1.5 rounded-full text-[9px] border cursor-pointer ${
          !activeColor
            ? 'border-[var(--ink-main)] text-[var(--ink-main)] font-semibold'
            : 'border-[var(--border-hair)] text-[var(--ink-muted)] hover:text-[var(--ink-main)]'
        }`}
        title="清除主题色"
      >
        无
      </button>
    </div>
  );

  return (
    <div className="pointer-events-none fixed bottom-5 left-0 right-0 z-30 flex flex-col items-center gap-2 px-3">
      {folderPickerOpen && selectedItemCount > 0 && folders.length > 0 && (
        <div className="pointer-events-auto bento-modal px-2.5 py-2 flex flex-wrap items-center justify-center gap-1 max-w-md shadow-xl">
          <span className="text-[11px] text-[var(--ink-muted)] px-1.5">
            将 {selectedItemCount} 个项目移入：
          </span>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => {
                onMoveSelectedItemsToFolder(folder.id);
                setFolderPickerOpen(false);
              }}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-[var(--bg-subtle)] hover:bg-[var(--accent-orange)] hover:text-white border border-[var(--border-hair)] transition-colors cursor-pointer"
            >
              {folder.isPrivate && <Lock size={10} className="text-amber-500" />}
              <span>{folder.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Contextual Inspector Bar above main creation bar */}
      {selectedCount >= 2 && (
        <div className="pointer-events-auto pill-surface flex flex-wrap items-center justify-center gap-1 px-3 py-1.5 text-xs max-w-full">
          <span className="px-2 text-[var(--ink-muted)] font-medium">已选 {selectedCount} 项</span>
          {canWrapInZone && (
            <>
              {divider}
              <button
                type="button"
                onClick={onCreateZoneFromSelection}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-[var(--accent-orange)]/12 text-[var(--accent-orange)] hover:bg-[var(--accent-orange)] hover:text-white transition-colors cursor-pointer"
                title="自动计算外接矩形并创建分区框包裹所选项目"
              >
                <LayoutGrid size={12} />
                <span>设为分区</span>
              </button>
            </>
          )}
          {selectedItemCount > 0 && folders.length > 0 && (
            <button
              type="button"
              onClick={() => setFolderPickerOpen((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer ${
                folderPickerOpen
                  ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
                  : 'text-[var(--ink-main)] hover:bg-[var(--bg-subtle)]'
              }`}
            >
              <FolderInput size={12} />
              <span>移入文件夹</span>
            </button>
          )}
          {divider}
          <button
            type="button"
            onClick={onDeleteSelected}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
          >
            <Trash2 size={12} />
            <span>批量删除</span>
          </button>
        </div>
      )}

      {selectedCount === 1 && selectedTarget && (
        <div className="pointer-events-auto pill-surface flex flex-wrap items-center justify-center gap-1 px-3 py-1.5 text-xs max-w-[calc(100vw-24px)]">
          {selectedTarget.kind === 'folder' && (
            <>
              <span className="px-1.5 text-[11px] font-semibold text-[var(--ink-muted)] max-w-[96px] truncate">
                {selectedTarget.folder.title}
              </span>
              {divider}
              {renderColorDots(selectedTarget.folder.accent, (hex) =>
                onSetFolderAccent(selectedTarget.folder, hex)
              )}
              {divider}
              <button
                type="button"
                onClick={() => onCycleFolderMode(selectedTarget.folder)}
                className={chipBtn}
              >
                {selectedTarget.folder.displayMode === 'list' ? (
                  <LayoutGrid size={12} />
                ) : (
                  <List size={12} />
                )}
                <span>{selectedTarget.folder.displayMode === 'list' ? '切宫格' : '切列表'}</span>
              </button>
              <button
                type="button"
                onClick={() => onToggleFolderPrivate(selectedTarget.folder)}
                className={chipBtn}
              >
                {selectedTarget.folder.isPrivate ? (
                  <Unlock size={12} className="text-amber-500" />
                ) : (
                  <Lock size={12} className="text-amber-500" />
                )}
                <span>{selectedTarget.folder.isPrivate ? '公开' : '私密'}</span>
              </button>
              <button
                type="button"
                onClick={() => onAddItemToFolder(selectedTarget.folder.id)}
                className={chipBtn}
              >
                <Plus size={12} className="text-[var(--accent-orange)]" />
                <span>添加书签</span>
              </button>
              <button type="button" onClick={onEditSelected} className={chipBtn}>
                <SlidersHorizontal size={12} />
                <span>编辑详情</span>
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            </>
          )}

          {selectedTarget.kind === 'zone' && (
            <>
              <span className="px-1.5 text-[11px] font-semibold text-[var(--ink-muted)] max-w-[96px] truncate">
                分区 · {selectedTarget.zone.title}
              </span>
              {divider}
              {renderColorDots(selectedTarget.zone.accent, (hex) =>
                onSetZoneAccent(selectedTarget.zone, hex)
              )}
              {divider}
              {layoutTarget !== 'locked' && (
                <button
                  type="button"
                  onClick={() => onToggleZonePrivate(selectedTarget.zone)}
                  className={chipBtn}
                >
                  {selectedTarget.zone.isPrivate ? (
                    <Unlock size={12} className="text-amber-500" />
                  ) : (
                    <Lock size={12} className="text-amber-500" />
                  )}
                  <span>{selectedTarget.zone.isPrivate ? '公开' : '私密'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onStartInlineEdit(selectedTarget.zone.id)}
                className={chipBtn}
              >
                <Pencil size={12} />
                <span>改名</span>
              </button>
              <button type="button" onClick={onEditSelected} className={chipBtn}>
                <SlidersHorizontal size={12} />
                <span>详情</span>
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            </>
          )}

          {selectedTarget.kind === 'text' && (
            <>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onPatchTextWidget(selectedTarget.widget, {
                      fontSize: Math.max(14, selectedTarget.widget.fontSize - 4),
                    })
                  }
                  className="rounded-full px-2 py-1 text-xs font-semibold hover:bg-[var(--bg-subtle)] cursor-pointer"
                  title="减小字号"
                >
                  A-
                </button>
                <span className="text-[11px] font-mono text-[var(--ink-muted)] w-6 text-center">
                  {selectedTarget.widget.fontSize}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onPatchTextWidget(selectedTarget.widget, {
                      fontSize: Math.min(64, selectedTarget.widget.fontSize + 4),
                    })
                  }
                  className="rounded-full px-2 py-1 text-xs font-semibold hover:bg-[var(--bg-subtle)] cursor-pointer"
                  title="增大字号"
                >
                  A+
                </button>
              </div>
              {divider}
              <button
                type="button"
                onClick={() =>
                  onPatchTextWidget(selectedTarget.widget, {
                    weight: selectedTarget.widget.weight === 'bold' ? 'normal' : 'bold',
                  })
                }
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium cursor-pointer ${
                  selectedTarget.widget.weight === 'bold'
                    ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
                    : 'text-[var(--ink-main)] hover:bg-[var(--bg-subtle)]'
                }`}
                title="切换加粗"
              >
                <Bold size={12} />
                <span>加粗</span>
              </button>
              <div className="flex items-center gap-0.5 shrink-0">
                {(['left', 'center', 'right'] as const).map((al) => {
                  const active = selectedTarget.widget.align === al;
                  return (
                    <button
                      key={al}
                      type="button"
                      onClick={() => onPatchTextWidget(selectedTarget.widget, { align: al })}
                      className={`h-6 w-6 rounded-full flex items-center justify-center cursor-pointer ${
                        active
                          ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
                          : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)]'
                      }`}
                      title={al === 'left' ? '左对齐' : al === 'center' ? '居中对齐' : '右对齐'}
                    >
                      {al === 'left' ? (
                        <AlignLeft size={12} />
                      ) : al === 'center' ? (
                        <AlignCenter size={12} />
                      ) : (
                        <AlignRight size={12} />
                      )}
                    </button>
                  );
                })}
              </div>
              {divider}
              <div className="flex items-center gap-1 shrink-0">
                {TEXT_COLORS.map((c) => {
                  const active = (selectedTarget.widget.color || '') === c.value;
                  return (
                    <button
                      key={c.value || 'default'}
                      type="button"
                      onClick={() =>
                        onPatchTextWidget(selectedTarget.widget, {
                          color: c.value || undefined,
                        })
                      }
                      style={{
                        backgroundColor: c.value || 'var(--bg-subtle)',
                      }}
                      className={`h-4 w-4 rounded-full border border-[var(--border-strong)] cursor-pointer ${
                        active ? 'ring-2 ring-offset-1 ring-[var(--ink-main)]' : ''
                      }`}
                      title={c.label}
                    />
                  );
                })}
              </div>
              {divider}
              <button
                type="button"
                onClick={() => onStartInlineEdit(selectedTarget.widget.id)}
                className={chipBtn}
              >
                <Pencil size={12} />
                <span>改字</span>
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            </>
          )}

          {selectedTarget.kind === 'note' && (
            <>
              <span className="px-1.5 text-[11px] font-semibold text-[var(--ink-muted)] max-w-[96px] truncate">
                便签
              </span>
              {divider}
              <div className="flex items-center gap-1 shrink-0">
                {NOTE_TINTS.map((t) => {
                  const active = (selectedTarget.widget.tint || '') === t.value;
                  return (
                    <button
                      key={t.value || 'plain'}
                      type="button"
                      onClick={() => onSetNoteTint(selectedTarget.widget, t.value || undefined)}
                      style={{ backgroundColor: t.value || 'var(--bg-card)' }}
                      className={`h-4.5 w-4.5 rounded-full border border-[var(--border-strong)] cursor-pointer transition-transform hover:scale-110 ${
                        active ? 'ring-2 ring-offset-1 ring-[var(--ink-main)]' : ''
                      }`}
                      title={t.label}
                    />
                  );
                })}
              </div>
              {divider}
              <button
                type="button"
                onClick={() => onToggleNotePrivate(selectedTarget.widget)}
                className={chipBtn}
              >
                {selectedTarget.widget.isPrivate ? (
                  <Unlock size={12} className="text-amber-500" />
                ) : (
                  <Lock size={12} className="text-amber-500" />
                )}
                <span>{selectedTarget.widget.isPrivate ? '公开' : '私密'}</span>
              </button>
              <button
                type="button"
                onClick={() => onStartInlineEdit(selectedTarget.widget.id)}
                className={chipBtn}
              >
                <Pencil size={12} />
                <span>改字</span>
              </button>
              <button type="button" onClick={onEditSelected} className={chipBtn}>
                <SlidersHorizontal size={12} />
                <span>详情</span>
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            </>
          )}

          {selectedTarget.kind === 'carousel' && (
            <>
              <span className="px-1.5 text-[11px] font-semibold text-[var(--ink-muted)] max-w-[96px] truncate">
                轮播图
              </span>
              {divider}
              <button type="button" onClick={onEditSelected} className={chipBtn}>
                <Images size={12} className="text-sky-500" />
                <span>管理图片 ({selectedTarget.widget.images.length})</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onPatchCarouselWidget(selectedTarget.widget, {
                    transition: selectedTarget.widget.transition === 'fade' ? 'slide' : 'fade',
                  })
                }
                className={chipBtn}
              >
                <span>{selectedTarget.widget.transition === 'fade' ? '淡入' : '滑动'}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onPatchCarouselWidget(selectedTarget.widget, {
                    fit: selectedTarget.widget.fit === 'contain' ? 'cover' : 'contain',
                  })
                }
                className={chipBtn}
              >
                <span>{selectedTarget.widget.fit === 'contain' ? '完整' : '铺满'}</span>
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            </>
          )}

          {selectedTarget.kind === 'item' && (
            <>
              <span className="px-1.5 text-[11px] font-semibold text-[var(--ink-muted)] max-w-[96px] truncate">
                {selectedTarget.item.title}
              </span>
              {divider}
              {renderColorDots(selectedTarget.item.accent, (hex) =>
                onSetItemAccent(selectedTarget.item, hex)
              )}
              {folders.length > 0 && (
                <>
                  {divider}
                  <button
                    type="button"
                    onClick={() => setFolderPickerOpen((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer ${
                      folderPickerOpen
                        ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
                        : 'text-[var(--ink-main)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    <FolderInput size={12} />
                    <span>移入文件夹</span>
                  </button>
                </>
              )}
              <button type="button" onClick={onEditSelected} className={chipBtn}>
                <SlidersHorizontal size={12} />
                <span>编辑详情</span>
              </button>
              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Dual-Layout Target Switcher Pill */}
      <div className="pointer-events-auto pill-surface flex flex-wrap items-center justify-center gap-1 px-2 py-1 text-[11px] max-w-full">
        <button
          type="button"
          onClick={() => onChangeLayoutTarget('unlocked')}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors cursor-pointer ${
            layoutTarget === 'unlocked'
              ? 'bg-[var(--ink-main)] text-[var(--bg-card)]'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)]'
          }`}
          title="编辑解锁后自己看到的完整布局（含私密内容）"
        >
          <Unlock size={11} />
          <span>解锁后布局</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeLayoutTarget('locked')}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors cursor-pointer ${
            layoutTarget === 'locked'
              ? 'bg-amber-500 text-white'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)]'
          }`}
          title="编辑未解锁访客看到的公开独立布局"
        >
          <Lock size={11} />
          <span>解锁前布局</span>
        </button>

        {layoutTarget === 'locked' && (
          <>
            {divider}
            {confirmSync ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (syncTimerRef.current !== null) {
                      window.clearTimeout(syncTimerRef.current);
                      syncTimerRef.current = null;
                    }
                    setConfirmSync(false);
                    onSyncUnlockedToLocked();
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium bg-[var(--accent-red)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                  title="再次点击确认覆盖当前解锁前布局，可随时撤销"
                >
                  <Copy size={11} />
                  <span>确认覆盖解锁前排版？</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (syncTimerRef.current !== null) {
                      window.clearTimeout(syncTimerRef.current);
                      syncTimerRef.current = null;
                    }
                    setConfirmSync(false);
                  }}
                  className="h-6 w-6 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] cursor-pointer"
                  aria-label="取消继承排版"
                  title="取消"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmSync(true);
                  if (syncTimerRef.current !== null) {
                    window.clearTimeout(syncTimerRef.current);
                  }
                  syncTimerRef.current = window.setTimeout(() => {
                    syncTimerRef.current = null;
                    setConfirmSync(false);
                  }, 3500);
                }}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium bg-[var(--bg-subtle)] hover:bg-[var(--accent-orange)] hover:text-white border border-[var(--border-hair)] text-[var(--ink-main)] transition-colors cursor-pointer"
                title="将解锁后布局中公开元素的位置与尺寸复制到当前解锁前布局，可随时撤销"
              >
                <Copy size={11} />
                <span>继承解锁后排版</span>
              </button>
            )}
          </>
        )}

        <span className="hidden sm:inline text-[10.5px] text-[var(--ink-muted)] pl-1 pr-1">
          位置/尺寸、宫格列表、分区与锚点各自独立，书签内容同步
        </span>
      </div>

      {/* Main Flat Creation + History Dock */}
      <div className="pointer-events-auto pill-surface flex flex-wrap items-center justify-center gap-1 px-2.5 py-1.5 text-xs max-w-full">
        <button
          type="button"
          onClick={onCreateItem}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus size={13} />
          <span>书签</span>
        </button>

        <button
          type="button"
          onClick={onCreateFolder}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
        >
          <FolderPlus size={13} />
          <span>文件夹</span>
        </button>

        <button
          type="button"
          onClick={onCreateZone}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          title={
            canWrapInZone
              ? '包裹所选项目生成分区框'
              : '在屏幕中心新建 4×2 分区框'
          }
        >
          <LayoutGrid size={13} className="text-[var(--accent-orange)]" />
          <span>{canWrapInZone ? '设为分区' : '分区'}</span>
        </button>

        <button
          type="button"
          onClick={onCreateNote}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          title="在屏幕中心直接生成便签并打字"
        >
          <StickyNote size={13} className="text-amber-500" />
          <span>便签</span>
        </button>

        <button
          type="button"
          onClick={onCreateText}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          title="在屏幕中心直接生成自由文字并打字"
        >
          <Type size={13} className="text-violet-500" />
          <span>文字</span>
        </button>

        <button
          type="button"
          onClick={onCreateCarousel}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-main)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          title="新建轮播图小部件"
        >
          <Images size={13} className="text-sky-500" />
          <span>轮播图</span>
        </button>

        {divider}

        {showAnchorButton && (
          <button
            type="button"
            onClick={onSetViewportOrigin}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
            title="将当前屏幕正中心保存为默认视野锚点"
          >
            <Crosshair size={13} />
            <span className="hidden md:inline">设为锚点</span>
          </button>
        )}

        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] disabled:opacity-35 cursor-pointer disabled:cursor-default"
          title={`撤销 (${SHORTCUT_UNDO})`}
        >
          <Undo2 size={13} />
          <span className="hidden lg:inline">撤销</span>
        </button>

        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] disabled:opacity-35 cursor-pointer disabled:cursor-default"
          title={`重做 (${SHORTCUT_REDO})`}
        >
          <Redo2 size={13} />
          <span className="hidden lg:inline">重做</span>
        </button>
      </div>
    </div>
  );
}
