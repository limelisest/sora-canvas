import {
  Check,
  LayoutList,
  Lock,
  Moon,
  Pencil,
  Search,
  Settings,
  Sun,
  Unlock,
} from 'lucide-react';
import type { SiteSettings } from '../../shared/types';
import { SHORTCUT_SEARCH } from '../utils/platform';

interface TopPillBarProps {
  settings: SiteSettings;
  onOpenSearch: () => void;
  unlocked: boolean;
  hasPrivateHidden: boolean;
  onLockToggle: () => void;
  editMode: boolean;
  onToggleEditMode: () => void;
  onOpenSettings: () => void;
  dark: boolean;
  onToggleDark: () => void;
  showSwitchToPaged?: boolean;
  onSwitchToPaged?: () => void;
}

export function TopPillBar({
  settings,
  onOpenSearch,
  unlocked,
  hasPrivateHidden,
  onLockToggle,
  editMode,
  onToggleEditMode,
  onOpenSettings,
  dark,
  onToggleDark,
  showSwitchToPaged = false,
  onSwitchToPaged,
}: TopPillBarProps) {
  return (
    <header className="pointer-events-none fixed top-4 left-4 right-4 z-30 flex flex-wrap items-center justify-between gap-2">
      {/* Left Pill: Brand Title */}
      <div className="pointer-events-auto pill-surface flex items-center gap-1.5 px-3.5 py-1.5 text-sm">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: 'var(--accent-orange)' }}
          />
          <span>{settings.siteTitle}</span>
        </span>
      </div>

      {/* Right Pill: Search + Lock/Unlock + Edit + Unlocked-Only Settings + Theme */}
      <div className="pointer-events-auto pill-surface flex items-center gap-1.5 px-2.5 py-1.5 text-sm">
        <button
          type="button"
          onClick={onOpenSearch}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
          title={`全局搜索 (/ 或 ${SHORTCUT_SEARCH})`}
        >
          <Search size={13} />
          <span className="hidden sm:inline">搜索</span>
          <kbd className="hidden md:inline-block rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--ink-muted)] border border-[var(--border-hair)]">
            {SHORTCUT_SEARCH}
          </kbd>
        </button>

        <button
          type="button"
          onClick={onLockToggle}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
            unlocked
              ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)]'
          }`}
          title={
            unlocked
              ? '手动上锁：立即隐藏私密文件夹并清除本机免密状态'
              : '解锁私密文件夹'
          }
        >
          {unlocked ? <Unlock size={13} /> : <Lock size={13} />}
          <span>{unlocked ? '上锁' : hasPrivateHidden ? '解锁私密' : '解锁'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleEditMode}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
            editMode
              ? 'bg-[var(--accent-orange)] text-white hover:opacity-90'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)]'
          }`}
          title={editMode ? '退出编辑模式' : '进入编辑模式'}
        >
          {editMode ? <Check size={13} /> : <Pencil size={13} />}
          <span>{editMode ? '完成' : '编辑'}</span>
        </button>

        {unlocked && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
            title="站点设置中心（外观、手势、Agent 接入与备份）"
          >
            <Settings size={13} />
            <span className="hidden sm:inline">设置</span>
          </button>
        )}

        {showSwitchToPaged && onSwitchToPaged && (
          <button
            type="button"
            onClick={onSwitchToPaged}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
            title="切回手机分页导航视图"
          >
            <LayoutList size={13} />
            <span>分页</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleDark}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] transition-colors cursor-pointer"
          aria-label="切换深浅色主题"
          title="切换深浅色主题"
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
}
