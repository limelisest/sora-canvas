import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Images,
  LayoutGrid,
  Lock,
  Plus,
  StickyNote,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import type {
  CarouselImageItem,
  CarouselWidget,
  FreeTextWidget,
  NoteWidget,
  ZoneContainer,
} from '../../shared/types';
import { MAX_ZONE_SIZE, MIN_ZONE_SIZE, snapQuarter } from '../../shared/gridEngine';
import { uploadImageApi } from '../api';

export type ZoneWidgetEditorDraft =
  | { mode: 'create-zone'; initialPos?: { x: number; y: number } }
  | { mode: 'edit-zone'; zone: ZoneContainer }
  | { mode: 'create-carousel'; initialPos?: { x: number; y: number } }
  | { mode: 'edit-carousel'; widget: CarouselWidget }
  | { mode: 'create-text'; initialPos?: { x: number; y: number } }
  | { mode: 'edit-text'; widget: FreeTextWidget }
  | { mode: 'create-note'; initialPos?: { x: number; y: number } }
  | { mode: 'edit-note'; widget: NoteWidget };

export type ZoneWidgetSavePayload =
  | {
      kind: 'zone';
      title: string;
      accent?: string;
      isPrivate: boolean;
      w: number;
      h: number;
    }
  | {
      kind: 'carousel';
      title?: string;
      images: CarouselImageItem[];
      intervalSec: number;
      transition: 'slide' | 'fade';
      fit: 'cover' | 'contain';
      w: number;
      h: number;
    }
  | {
      kind: 'text';
      text: string;
      fontSize: number;
      color?: string;
      weight: 'normal' | 'semibold' | 'bold';
      align: 'left' | 'center' | 'right';
      w: number;
      h: number;
    }
  | {
      kind: 'note';
      title: string;
      content: string;
      tint?: string;
      isPrivate: boolean;
      w: number;
      h: number;
    };

interface ZoneWidgetEditorModalProps {
  draft: ZoneWidgetEditorDraft | null;
  onClose: () => void;
  onSave: (payload: ZoneWidgetSavePayload) => string | null;
  onDeleteZone?: (zoneId: string) => void;
  onDeleteWidget?: (widgetId: string) => void;
}

const ZONE_ACCENTS = ['#64748b', '#ff5500', '#10b981', '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b'];
const TEXT_COLORS = ['', '#141413', '#ff5500', '#0ea5e9', '#10b981', '#8b5cf6', '#f4f3ef'];
const NOTE_TINTS = [
  { value: '', label: '素纸' },
  { value: '#fef3c7', label: '琥珀黄' },
  { value: '#d1fae5', label: '薄荷绿' },
  { value: '#e0f2fe', label: '晴空蓝' },
  { value: '#ffe4e6', label: '樱花粉' },
  { value: '#ede9fe', label: '薰衣紫' },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`读取文件 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

export function ZoneWidgetEditorModal({
  draft,
  onClose,
  onSave,
  onDeleteZone,
  onDeleteWidget,
}: ZoneWidgetEditorModalProps) {
  const [error, setError] = useState('');

  // Zone fields
  const [zoneTitle, setZoneTitle] = useState('新区域');
  const [zoneAccent, setZoneAccent] = useState('#64748b');
  const [zonePrivate, setZonePrivate] = useState(false);
  const [zoneW, setZoneW] = useState(4);
  const [zoneH, setZoneH] = useState(3);

  // Carousel fields
  const [carTitle, setCarTitle] = useState('');
  const [carImages, setCarImages] = useState<CarouselImageItem[]>([]);
  const [newImgUrl, setNewImgUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [carInterval, setCarInterval] = useState(3);
  const [carTransition, setCarTransition] = useState<'slide' | 'fade'>('slide');
  const [carFit, setCarFit] = useState<'cover' | 'contain'>('cover');
  const [carW, setCarW] = useState(3);
  const [carH, setCarH] = useState(2);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // FreeText fields
  const [txtContent, setTxtContent] = useState('');
  const [txtSize, setTxtSize] = useState(24);
  const [txtColor, setTxtColor] = useState('');
  const [txtWeight, setTxtWeight] = useState<'normal' | 'semibold' | 'bold'>('bold');
  const [txtAlign, setTxtAlign] = useState<'left' | 'center' | 'right'>('left');
  const [txtW, setTxtW] = useState(3);
  const [txtH, setTxtH] = useState(1);

  // Note fields
  const [noteTitle, setNoteTitle] = useState('随手便签');
  const [noteContent, setNoteContent] = useState('');
  const [noteTint, setNoteTint] = useState('#fef3c7');
  const [notePrivate, setNotePrivate] = useState(false);
  const [noteW, setNoteW] = useState(2);
  const [noteH, setNoteH] = useState(2);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draft) return;
    setError('');
    if (draft.mode === 'create-zone') {
      setZoneTitle('新分区');
      setZoneAccent('#64748b');
      setZonePrivate(false);
      setZoneW(4);
      setZoneH(3);
    } else if (draft.mode === 'edit-zone') {
      setZoneTitle(draft.zone.title);
      setZoneAccent(draft.zone.accent || '#64748b');
      setZonePrivate(draft.zone.isPrivate);
      setZoneW(draft.zone.w);
      setZoneH(draft.zone.h);
    } else if (draft.mode === 'create-carousel') {
      setCarTitle('');
      setCarImages([]);
      setNewImgUrl('');
      setCarInterval(3);
      setCarTransition('slide');
      setCarFit('cover');
      setCarW(3);
      setCarH(2);
    } else if (draft.mode === 'edit-carousel') {
      setCarTitle(draft.widget.title || '');
      setCarImages(draft.widget.images.map((img) => ({ ...img })));
      setNewImgUrl('');
      setCarInterval(draft.widget.intervalSec || 3);
      setCarTransition(draft.widget.transition || 'slide');
      setCarFit(draft.widget.fit || 'cover');
      setCarW(draft.widget.w);
      setCarH(draft.widget.h);
    } else if (draft.mode === 'create-text') {
      setTxtContent('分组标题');
      setTxtSize(24);
      setTxtColor('');
      setTxtWeight('bold');
      setTxtAlign('left');
      setTxtW(3);
      setTxtH(1);
    } else if (draft.mode === 'edit-text') {
      setTxtContent(draft.widget.text);
      setTxtSize(draft.widget.fontSize);
      setTxtColor(draft.widget.color || '');
      setTxtWeight(draft.widget.weight);
      setTxtAlign(draft.widget.align);
      setTxtW(draft.widget.w);
      setTxtH(draft.widget.h);
    } else if (draft.mode === 'create-note') {
      setNoteTitle('随手便签');
      setNoteContent('');
      setNoteTint('#fef3c7');
      setNotePrivate(false);
      setNoteW(2);
      setNoteH(2);
    } else if (draft.mode === 'edit-note') {
      setNoteTitle(draft.widget.title);
      setNoteContent(draft.widget.content);
      setNoteTint(draft.widget.tint ?? '');
      setNotePrivate(Boolean(draft.widget.isPrivate));
      setNoteW(draft.widget.w);
      setNoteH(draft.widget.h);
    }
  }, [draft]);

  useEffect(() => {
    if (draft?.mode === 'edit-note' || draft?.mode === 'create-note') {
      const id = window.setTimeout(() => noteTextareaRef.current?.focus(), 40);
      return () => window.clearTimeout(id);
    }
  }, [draft]);

  if (!draft) return null;

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const added: CarouselImageItem[] = [];
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const res = await uploadImageApi({ dataUrl });
        added.push({
          id: `img-${crypto.randomUUID().slice(0, 8)}`,
          url: res.url,
          caption: '',
          linkUrl: '',
        });
      }
      setCarImages((prev) => [...prev, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  }

  function handleAddExternalImage() {
    const clean = newImgUrl.trim();
    if (!clean) return;
    if (!/^https?:\/\//i.test(clean) && !clean.startsWith('/api/uploads/')) {
      setError('请输入以 http:// 或 https:// 开头的图片地址');
      return;
    }
    setError('');
    setCarImages((prev) => [
      ...prev,
      {
        id: `img-${crypto.randomUUID().slice(0, 8)}`,
        url: clean,
        caption: '',
        linkUrl: '',
      },
    ]);
    setNewImgUrl('');
  }

  function moveImage(idx: number, delta: -1 | 1) {
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= carImages.length) return;
    setCarImages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError('');

    let msg: string | null = null;
    if (draft.mode === 'create-zone' || draft.mode === 'edit-zone') {
      if (!zoneTitle.trim()) {
        setError('请输入分区名称');
        return;
      }
      const w = Math.max(MIN_ZONE_SIZE, Math.min(MAX_ZONE_SIZE, snapQuarter(zoneW)));
      const h = Math.max(MIN_ZONE_SIZE, Math.min(MAX_ZONE_SIZE, snapQuarter(zoneH)));
      msg = onSave({
        kind: 'zone',
        title: zoneTitle.trim(),
        accent: zoneAccent || undefined,
        isPrivate: zonePrivate,
        w,
        h,
      });
    } else if (draft.mode === 'create-carousel' || draft.mode === 'edit-carousel') {
      msg = onSave({
        kind: 'carousel',
        title: carTitle.trim() || undefined,
        images: carImages,
        intervalSec: Math.max(1, Math.min(30, Math.round(carInterval || 3))),
        transition: carTransition,
        fit: carFit,
        w: carW,
        h: carH,
      });
    } else if (draft.mode === 'create-text' || draft.mode === 'edit-text') {
      if (!txtContent.trim()) {
        setError('请输入文字内容');
        return;
      }
      msg = onSave({
        kind: 'text',
        text: txtContent,
        fontSize: Math.max(12, Math.min(72, Math.round(txtSize || 24))),
        color: txtColor || undefined,
        weight: txtWeight,
        align: txtAlign,
        w: Math.max(1, Math.min(40, snapQuarter(txtW))),
        h: Math.max(0.75, Math.min(40, snapQuarter(txtH))),
      });
    } else {
      msg = onSave({
        kind: 'note',
        title: noteTitle.trim() || '便签',
        content: noteContent,
        tint: noteTint || undefined,
        isPrivate: notePrivate,
        w: noteW,
        h: noteH,
      });
    }
    if (msg) setError(msg);
  }

  const isZone = draft.mode === 'create-zone' || draft.mode === 'edit-zone';
  const isCarousel = draft.mode === 'create-carousel' || draft.mode === 'edit-carousel';
  const isText = draft.mode === 'create-text' || draft.mode === 'edit-text';
  const isNote = draft.mode === 'create-note' || draft.mode === 'edit-note';

  const heading =
    draft.mode === 'create-zone'
      ? '新建区域分区框'
      : draft.mode === 'edit-zone'
        ? '编辑区域分区框'
        : draft.mode === 'create-carousel'
          ? '新建轮播图小部件'
          : draft.mode === 'edit-carousel'
            ? '编辑轮播图小部件'
            : draft.mode === 'create-text'
              ? '新建自由文字'
              : draft.mode === 'edit-text'
                ? '编辑自由文字'
                : draft.mode === 'create-note'
                  ? '新建便签贴纸'
                  : '编辑便签内容';

  const HeadingIcon = isZone ? LayoutGrid : isCarousel ? Images : isText ? Type : StickyNote;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="bento-modal w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-hair)]">
          <div className="flex items-center gap-2">
            <HeadingIcon size={16} className="text-[var(--accent-orange)]" />
            <h3 className="text-base font-semibold">{heading}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bento-scroll flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {isZone && (
            <>
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">分区标题</label>
                <input
                  type="text"
                  value={zoneTitle}
                  onChange={(e) => setZoneTitle(e.target.value)}
                  className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">分区主题色</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {ZONE_ACCENTS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setZoneAccent(hex)}
                      style={{ backgroundColor: hex }}
                      className={`h-6 w-6 rounded-full cursor-pointer transition-transform ${
                        zoneAccent === hex ? 'scale-110 ring-2 ring-offset-2 ring-[var(--ink-main)]' : ''
                      }`}
                    />
                  ))}
                  <input
                    type="color"
                    value={zoneAccent}
                    onChange={(e) => setZoneAccent(e.target.value)}
                    className="h-7 w-9 rounded cursor-pointer bg-transparent border border-[var(--border-hair)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                    宽度 (2..40 · 0.25步进)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={40}
                    step={0.25}
                    value={zoneW}
                    onChange={(e) => setZoneW(Number(e.target.value))}
                    className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                    高度 (2..40 · 0.25步进)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={40}
                    step={0.25}
                    value={zoneH}
                    onChange={(e) => setZoneH(Number(e.target.value))}
                    className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)]"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] cursor-pointer">
                <div className="flex items-center gap-2">
                  <Lock size={14} className="text-amber-500 shrink-0" />
                  <div>
                    <div className="font-medium">设为私密分区</div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      未解锁时，连同分区框及框内所有文件夹、书签与小部件一并隐藏
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={zonePrivate}
                  onChange={(e) => setZonePrivate(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent-orange)]"
                />
              </label>
            </>
          )}

          {isCarousel && (
            <>
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                  标题（可选）
                </label>
                <input
                  type="text"
                  value={carTitle}
                  onChange={(e) => setCarTitle(e.target.value)}
                  placeholder="如：桌面画廊"
                  className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)]"
                />
              </div>

              <div className="space-y-2 p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--ink-secondary)]">
                    图片列表 ({carImages.length})
                  </span>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
                  >
                    <Upload size={12} />
                    <span>{uploading ? '上传中...' : '上传本地图片'}</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void handleUploadFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={newImgUrl}
                    onChange={(e) => setNewImgUrl(e.target.value)}
                    placeholder="或粘贴图片外链 https://..."
                    className="bento-input flex-1 px-2.5 py-1.5 text-xs bg-[var(--bg-card)]"
                  />
                  <button
                    type="button"
                    onClick={handleAddExternalImage}
                    className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 font-medium bg-[var(--bg-card)] border border-[var(--border-hair)] hover:border-[var(--border-strong)] cursor-pointer shrink-0"
                  >
                    <Plus size={12} />
                    <span>添加外链</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-52 overflow-y-auto bento-scroll pr-0.5">
                  {carImages.map((img, idx) => (
                    <div
                      key={img.id}
                      className="flex items-start gap-2.5 p-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-hair)]"
                    >
                      <img
                        src={img.url}
                        alt=""
                        className="h-12 w-12 rounded-lg object-cover bg-[var(--bg-subtle)] shrink-0"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <input
                          type="text"
                          value={img.caption || ''}
                          onChange={(e) =>
                            setCarImages((prev) =>
                              prev.map((it) =>
                                it.id === img.id ? { ...it, caption: e.target.value } : it
                              )
                            )
                          }
                          placeholder="图片说明（可选）"
                          className="bento-input w-full px-2 py-1 text-[11px] bg-[var(--bg-subtle)]"
                        />
                        <input
                          type="url"
                          value={img.linkUrl || ''}
                          onChange={(e) =>
                            setCarImages((prev) =>
                              prev.map((it) =>
                                it.id === img.id ? { ...it, linkUrl: e.target.value } : it
                              )
                            )
                          }
                          placeholder="点击跳转链接 https://...（可选）"
                          className="bento-input w-full px-2 py-1 text-[11px] bg-[var(--bg-subtle)]"
                        />
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveImage(idx, -1)}
                          disabled={idx === 0}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-[var(--bg-subtle)] disabled:opacity-30 cursor-pointer"
                          title="上移"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(idx, 1)}
                          disabled={idx === carImages.length - 1}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-[var(--bg-subtle)] disabled:opacity-30 cursor-pointer"
                          title="下移"
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCarImages((prev) => prev.filter((it) => it.id !== img.id))
                          }
                          className="h-5 w-5 rounded flex items-center justify-center text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
                          title="移除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {carImages.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-[var(--ink-muted)]">
                      暂无图片，可一次选择多张本地图片上传或添加外链 URL
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                    轮播间隔 (秒)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={carInterval}
                    onChange={(e) => setCarInterval(Number(e.target.value))}
                    className="bento-input w-full px-2.5 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">动画</label>
                  <select
                    value={carTransition}
                    onChange={(e) => setCarTransition(e.target.value as 'slide' | 'fade')}
                    className="bento-input w-full px-2 py-1.5 bg-[var(--bg-subtle)]"
                  >
                    <option value="slide">平滑滑动</option>
                    <option value="fade">淡入淡出</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">填充</label>
                  <select
                    value={carFit}
                    onChange={(e) => setCarFit(e.target.value as 'cover' | 'contain')}
                    className="bento-input w-full px-2 py-1.5 bg-[var(--bg-subtle)]"
                  >
                    <option value="cover">铺满裁剪</option>
                    <option value="contain">完整适应</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">宽度 (1..6)</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={carW}
                    onChange={(e) => setCarW(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))))}
                    className="bento-input w-full px-3 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">高度 (1..6)</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={carH}
                    onChange={(e) => setCarH(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))))}
                    className="bento-input w-full px-3 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
              </div>
            </>
          )}

          {isText && (
            <>
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">文字内容</label>
                <textarea
                  rows={3}
                  value={txtContent}
                  onChange={(e) => setTxtContent(e.target.value)}
                  className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)] resize-y"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                    字号 ({txtSize}px)
                  </label>
                  <input
                    type="range"
                    min={12}
                    max={72}
                    value={txtSize}
                    onChange={(e) => setTxtSize(Number(e.target.value))}
                    className="w-full accent-[var(--accent-orange)] mt-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">字重</label>
                  <select
                    value={txtWeight}
                    onChange={(e) =>
                      setTxtWeight(e.target.value as 'normal' | 'semibold' | 'bold')
                    }
                    className="bento-input w-full px-2 py-1.5 bg-[var(--bg-subtle)]"
                  >
                    <option value="normal">常规</option>
                    <option value="semibold">半粗</option>
                    <option value="bold">粗体</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">对齐</label>
                  <select
                    value={txtAlign}
                    onChange={(e) => setTxtAlign(e.target.value as 'left' | 'center' | 'right')}
                    className="bento-input w-full px-2 py-1.5 bg-[var(--bg-subtle)]"
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">文字颜色</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setTxtColor('')}
                    className={`rounded-full px-2.5 py-1 text-[11px] border cursor-pointer ${
                      txtColor === ''
                        ? 'bg-[var(--ink-main)] text-[var(--bg-card)] border-transparent'
                        : 'bg-[var(--bg-subtle)] border-[var(--border-hair)]'
                    }`}
                  >
                    跟随主题
                  </button>
                  {TEXT_COLORS.filter(Boolean).map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setTxtColor(hex)}
                      style={{ backgroundColor: hex }}
                      className={`h-5.5 w-5.5 rounded-full border border-[var(--border-strong)] cursor-pointer ${
                        txtColor === hex ? 'ring-2 ring-offset-1 ring-[var(--accent-orange)]' : ''
                      }`}
                    />
                  ))}
                  <input
                    type="color"
                    value={txtColor || '#141413'}
                    onChange={(e) => setTxtColor(e.target.value)}
                    className="h-6 w-8 rounded cursor-pointer bg-transparent border border-[var(--border-hair)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                    文本框宽度 (0.25 步进)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    step={0.25}
                    value={txtW}
                    onChange={(e) => setTxtW(Number(e.target.value))}
                    className="bento-input w-full px-3 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">
                    最小高度 (0.25 步进)
                  </label>
                  <input
                    type="number"
                    min={0.75}
                    max={40}
                    step={0.25}
                    value={txtH}
                    onChange={(e) => setTxtH(Number(e.target.value))}
                    className="bento-input w-full px-3 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
              </div>
            </>
          )}

          {isNote && (
            <>
              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">便签标题</label>
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)]"
                />
              </div>

              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1">便签内容</label>
                <textarea
                  ref={noteTextareaRef}
                  rows={6}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="支持多行备忘录、待办事项或常用指令..."
                  className="bento-input w-full px-3 py-2 text-sm bg-[var(--bg-subtle)] resize-y leading-relaxed"
                />
              </div>

              <div>
                <label className="block font-medium text-[var(--ink-secondary)] mb-1.5">便签纸色</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {NOTE_TINTS.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => setNoteTint(t.value)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] border cursor-pointer ${
                        noteTint === t.value
                          ? 'border-[var(--accent-orange)] ring-1 ring-[var(--accent-orange)] font-medium'
                          : 'border-[var(--border-hair)]'
                      }`}
                    >
                      <span
                        className="h-3 w-3 rounded-full border border-black/15"
                        style={{ backgroundColor: t.value || 'var(--bg-card)' }}
                      />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">宽度 (1..6)</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={noteW}
                    onChange={(e) => setNoteW(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))))}
                    className="bento-input w-full px-3 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--ink-secondary)] mb-1">高度 (1..6)</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={noteH}
                    onChange={(e) => setNoteH(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))))}
                    className="bento-input w-full px-3 py-1.5 bg-[var(--bg-subtle)]"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-hair)] cursor-pointer">
                <div className="flex items-center gap-2">
                  <Lock size={14} className="text-amber-500 shrink-0" />
                  <div>
                    <div className="font-medium">私密便签（未解锁时隐藏）</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={notePrivate}
                  onChange={(e) => setNotePrivate(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent-orange)]"
                />
              </label>
            </>
          )}

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-[var(--accent-red)]/30 px-3 py-2 text-xs text-[var(--accent-red)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border-hair)]">
            {draft.mode === 'edit-zone' && onDeleteZone ? (
              <button
                type="button"
                onClick={() => onDeleteZone(draft.zone.id)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>删除分区框</span>
              </button>
            ) : (draft.mode === 'edit-carousel' ||
                draft.mode === 'edit-text' ||
                draft.mode === 'edit-note') &&
              onDeleteWidget ? (
              <button
                type="button"
                onClick={() => onDeleteWidget(draft.widget.id)}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-medium text-[var(--accent-red)] hover:bg-red-500/10 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>删除小部件</span>
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-1.5 font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="rounded-full px-5 py-1.5 font-medium bg-[var(--accent-orange)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
