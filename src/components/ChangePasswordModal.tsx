import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, X } from 'lucide-react';
import { changePasswordApi } from '../api';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChangePasswordModal({ open, onClose, onSuccess }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      setError('请输入当前密码');
      return;
    }
    if (newPassword.length < 6) {
      setError('新密码长度不能少于 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await changePasswordApi(currentPassword, newPassword);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败');
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
          className="absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-[var(--accent-orange)]/12 text-[var(--accent-orange)] flex items-center justify-center">
            <KeyRound size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold">修改管理密码</h2>
            <p className="text-xs text-[var(--ink-muted)]">新密码至少 6 位，立即生效</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="当前管理密码"
            className="bento-input w-full px-3.5 py-2.5 text-sm"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="新密码（至少 6 位）"
            className="bento-input w-full px-3.5 py-2.5 text-sm"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="确认新密码"
            className="bento-input w-full px-3.5 py-2.5 text-sm"
          />

          {error && <p className="text-xs text-[var(--accent-red)] font-medium">{error}</p>}

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
              {loading ? '保存中...' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
