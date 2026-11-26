import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Grid2x2,
  History,
  KeyRound,
  Lock,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  CanvasDocument,
  FolderDisplayMode,
  HistorySnapshotSummary,
  RememberDays,
  SiteSettings,
} from '../../shared/types';
import {
  changePasswordApi,
  createManualHistoryApi,
  deleteHistoryApi,
  exportBackupApi,
  fetchHistoryList,
  getAgentCredentialsApi,
  importBackupApi,
  restoreHistoryApi,
  revokeAllDevicesApi,
  rotateAgentTokenApi,
  saveCanvasApi,
} from '../api';
import { importNetscapeBookmarksHtml } from '../utils/bookmarksHtml';

function formatSnapshotReason(reason: string): string {
  if (reason === 'canvas_put') return '编辑前自动存档';
  if (reason === 'agent_ops' || reason.startsWith('agent_ops:')) return 'Agent 批量调整';
  if (reason === 'backup_import') return '导入前备份';
  if (reason === 'settings_grid_density') return '网格密度切换前';
  if (reason === 'manual') return '手动快照';
  if (reason.startsWith('manual:')) {
    return `手动快照 · ${reason.slice('manual:'.length)}`;
  }
  if (reason.startsWith('restore:')) {
    return `回滚前备份 · ${reason.slice('restore:'.length)}`;
  }
  return reason;
}

interface SettingsViewProps {
  settings: SiteSettings;
  doc: CanvasDocument;
  dark: boolean;
  onToggleDark: () => void;
  onBack: () => void;
  onLock: () => void;
  onUpdateSettings: (patch: Partial<SiteSettings>) => Promise<void>;
  onCanvasReplaced: (nextDoc: CanvasDocument, nextSettings?: SiteSettings) => void;
  onToast: (msg: string, tone?: 'error' | 'info') => void;
}

const BRAND_ACCENT_PRESETS = ['#ff5500', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

export function SettingsView({
  settings,
  doc,
  dark,
  onToggleDark,
  onBack,
  onLock,
  onUpdateSettings,
  onCanvasReplaced,
  onToast,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<SiteSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // Agent credentials state
  const [apiToken, setApiToken] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotatingToken, setRotatingToken] = useState(false);

  // Security / password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [revokingDevices, setRevokingDevices] = useState(false);

  // History & backup state
  const [historyItems, setHistoryItems] = useState<HistorySnapshotSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [importing, setImporting] = useState(false);

  const jsonInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const loadCredentialsAndHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const [credRes, histRes] = await Promise.all([
        getAgentCredentialsApi(),
        fetchHistoryList(),
      ]);
      setApiToken(credRes.apiToken);
      setHistoryItems(histRes.items);
    } catch (err) {
      onToast(err instanceof Error ? err.message : '加载设置详情失败', 'error');
    } finally {
      setLoadingHistory(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadCredentialsAndHistory();
  }, [loadCredentialsAndHistory]);

  async function commitPatch(patch: Partial<SiteSettings>) {
    const merged = { ...draft, ...patch };
    setDraft(merged);
    setSaving(true);
    setSavedNotice(false);
    try {
      await onUpdateSettings(patch);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    } catch (err) {
      onToast(err instanceof Error ? err.message : '保存设置失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(`已复制${label}`);
    } catch {
      onToast('剪贴板写入失败，请手动复制', 'error');
    }
  }

  async function handleRotateToken() {
    if (!confirmRotate) {
      setConfirmRotate(true);
      return;
    }
    setRotatingToken(true);
    try {
      const res = await rotateAgentTokenApi();
      setApiToken(res.apiToken);
      setConfirmRotate(false);
      onToast('Agent Bearer Token 已轮换，旧 Token 已立即失效');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '轮换 Token 失败', 'error');
    } finally {
      setRotatingToken(false);
    }
  }

  async function handleCopyAgentPrompt() {
    const origin = window.location.origin;
    const promptText = [
      `请管理我的书签启动器「${draft.siteTitle}」。`,
      `1. 先阅读公开接口规范：${origin}/llms.txt（或 GET ${origin}/api/agent/guide?format=json）`,
      `2. 鉴权请求头：Authorization: Bearer ${apiToken}`,
      `3. 读取当前完整画布（含私密文件夹与项目）：GET ${origin}/api/canvas`,
      `4. 原子化新增、分类或整理布局：POST ${origin}/api/agent/ops`,
    ].join('\n');
    await copyText(promptText, ' Agent 引导词');
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwError('');
    if (!currentPassword) {
      setPwError('请输入当前密码');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('新密码长度不能少于 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('两次输入的新密码不一致');
      return;
    }
    setPwLoading(true);
    try {
      await changePasswordApi(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onToast('管理密码已更新');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setPwLoading(false);
    }
  }

  async function handleRevokeOtherDevices() {
    setRevokingDevices(true);
    try {
      await revokeAllDevicesApi(true);
      onToast('已锁定其他所有已记住的设备（当前设备保持解锁）');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '撤销设备失败', 'error');
    } finally {
      setRevokingDevices(false);
    }
  }

  async function handleExportJson() {
    try {
      const backup = await exportBackupApi();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `neko-like-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast('已导出全量 JSON 备份');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '导出备份失败', 'error');
    }
  }

  async function handleImportJsonFile(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { canvas?: unknown; settings?: Partial<SiteSettings> };
      const res = await importBackupApi({
        canvas: parsed.canvas ?? parsed,
        settings: parsed.settings,
      });
      onCanvasReplaced(res.canvas, res.settings);
      setDraft(res.settings);
      await loadCredentialsAndHistory();
      onToast('JSON 备份已恢复并留存快照');
    } catch (err) {
      onToast(err instanceof Error ? err.message : '导入 JSON 备份失败', 'error');
    } finally {
      setImporting(false);
    }
  }

  async function handleImportHtmlFile(file: File) {
    setImporting(true);
    try {
      const html = await file.text();
      const result = importNetscapeBookmarksHtml(html, doc, draft);
      const saved = await saveCanvasApi(result.doc);
      onCanvasReplaced(saved);
      await loadCredentialsAndHistory();
      onToast(
        `已从书签 HTML 导入 ${result.importedFolders} 个文件夹与 ${result.importedItems} 个书签`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : '解析书签 HTML 失败', 'error');
    } finally {
      setImporting(false);
    }
  }

  const maskedToken = apiToken
    ? `${apiToken.slice(0, 6)}••••••••••••••••••••••••${apiToken.slice(-6)}`
    : '加载中...';

  return (
    <div className="h-full w-full overflow-y-auto bento-scroll bg-[var(--bg-canvas)] text-[var(--ink-main)] pb-16">
      {/* Sticky Floating Top Pill Header */}
      <header className="sticky top-0 z-30 px-4 pt-4 pb-3">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="pill-surface flex items-center gap-2 px-3 py-1.5 text-sm">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
            >
              <ArrowLeft size={13} />
              <span>返回画布</span>
            </button>
            <span className="h-4 w-px bg-[var(--border-hair)]" />
            <span className="flex items-center gap-2 font-semibold text-sm pr-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--accent-orange)' }}
              />
              <span>站点设置</span>
            </span>
            {saving && <span className="text-[11px] text-[var(--ink-muted)] pr-1">保存中...</span>}
            {!saving && savedNotice && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-emerald)] pr-1 font-medium">
                <Check size={12} /> 已保存
              </span>
            )}
          </div>

          <div className="pill-surface flex items-center gap-1.5 px-2.5 py-1.5 text-sm">
            <button
              type="button"
              onClick={onLock}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors cursor-pointer"
              title="手动上锁：立即隐藏私密文件夹并退出设置页"
            >
              <Unlock size={13} />
              <span>上锁</span>
            </button>
            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] cursor-pointer"
              aria-label="切换深浅色主题"
            >
              {dark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </div>
      </header>

      {/* 2-Column Bento Grid */}
      <main className="max-w-5xl mx-auto px-4 pt-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: 站点标识与外观 */}
        <section className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--accent-orange)]">
              <Palette size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">站点标识与外观</h2>
              <p className="text-xs text-[var(--ink-muted)]">品牌名称、点缀色、返回链接与主题外观</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                站点标题
              </label>
              <input
                type="text"
                value={draft.siteTitle}
                onChange={(e) => setDraft({ ...draft, siteTitle: e.target.value })}
                onBlur={() => {
                  if (draft.siteTitle.trim() && draft.siteTitle !== settings.siteTitle) {
                    void commitPatch({ siteTitle: draft.siteTitle.trim() });
                  }
                }}
                className="bento-input w-full px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">
                品牌点缀色
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {BRAND_ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => void commitPatch({ brandAccent: color })}
                    className={`h-7 w-7 rounded-full border cursor-pointer transition-transform ${
                      draft.brandAccent.toLowerCase() === color
                        ? 'scale-110 ring-2 ring-[var(--ink-main)] ring-offset-2'
                        : ''
                    }`}
                    style={{ backgroundColor: color, borderColor: 'var(--border-strong)' }}
                  />
                ))}
                <input
                  type="color"
                  value={draft.brandAccent}
                  onChange={(e) => void commitPatch({ brandAccent: e.target.value })}
                  className="h-7 w-9 rounded-lg border border-[var(--border-hair)] bg-transparent cursor-pointer"
                  title="自定义颜色"
                />
                <span className="font-mono text-[11px] text-[var(--ink-muted)]">
                  {draft.brandAccent}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                  首次默认主题
                </label>
                <select
                  value={draft.defaultTheme}
                  onChange={(e) =>
                    void commitPatch({
                      defaultTheme: e.target.value as SiteSettings['defaultTheme'],
                    })
                  }
                  className="bento-input w-full px-2.5 py-2 text-xs"
                >
                  <option value="light">暖石浅色</option>
                  <option value="dark">深邃暗黑</option>
                  <option value="system">跟随系统</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                  画布点阵背景
                </label>
                <select
                  value={draft.dotGridMode}
                  onChange={(e) =>
                    void commitPatch({
                      dotGridMode: e.target.value as SiteSettings['dotGridMode'],
                    })
                  }
                  className="bento-input w-full px-2.5 py-2 text-xs"
                >
                  <option value="always">始终显示</option>
                  <option value="edit-only">仅编辑模式</option>
                  <option value="hidden">隐藏点阵</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                  链接打开方式
                </label>
                <select
                  value={draft.openTarget}
                  onChange={(e) =>
                    void commitPatch({
                      openTarget: e.target.value as SiteSettings['openTarget'],
                    })
                  }
                  className="bento-input w-full px-2.5 py-2 text-xs"
                >
                  <option value="_blank">新标签页</option>
                  <option value="_self">当前标签页</option>
                </select>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-2.5">
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">
                  画布背景氛围风格
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'aurora', label: '柔和氛围光' },
                      { id: 'dot', label: '极简纯色' },
                      { id: 'wallpaper', label: '自定义壁纸' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => void commitPatch({ canvasBgStyle: opt.id })}
                      className={`py-2 px-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                        draft.canvasBgStyle === opt.id
                          ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                          : 'bg-[var(--bg-card)] text-[var(--ink-secondary)] border-[var(--border-hair)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {draft.canvasBgStyle === 'wallpaper' && (
                <div>
                  <label className="block text-[11px] text-[var(--ink-muted)] mb-1">
                    壁纸图片地址 (https://...，卡片将自动启用磨砂玻璃效果)
                  </label>
                  <input
                    type="url"
                    value={draft.customBgUrl}
                    onChange={(e) => setDraft({ ...draft, customBgUrl: e.target.value })}
                    onBlur={() => {
                      if (draft.customBgUrl !== settings.customBgUrl) {
                        void commitPatch({ customBgUrl: draft.customBgUrl.trim() });
                      }
                    }}
                    placeholder="https://example.com/wallpaper.jpg"
                    className="bento-input w-full px-2.5 py-1.5 text-xs bg-[var(--bg-card)]"
                  />
                </div>
              )}

              <label className="flex items-center justify-between pt-1 cursor-pointer">
                <div>
                  <div className="font-medium">显示左下角分区快捷目录</div>
                  <div className="text-[11px] text-[var(--ink-muted)]">
                    点击任意分区平滑飞跃定位，适合文件夹较多的画布
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.showFolderNav}
                  onChange={(e) => void commitPatch({ showFolderNav: e.target.checked })}
                  className="h-4 w-4 accent-[var(--accent-orange)] shrink-0"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Card 2: 默认比例与展现规格 */}
        <section className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--accent-orange)]">
              <Grid2x2 size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">默认比例与展现规格</h2>
              <p className="text-xs text-[var(--ink-muted)]">控制新建实体、文件夹形态及拖出桌面尺寸</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-2">
                <div className="font-medium">新建书签项目默认尺寸</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)]">宽 (W)</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draft.defaultItemW}
                      onChange={(e) =>
                        void commitPatch({ defaultItemW: Number(e.target.value) || 1 })
                      }
                      className="bento-input w-full px-2.5 py-1.5 text-xs bg-[var(--bg-card)] mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)]">高 (H)</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draft.defaultItemH}
                      onChange={(e) =>
                        void commitPatch({ defaultItemH: Number(e.target.value) || 1 })
                      }
                      className="bento-input w-full px-2.5 py-1.5 text-xs bg-[var(--bg-card)] mt-0.5"
                    />
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-2">
                <div className="font-medium">新建文件夹默认尺寸</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)]">宽 (W)</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draft.defaultFolderW}
                      onChange={(e) =>
                        void commitPatch({ defaultFolderW: Number(e.target.value) || 2 })
                      }
                      className="bento-input w-full px-2.5 py-1.5 text-xs bg-[var(--bg-card)] mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--ink-muted)]">高 (H)</span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draft.defaultFolderH}
                      onChange={(e) =>
                        void commitPatch({ defaultFolderH: Number(e.target.value) || 2 })
                      }
                      className="bento-input w-full px-2.5 py-1.5 text-xs bg-[var(--bg-card)] mt-0.5"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">
                新建文件夹默认展现形态
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
                    onClick={() =>
                      void commitPatch({ defaultFolderMode: opt.id as FolderDisplayMode })
                    }
                    className={`py-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                      draft.defaultFolderMode === opt.id
                        ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                        : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)] border-[var(--border-hair)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">
                从文件夹拖回桌面时的尺寸策略
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: '1x1', label: '统一恢复为 1×1（推荐）' },
                    { id: 'preserve', label: '保留项目原有 W×H' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void commitPatch({ dragOutItemSizeMode: opt.id })}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                      draft.dragOutItemSizeMode === opt.id
                        ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                        : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)] border-[var(--border-hair)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Card 3: 画布网格与手势微调 */}
        <section className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--accent-orange)]">
              <Sliders size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">画布网格与手势微调</h2>
              <p className="text-xs text-[var(--ink-muted)]">网格密度、触屏防误触长按与悬停合并</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">
                网格尺寸密度（同步保存画布网格）
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'compact', label: '紧凑 (92/12)' },
                    { id: 'standard', label: '标准 (108/14)' },
                    { id: 'relaxed', label: '宽松 (124/16)' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void commitPatch({ gridDensity: opt.id })}
                    className={`py-2 px-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                      draft.gridDensity === opt.id
                        ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                        : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)] border-[var(--border-hair)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">
                鼠标滚轮行为（按住鼠标中键或空格键可随时拖动画面）
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'zoom', label: '滚轮缩放画布' },
                    { id: 'pan', label: '滚轮平移画布 (Ctrl+滚轮缩放)' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void commitPatch({ wheelMode: opt.id })}
                    className={`py-2 px-2 rounded-xl text-xs font-medium border cursor-pointer transition-colors ${
                      draft.wheelMode === opt.id
                        ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                        : 'bg-[var(--bg-subtle)] text-[var(--ink-secondary)] border-[var(--border-hair)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-[var(--ink-secondary)]">
                  触屏长按抬起阈值 (200–800ms)
                </span>
                <span className="font-mono font-semibold">{draft.touchLongPressMs} ms</span>
              </div>
              <input
                type="range"
                min={200}
                max={800}
                step={20}
                value={draft.touchLongPressMs}
                onChange={(e) =>
                  setDraft({ ...draft, touchLongPressMs: Number(e.target.value) })
                }
                onMouseUp={() => void commitPatch({ touchLongPressMs: draft.touchLongPressMs })}
                onTouchEnd={() => void commitPatch({ touchLongPressMs: draft.touchLongPressMs })}
                className="w-full accent-[var(--accent-orange)]"
              />
            </div>

            <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-medium">开启项目悬停合并新建文件夹</span>
                <input
                  type="checkbox"
                  checked={draft.hoverMergeEnabled}
                  onChange={(e) => void commitPatch({ hoverMergeEnabled: e.target.checked })}
                  className="h-4 w-4 accent-[var(--accent-orange)]"
                />
              </label>

              {draft.hoverMergeEnabled && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--ink-muted)]">悬停触发时长 (350–1200ms)</span>
                      <span className="font-mono font-semibold">{draft.hoverMergeMs} ms</span>
                    </div>
                    <input
                      type="range"
                      min={350}
                      max={1200}
                      step={50}
                      value={draft.hoverMergeMs}
                      onChange={(e) =>
                        setDraft({ ...draft, hoverMergeMs: Number(e.target.value) })
                      }
                      onMouseUp={() => void commitPatch({ hoverMergeMs: draft.hoverMergeMs })}
                      onTouchEnd={() => void commitPatch({ hoverMergeMs: draft.hoverMergeMs })}
                      className="w-full accent-[var(--accent-orange)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[var(--ink-muted)] mb-1">
                      合并生成新文件夹默认标题
                    </label>
                    <input
                      type="text"
                      value={draft.mergedFolderTitle}
                      onChange={(e) => setDraft({ ...draft, mergedFolderTitle: e.target.value })}
                      onBlur={() => {
                        if (
                          draft.mergedFolderTitle.trim() &&
                          draft.mergedFolderTitle !== settings.mergedFolderTitle
                        ) {
                          void commitPatch({ mergedFolderTitle: draft.mergedFolderTitle.trim() });
                        }
                      }}
                      className="bento-input w-full px-2.5 py-1.5 text-xs bg-[var(--bg-card)]"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-1.5">
                    <Crosshair size={13} className="text-[var(--accent-orange)]" />
                    <span>视野锚点与自动缩放（电脑 / 手机独立）</span>
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)] mt-0.5 leading-relaxed">
                    启用锚点时默认以 100% 居中于锚点位置；关闭时按当前可见布局自动适配缩放。
                  </div>
                </div>
                {settings.viewportOrigin && (
                  <button
                    type="button"
                    onClick={() => void commitPatch({ viewportOrigin: null })}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium bg-[var(--bg-card)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer"
                  >
                    重置锚点坐标
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)] cursor-pointer">
                  <div>
                    <div className="font-medium">电脑端启用锚点</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {draft.desktopViewportMode === 'anchor'
                        ? '已启用：默认 100% 居中锚点'
                        : '已关闭：按布局自动适配缩放'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.desktopViewportMode === 'anchor'}
                    onChange={(e) =>
                      void commitPatch({
                        desktopViewportMode: e.target.checked ? 'anchor' : 'auto',
                      })
                    }
                    className="h-4 w-4 accent-[var(--accent-orange)] shrink-0"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)] cursor-pointer">
                  <div>
                    <div className="font-medium">手机端启用锚点</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {draft.mobileViewportMode === 'anchor'
                        ? '已启用：默认 100% 居中锚点'
                        : '已关闭：按布局自动适配缩放'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.mobileViewportMode === 'anchor'}
                    onChange={(e) =>
                      void commitPatch({
                        mobileViewportMode: e.target.checked ? 'anchor' : 'auto',
                      })
                    }
                    className="h-4 w-4 accent-[var(--accent-orange)] shrink-0"
                  />
                </label>
              </div>

              <div className="text-[11px] text-[var(--ink-muted)]">
                当前锚点坐标：
                {settings.viewportOrigin
                  ? ` (${settings.viewportOrigin.x}, ${settings.viewportOrigin.y}) · 可在编辑模式下拖拽十字标记微调`
                  : ' 未手动锁定（默认取布局中心）'}
              </div>
            </div>

            <label className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] cursor-pointer">
              <div>
                <div className="font-medium">允许抓取内网 / 局域网网址标题与图标</div>
                <div className="text-[11px] text-[var(--ink-muted)]">
                  开启后 /api/meta/fetch 可访问 192.168.* / localhost 等内网服务
                </div>
              </div>
              <input
                type="checkbox"
                checked={draft.allowPrivateMeta}
                onChange={(e) => void commitPatch({ allowPrivateMeta: e.target.checked })}
                className="h-4 w-4 accent-[var(--accent-orange)] shrink-0"
              />
            </label>
          </div>
        </section>

        {/* Card 4: Agent 接入中心 */}
        <section className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--accent-orange)]">
              <Bot size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Agent 接入中心</h2>
              <p className="text-xs text-[var(--ink-muted)]">
                标准 `/llms.txt` 自发现文档、Bearer Token 与一键引导词
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)]">
              <div className="min-w-0">
                <div className="font-medium">Agent 标准文档 (/llms.txt)</div>
                <div className="text-[11px] text-[var(--ink-muted)] font-mono truncate">
                  {window.location.origin}/llms.txt
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => void copyText(`${window.location.origin}/llms.txt`, ' /llms.txt 地址')}
                  className="h-8 px-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] inline-flex items-center gap-1 cursor-pointer"
                >
                  <Copy size={12} />
                  <span>复制</span>
                </button>
                <a
                  href="/llms.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 w-8 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] inline-flex items-center justify-center"
                  title="新窗口打开 /llms.txt"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">API Bearer Token</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTokenVisible((v) => !v)}
                    className="h-7 px-2 rounded-lg hover:bg-[var(--bg-card)] inline-flex items-center gap-1 text-[var(--ink-secondary)] cursor-pointer"
                  >
                    {tokenVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                    <span>{tokenVisible ? '隐藏' : '明文'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyText(apiToken, ' Bearer Token')}
                    disabled={!apiToken}
                    className="h-7 px-2 rounded-lg hover:bg-[var(--bg-card)] inline-flex items-center gap-1 text-[var(--ink-secondary)] cursor-pointer disabled:opacity-40"
                  >
                    <Copy size={12} />
                    <span>复制</span>
                  </button>
                </div>
              </div>

              <div className="font-mono text-[11px] px-2.5 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)] break-all select-all">
                {tokenVisible ? apiToken || '加载中...' : maskedToken}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleRotateToken()}
                  disabled={rotatingToken}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors cursor-pointer ${
                    confirmRotate
                      ? 'bg-[var(--accent-red)] text-white'
                      : 'bg-[var(--bg-card)] border border-[var(--border-hair)] text-[var(--ink-secondary)] hover:text-[var(--ink-main)]'
                  }`}
                >
                  <RefreshCw size={12} />
                  <span>
                    {rotatingToken
                      ? '轮换中...'
                      : confirmRotate
                        ? '再次点击确认轮换（旧 Token 将失效）'
                        : '轮换新 Token'}
                  </span>
                </button>
                {confirmRotate && (
                  <button
                    type="button"
                    onClick={() => setConfirmRotate(false)}
                    className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-main)] cursor-pointer"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyAgentPrompt()}
              disabled={!apiToken}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-medium bg-[var(--accent-orange)] text-white hover:opacity-92 disabled:opacity-50 cursor-pointer"
            >
              <Sparkles size={15} />
              <span>一键复制 Agent 引导词</span>
            </button>
          </div>
        </section>

        {/* Card 5: 安全、设备记忆与密码 */}
        <section className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--accent-orange)]">
              <ShieldCheck size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">安全、设备记忆与密码</h2>
              <p className="text-xs text-[var(--ink-muted)]">会话持久天数、设备锁定与管理密码修改</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                  记住设备有效期
                </label>
                <select
                  value={draft.rememberDays}
                  onChange={(e) =>
                    void commitPatch({ rememberDays: Number(e.target.value) as RememberDays })
                  }
                  className="bento-input w-full px-3 py-2 text-xs"
                >
                  <option value={7}>7 天</option>
                  <option value={30}>30 天</option>
                  <option value={90}>90 天</option>
                  <option value={365}>365 天（推荐）</option>
                </select>
              </div>
              <label className="flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] cursor-pointer mt-5">
                <span className="font-medium">访问时自动续期</span>
                <input
                  type="checkbox"
                  checked={draft.slidingRenewal}
                  onChange={(e) => void commitPatch({ slidingRenewal: e.target.checked })}
                  className="h-4 w-4 accent-[var(--accent-orange)]"
                />
              </label>
            </div>

            <form
              onSubmit={handleChangePassword}
              className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] space-y-2"
            >
              <div className="flex items-center gap-1.5 font-medium mb-1">
                <KeyRound size={13} />
                <span>修改管理密码</span>
              </div>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="当前管理密码"
                className="bento-input w-full px-3 py-1.5 text-xs bg-[var(--bg-card)]"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新密码（至少 6 位）"
                  className="bento-input px-3 py-1.5 text-xs bg-[var(--bg-card)]"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="确认新密码"
                  className="bento-input px-3 py-1.5 text-xs bg-[var(--bg-card)]"
                />
              </div>
              {pwError && <p className="text-[11px] text-[var(--accent-red)] font-medium">{pwError}</p>}
              <div className="flex justify-end pt-0.5">
                <button
                  type="submit"
                  disabled={pwLoading}
                  className="rounded-full px-4 py-1.5 font-medium bg-[var(--ink-main)] text-[var(--bg-card)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {pwLoading ? '保存中...' : '更新密码'}
                </button>
              </div>
            </form>

            <button
              type="button"
              onClick={() => void handleRevokeOtherDevices()}
              disabled={revokingDevices}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 font-medium bg-red-500/10 text-[var(--accent-red)] hover:bg-red-500/18 border border-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Lock size={13} />
              <span>
                {revokingDevices ? '正在吊销...' : '锁定其他所有已记住设备'}
              </span>
            </button>
          </div>
        </section>

        {/* Card 6: 备份、导入导出与历史快照 */}
        <section className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] flex items-center justify-center text-[var(--accent-orange)]">
              <History size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">备份、导入导出与历史快照</h2>
              <p className="text-xs text-[var(--ink-muted)]">
                JSON 全量备份、浏览器 bookmarks.html 导入与 30 份自动快照回滚
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <button
              type="button"
              onClick={() => void handleExportJson()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-medium bg-[var(--bg-subtle)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer"
            >
              <Download size={13} />
              <span>导出 JSON</span>
            </button>

            <button
              type="button"
              disabled={importing}
              onClick={() => jsonInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-medium bg-[var(--bg-subtle)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer disabled:opacity-50"
            >
              <Upload size={13} />
              <span>导入 JSON</span>
            </button>

            <button
              type="button"
              disabled={importing}
              onClick={() => htmlInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-medium bg-[var(--bg-subtle)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer disabled:opacity-50"
            >
              <FileCode2 size={13} />
              <span>书签 HTML</span>
            </button>

            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleImportJsonFile(f);
              }}
            />
            <input
              ref={htmlInputRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleImportHtmlFile(f);
              }}
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <input
              type="text"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              placeholder="可选：快照备注（如 调整首页前）"
              className="bento-input flex-1 min-w-0 px-3 py-1.5 text-xs bg-[var(--bg-subtle)]"
            />
            <button
              type="button"
              disabled={creatingSnapshot}
              onClick={async () => {
                setCreatingSnapshot(true);
                try {
                  await createManualHistoryApi(manualNote);
                  setManualNote('');
                  await loadCredentialsAndHistory();
                  onToast('已手动创建快照');
                } catch (err) {
                  onToast(err instanceof Error ? err.message : '创建快照失败', 'error');
                } finally {
                  setCreatingSnapshot(false);
                }
              }}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Plus size={13} />
              <span>{creatingSnapshot ? '保存中' : '手动存档'}</span>
            </button>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto bento-scroll pr-1 text-xs">
            {loadingHistory && (
              <div className="py-6 text-center text-[var(--ink-muted)]">加载历史快照中...</div>
            )}
            {!loadingHistory && historyItems.length === 0 && (
              <div className="py-6 text-center text-[var(--ink-muted)]">
                暂无历史快照（编辑前会自动保留快照，连续 5 分钟内的拖拽只保留起始基线）
              </div>
            )}
            {!loadingHistory &&
              historyItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hair)]"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{formatSnapshotReason(item.reason)}</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {new Date(item.createdAt).toLocaleString()} · {item.nodeCount} 项
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={restoringId !== null || deletingId !== null}
                      onClick={async () => {
                        setRestoringId(item.id);
                        try {
                          const res = await restoreHistoryApi(item.id);
                          onCanvasReplaced(res.canvas);
                          await loadCredentialsAndHistory();
                          onToast('已回滚至所选历史快照');
                        } catch (err) {
                          onToast(err instanceof Error ? err.message : '回滚失败', 'error');
                        } finally {
                          setRestoringId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium bg-[var(--bg-card)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer"
                    >
                      <RotateCcw size={11} />
                      <span>{restoringId === item.id ? '恢复中' : '回滚'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={restoringId !== null || deletingId !== null}
                      onClick={async () => {
                        setDeletingId(item.id);
                        try {
                          await deleteHistoryApi(item.id);
                          await loadCredentialsAndHistory();
                          onToast('已删除该快照');
                        } catch (err) {
                          onToast(err instanceof Error ? err.message : '删除失败', 'error');
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      className="h-7 w-7 rounded-full inline-flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer disabled:opacity-40"
                      title="删除此条快照"
                      aria-label="删除快照"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </main>
    </div>
  );
}
