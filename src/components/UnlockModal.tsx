import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Lock, X } from 'lucide-react';
import { unlockAuth } from '../api';

interface UnlockModalProps {
  open: boolean;
  reason?: string;
  onClose: () => void;
  onUnlocked: () => void;
}

export function UnlockModal({ open, reason, onClose, onUnlocked }: UnlockModalProps) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setRemember(true);
      setError('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError('请输入管理密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await unlockAuth(password, remember);
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码校验失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bento-modal w-full max-w-sm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-main)] cursor-pointer"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-amber-500/12 text-amber-500 flex items-center justify-center">
            <Lock size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold">验证管理密码</h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {reason || '解锁私密文件夹与编辑模式'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <KeyRound
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"
            />
            <input
              ref={inputRef}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入管理密码..."
              className="bento-input w-full pl-9 pr-3.5 py-2.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--ink-secondary)] cursor-pointer select-none px-0.5">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent-orange)] rounded"
            />
            <span>记住当前设备（下次直接显示，无需重复输入）</span>
          </label>

          {error && (
            <p className="text-xs text-[var(--accent-red)] font-medium">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-full px-5 py-2 text-xs font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {loading ? '验证中...' : '确认解锁'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
