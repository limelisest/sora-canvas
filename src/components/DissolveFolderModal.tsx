import { FolderOutput, Trash2, X } from 'lucide-react';
import type { FolderContainer } from '../../shared/types';

interface DissolveFolderModalProps {
  folder: FolderContainer | null;
  itemCount: number;
  onClose: () => void;
  onDissolveKeepItems: (folderId: string) => void;
  onDeleteFolderAndItems: (folderId: string) => void;
}

export function DissolveFolderModal({
  folder,
  itemCount,
  onClose,
  onDissolveKeepItems,
  onDeleteFolderAndItems,
}: DissolveFolderModalProps) {
  if (!folder) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bento-modal w-full max-w-sm p-6 relative space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
        >
          <X size={16} />
        </button>

        <div>
          <h2 className="text-base font-semibold">处理文件夹「{folder.title}」</h2>
          <p className="text-xs text-[var(--ink-muted)] mt-1">
            该文件夹内包含 <strong className="text-[var(--ink-main)]">{itemCount}</strong>{' '}
            个书签项目，请选择解散方式：
          </p>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onDissolveKeepItems(folder.id)}
            className="w-full flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left text-xs font-medium bg-[var(--accent-orange)] text-white hover:opacity-92 transition-opacity cursor-pointer"
          >
            <FolderOutput size={16} className="shrink-0" />
            <div>
              <div>仅解散文件夹（保留内部项目移回桌面）</div>
              <div className="text-[11px] opacity-85 font-normal">
                内部项目保持原 ID 与内容，自动放回画布附近空位
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onDeleteFolderAndItems(folder.id)}
            className="w-full flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left text-xs font-medium bg-red-500/10 text-[var(--accent-red)] hover:bg-red-500/18 border border-red-500/20 transition-colors cursor-pointer"
          >
            <Trash2 size={16} className="shrink-0" />
            <div>
              <div>连同内部项目一并删除</div>
              <div className="text-[11px] opacity-80 font-normal">
                彻底移除容器及其包含的所有书签（可通过快照恢复）
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
