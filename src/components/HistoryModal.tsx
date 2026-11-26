import { useEffect, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import type { HistorySnapshotSummary } from '../../shared/types';
import { fetchHistoryList } from '../api';

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  onRestore: (id: string) => Promise<void>;
}

export function HistoryModal({ open, onClose, onRestore }: HistoryModalProps) {
  const [items, setItems] = useState<HistorySnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    fetchHistoryList()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : '加载历史失败'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bento-modal w-full max-w-md max-h-[78vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-hair)]">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[var(--accent-orange)]" />
            <h2 className="text-base font-semibold">自动历史快照</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="bento-scroll flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading && (
            <div className="py-10 text-center text-xs text-[var(--ink-muted)]">加载快照中...</div>
          )}
          {error && (
            <div className="py-6 text-center text-xs text-[var(--accent-red)]">{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="py-10 text-center text-xs text-[var(--ink-muted)]">
              暂无历史快照（每次修改画布会自动保存快照）
            </div>
          )}
          {!loading &&
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{item.reason}</div>
                  <div className="text-[11px] text-[var(--ink-muted)]">
                    {new Date(item.createdAt).toLocaleString()} · {item.nodeCount} 个节点
                  </div>
                </div>
                <button
                  type="button"
                  disabled={restoringId !== null}
                  onClick={async () => {
                    setRestoringId(item.id);
                    try {
                      await onRestore(item.id);
                      onClose();
                    } finally {
                      setRestoringId(null);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--bg-card)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer shrink-0"
                >
                  <RotateCcw size={12} />
                  <span>{restoringId === item.id ? '恢复中' : '回滚'}</span>
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
