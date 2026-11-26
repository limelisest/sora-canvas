import { useEffect, useState, type FormEvent } from 'react';
import { Globe, Lock, Sparkles, Trash2, X } from 'lucide-react';
import type {
  BookmarkItem,
  FolderContainer,
  FolderDisplayMode,
  SiteSettings,
} from '../../shared/types';
import { fetchUrlMeta } from '../api';
import { ICON_PRESET_NAMES, IconGlyph } from './IconGlyph';

export type ItemEditorDraft =
  | { mode: 'create-item'; defaultParentId?: string | null }
  | { mode: 'edit-item'; item: BookmarkItem }
  | { mode: 'create-folder' }
  | { mode: 'edit-folder'; folder: FolderContainer };

export interface ItemEditorSavePayload {
  kind: 'item' | 'folder';
  title: string;
  url?: string;
  subtitle?: string;
  icon?: string;
  faviconUrl?: string;
  accent?: string;
  tags?: string[];
  parentId?: string | null;
  w: number;
  h: number;
  displayMode?: FolderDisplayMode;
  isPrivate?: boolean;
}

interface ItemEditorModalProps {
  draft: ItemEditorDraft | null;
  folders: FolderContainer[];
  settings: SiteSettings;
  onClose: () => void;
  onSave: (payload: ItemEditorSavePayload) => string | null | void;
  onRequestDeleteFolder?: (folder: FolderContainer) => void;
  onRequestDeleteItem?: (item: BookmarkItem) => void;
}

const ACCENT_PRESETS = [
  '',
  '#ff5500',
  '#ec4899',
  '#8b5cf6',
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#10b981',
  '#eab308',
  '#f43f5e',
];

export function ItemEditorModal({
  draft,
  folders,
  settings,
  onClose,
  onSave,
  onRequestDeleteFolder,
  onRequestDeleteItem,
}: ItemEditorModalProps) {
  const isFolder = draft?.mode === 'create-folder' || draft?.mode === 'edit-folder';
  const isEdit = draft?.mode === 'edit-item' || draft?.mode === 'edit-folder';

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [icon, setIcon] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [accent, setAccent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [w, setW] = useState(1);
  const [h, setH] = useState(1);
  const [displayMode, setDisplayMode] = useState<FolderDisplayMode>('grid');
  const [isPrivate, setIsPrivate] = useState(false);
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!draft) return;
    setError('');
    if (draft.mode === 'edit-item') {
      const it = draft.item;
      setTitle(it.title);
      setUrl(it.url);
      setSubtitle(it.subtitle || '');
      setIcon(it.icon || '');
      setFaviconUrl(it.faviconUrl || '');
      setAccent(it.accent || '');
      setTagsInput((it.tags || []).join(', '));
      setParentId(it.parentId);
      setW(it.w);
      setH(it.h);
    } else if (draft.mode === 'edit-folder') {
      const f = draft.folder;
      setTitle(f.title);
      setIcon(f.icon || '');
      setAccent(f.accent || '');
      setW(f.w);
      setH(f.h);
      setDisplayMode(f.displayMode);
      setIsPrivate(f.isPrivate);
    } else if (draft.mode === 'create-folder') {
      setTitle('');
      setIcon('');
      setAccent('');
      setW(settings.defaultFolderW);
      setH(settings.defaultFolderH);
      setDisplayMode(settings.defaultFolderMode);
      setIsPrivate(false);
    } else {
      setTitle('');
      setUrl('https://');
      setSubtitle('');
      setIcon('');
      setFaviconUrl('');
      setAccent('');
      setTagsInput('');
      setParentId(draft.defaultParentId ?? null);
      setW(settings.defaultItemW);
      setH(settings.defaultItemH);
    }
  }, [draft, settings]);

  if (!draft) return null;

  async function handleAutoFetchMeta() {
    if (!url.trim() || url.trim() === 'https://') return;
    setFetchingMeta(true);
    setError('');
    try {
      const res = await fetchUrlMeta(url.trim());
      if (!title.trim() && res.title) setTitle(res.title);
      if (res.faviconUrl) setFaviconUrl(res.faviconUrl);
      try {
        const host = new URL(res.url).hostname;
        if (!subtitle.trim()) setSubtitle(host);
      } catch {
        // ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动抓取失败');
    } finally {
      setFetchingMeta(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('请填写标题');
      return;
    }
    if (!isFolder && !url.trim()) {
      setError('请填写目标网址');
      return;
    }

    const tags = tagsInput
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const errMsg = onSave({
      kind: isFolder ? 'folder' : 'item',
      title: title.trim(),
      url: isFolder ? undefined : url.trim(),
      subtitle: subtitle.trim() || undefined,
      icon: icon.trim() || undefined,
      faviconUrl: faviconUrl.trim() || undefined,
      accent: accent || undefined,
      tags: tags.length > 0 ? tags : undefined,
      parentId: isFolder ? undefined : parentId,
      w: Math.max(1, Math.min(6, w)),
      h: Math.max(1, Math.min(6, h)),
      displayMode: isFolder ? displayMode : undefined,
      isPrivate: isFolder ? isPrivate : undefined,
    });
    if (typeof errMsg === 'string' && errMsg.length > 0) {
      setError(errMsg);
    }
  }

  const showGridSize = isFolder || parentId === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bento-modal w-full max-w-md p-6 relative max-h-[88vh] overflow-y-auto bento-scroll"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
        >
          <X size={16} />
        </button>

        <h2 className="text-base font-semibold mb-4">
          {draft.mode === 'edit-folder'
            ? '编辑文件夹容器'
            : draft.mode === 'edit-item'
              ? '编辑书签项目'
              : isFolder
                ? '新建文件夹容器'
                : '新建书签项目'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-sm">
          {!isFolder && (
            <div>
              <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                目标 URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="bento-input flex-1 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleAutoFetchMeta}
                  disabled={fetchingMeta}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium bg-[var(--bg-subtle)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer shrink-0"
                >
                  <Sparkles size={13} />
                  <span>{fetchingMeta ? '抓取中' : '抓图标'}</span>
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
              标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isFolder ? '例如：AI 工作台' : '例如：neko 控制台'}
              className="bento-input w-full px-3 py-2 text-sm"
            />
          </div>

          {!isFolder && (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  归属位置
                </label>
                <select
                  value={parentId ?? ''}
                  onChange={(e) => setParentId(e.target.value || null)}
                  className="bento-input w-full px-3 py-2 text-sm"
                >
                  <option value="">桌面画布顶层</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      文件夹：{f.title} {f.isPrivate ? '(私密)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  副标题 / 域名备注
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="可选，例如：docs.example.com"
                  className="bento-input w-full px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                    图标名称或 Emoji
                  </label>
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="Terminal / 🚀"
                    className="bento-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                    Favicon URL
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={faviconUrl}
                      onChange={(e) => setFaviconUrl(e.target.value)}
                      placeholder="https://.../favicon.ico"
                      className="bento-input w-full px-3 py-2 text-sm"
                    />
                    <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center shrink-0">
                      {faviconUrl || icon ? (
                        <IconGlyph
                          icon={icon}
                          faviconUrl={faviconUrl}
                          title={title || 'N'}
                          accent={accent}
                          size={16}
                        />
                      ) : (
                        <Globe size={15} className="text-[var(--ink-muted)]" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  快速选择内置图标
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto bento-scroll p-1.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)]">
                  {ICON_PRESET_NAMES.slice(0, 18).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setIcon(name);
                        setFaviconUrl('');
                      }}
                      className={`h-7 w-7 rounded-lg flex items-center justify-center cursor-pointer ${
                        icon === name
                          ? 'bg-[var(--accent-orange)] text-white'
                          : 'hover:bg-[var(--bg-card)] text-[var(--ink-secondary)]'
                      }`}
                      title={name}
                    >
                      <IconGlyph icon={name} title={name} size={14} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  标签（逗号分隔，用于 2×2 大卡显示与检索）
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="控制台, 常用"
                  className="bento-input w-full px-3 py-2 text-sm"
                />
              </div>
            </>
          )}

          {isFolder && (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  文件夹图标
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto bento-scroll p-1.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)]">
                  {ICON_PRESET_NAMES.slice(0, 24).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setIcon(icon === name ? '' : name)}
                      className={`h-7 w-7 rounded-lg flex items-center justify-center cursor-pointer ${
                        icon === name
                          ? 'bg-[var(--accent-orange)] text-white'
                          : 'hover:bg-[var(--bg-card)] text-[var(--ink-secondary)]'
                      }`}
                      title={name}
                    >
                      <IconGlyph icon={name} title={name} size={14} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1.5">
                  文件夹展现形态
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'grid', label: '宫格' },
                      { id: 'list', label: '列表' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDisplayMode(opt.id)}
                      className={`py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                        displayMode === opt.id
                          ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                          : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)] border-[var(--border-hair)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Lock size={15} className="text-amber-500" />
                  <div>
                    <div className="text-xs font-medium">私密文件夹 (isPrivate)</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      未解锁时服务端完全过滤容器及其内部项目
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent-orange)]"
                />
              </label>
            </>
          )}

          {showGridSize && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  宽度格数 (1-6)
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={w}
                  onChange={(e) => setW(Number(e.target.value))}
                  className="bento-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1">
                  高度格数 (1-6)
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={h}
                  onChange={(e) => setH(Number(e.target.value))}
                  className="bento-input w-full px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--ink-secondary)] mb-1.5">
              点缀色
            </label>
            <div className="flex items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c || 'default'}
                  type="button"
                  onClick={() => setAccent(c)}
                  className={`h-6 w-6 rounded-full border cursor-pointer transition-transform ${
                    accent === c ? 'scale-115 ring-2 ring-[var(--ink-main)] ring-offset-1' : ''
                  }`}
                  style={{
                    backgroundColor: c || 'var(--bg-subtle)',
                    borderColor: 'var(--border-strong)',
                  }}
                  title={c || '默认'}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-[var(--accent-red)] font-medium">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-2">
            {draft.mode === 'edit-folder' && onRequestDeleteFolder ? (
              <button
                type="button"
                onClick={() => onRequestDeleteFolder(draft.folder)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>解散 / 删除</span>
              </button>
            ) : draft.mode === 'edit-item' && onRequestDeleteItem ? (
              <button
                type="button"
                onClick={() => onRequestDeleteItem(draft.item)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>删除书签</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-full px-5 py-2 text-xs font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 cursor-pointer"
              >
                {isEdit ? '保存修改' : '确认创建'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
