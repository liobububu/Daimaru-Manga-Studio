// MediaInput — 统一多模态素材输入组件
// 支持图片 / 视频 / 音频，可上传本地文件、从素材库选择、粘贴 URL
// 支持多选、拖拽排序（简单按钮移位）、role 设置、weight 设置、预览
import AssetPickerDialog from './AssetPickerDialog';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Upload, LibraryBig, Link, X, Loader2,
  Image as ImageIcon, Video as VideoIcon, Music,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { db } from '@/db/client';

// ── 类型定义 ──────────────────────────────────────────────────────────────────
export interface MediaItem {
  id: string;           // 本地唯一 id（不一定是 asset_id）
  asset_id?: string;    // 素材库 ID（有则优先）
  url: string;
  name?: string;
  role?: string;
  weight?: number;
  sort_order?: number;
}

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaInputProps {
  kind: MediaKind;
  label?: string;
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  projectId?: string;
  storyboardIds?: string[];
  /** 允许同时放置的最大数量（默认不限制） */
  maxCount?: number;
  /** 显示 role 选择器 */
  showRole?: boolean;
  /** role 选项列表；不传则用内置 */
  roleOptions?: { value: string; label: string }[];
  /** 单值模式（限 1 个） */
  single?: boolean;
  required?: boolean;
  className?: string;
}

// ── 内置 role 选项 ────────────────────────────────────────────────────────────
const IMAGE_ROLES = [
  { value: 'reference',            label: '普通参考' },
  { value: 'first_frame',          label: '首帧' },
  { value: 'last_frame',           label: '尾帧' },
  { value: 'style_reference',      label: '风格参考' },
  { value: 'character_reference',  label: '角色参考' },
  { value: 'scene_reference',      label: '场景参考' },
  { value: 'composition_reference','label': '构图参考' },
  { value: 'keyframe_reference',   label: '关键帧参考' },
];

const VIDEO_ROLES = [
  { value: 'source',                  label: '源视频' },
  { value: 'reference',               label: '参考视频' },
  { value: 'motion_reference',        label: '运动参考' },
  { value: 'style_reference',         label: '风格参考' },
  { value: 'continuation_source',     label: '续写基础' },
  { value: 'repaint_source',          label: '重绘基础' },
  { value: 'structure_reference',     label: '结构参考' },
  { value: 'camera_motion_reference', label: '镜头运动参考' },
];

const AUDIO_ROLES = [
  { value: 'driver',           label: '驱动音频' },
  { value: 'voice',            label: '语音' },
  { value: 'music',            label: '音乐' },
  { value: 'rhythm_reference', label: '节奏参考' },
  { value: 'emotion_reference','label': '情绪参考' },
  { value: 'lip_sync_audio',   label: '口型同步' },
  { value: 'narration',        label: '旁白' },
  { value: 'dialogue',         label: '对话' },
];

const DEFAULT_ROLES: Record<MediaKind, { value: string; label: string }[]> = {
  image: IMAGE_ROLES,
  video: VIDEO_ROLES,
  audio: AUDIO_ROLES,
};

// ── 接受的 MIME 类型 ──────────────────────────────────────────────────────────
const ACCEPT: Record<MediaKind, string> = {
  image: 'image/jpeg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/quicktime,video/webm',
  audio: 'audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/x-m4a',
};

// ── 辅助：生成本地 id ─────────────────────────────────────────────────────────
let _seq = 0;
function localId() { return `media_${Date.now()}_${++_seq}`; }

// ── 辅助：图片压缩（超 1MB 则压缩为 WEBP） ───────────────────────────────────
async function compressImage(file: File): Promise<Blob> {
  const MAX = 1 * 1024 * 1024;
  if (file.size <= MAX) return file;
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target?.result as string; };
    reader.onerror = reject;
    img.onload = () => {
      const MAX_DIM = 1080;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
        else { width = Math.round(width * MAX_DIM / height); height = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), 'image/webp', 0.8);
    };
    reader.readAsDataURL(file);
  });
}

// ── 辅助：上传文件到本地媒体目录 ──────────────────────────────────────────────
async function uploadFile(file: File, kind: MediaKind): Promise<string> {
  let blob: Blob = file;
  if (kind === 'image') blob = await compressImage(file);

  // 本地版没有用户，统一放在 local/ 前缀下
  const ext  = kind === 'image' ? 'webp' : file.name.split('.').pop() || kind;
  const path = `local/${kind}s/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await db.storage.from('assets').upload(path, blob, { upsert: false });
  if (error) throw new Error(error.message);

  const { data } = db.storage.from('assets').getPublicUrl(path);
  return data.publicUrl;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function MediaInput({
  kind, label, items, onChange, projectId, storyboardIds,
  maxCount, showRole = false, roleOptions,
  single = false, required = false, className,
}: MediaInputProps) {
  const inputRef  = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlMode, setUrlMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const roles    = roleOptions || DEFAULT_ROLES[kind];
  const canAdd   = !maxCount || items.length < maxCount;
  const isFull   = single && items.length >= 1;
  const assetType = kind as import('@/types/types').AssetType;

  // 图标
  const KindIcon = kind === 'image' ? ImageIcon : kind === 'video' ? VideoIcon : Music;

  // ── 上传本地文件 ─────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const results: MediaItem[] = [];
      for (const file of files) {
        const url = await uploadFile(file, kind);
        results.push({ id: localId(), url, name: file.name, role: roles[0]?.value, weight: 1 });
      }
      const next = single ? results.slice(0, 1) : [...items, ...results];
      onChange(next.slice(0, maxCount || next.length));
      toast.success(`${files.length} 个文件上传完成`);
    } catch (err) {
      toast.error(`上传失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  // ── 从素材库选择 ──────────────────────────────────────────────────────────
  function handlePickerSelect(assets: import('@/types/types').Asset[]) {
    const newItems: MediaItem[] = assets.map(a => ({
      id: localId(),
      asset_id: a.id,
      url: a.file_url || a.thumbnail_url || '',
      name: a.name,
      role: roles[0]?.value,
      weight: 1,
    }));
    const base = single ? [] : items;
    const next = [...base, ...newItems];
    onChange(next.slice(0, maxCount || next.length));
  }

  // ── 粘贴 URL ──────────────────────────────────────────────────────────────
  function handleAddUrl() {
    const u = urlInput.trim();
    if (!u) return;
    if (!u.startsWith('http')) { toast.error('请输入有效的 URL（以 http 开头）'); return; }
    const newItem: MediaItem = { id: localId(), url: u, name: u.split('/').pop() || 'URL 素材', role: roles[0]?.value, weight: 1 };
    const base = single ? [] : items;
    const next = [...base, newItem];
    onChange(next.slice(0, maxCount || next.length));
    setUrlInput('');
    setUrlMode(false);
  }

  // ── 更新单个 item ─────────────────────────────────────────────────────────
  function updateItem(id: string, patch: Partial<MediaItem>) {
    onChange(items.map(it => it.id === id ? { ...it, ...patch } : it));
  }

  function removeItem(id: string) {
    onChange(items.filter(it => it.id !== id));
  }

  function moveItem(id: string, dir: -1 | 1) {
    const idx = items.findIndex(it => it.id === id);
    if (idx < 0) return;
    const next = [...items];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }

  // ── 渲染单个 item ─────────────────────────────────────────────────────────
  function renderItem(item: MediaItem, idx: number) {
    return (
      <div key={item.id} className="flex gap-2 items-start p-2 rounded-lg bg-muted/40 border border-border/50">
        {/* 预览 */}
        <div className="w-16 h-16 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
          {kind === 'image' && (
            <img src={item.url} alt={item.name || `图片${idx+1}`}
              className="w-full h-full object-cover" />
          )}
          {kind === 'video' && (
            <video src={item.url} className="w-full h-full object-cover" muted playsInline />
          )}
          {kind === 'audio' && (
            <div className="flex flex-col items-center gap-1">
              <Music className="w-5 h-5 text-muted-foreground" />
              <audio src={item.url} controls className="w-14 h-5" style={{ fontSize: '8px' }} />
            </div>
          )}
        </div>

        {/* 信息 + 控件 */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-xs font-medium truncate text-foreground">{item.name || item.url.split('/').pop() || `素材${idx+1}`}</p>

          {kind === 'audio' && (
            <audio src={item.url} controls className="w-full h-7" />
          )}

          {showRole && (
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={item.role || ''} onValueChange={v => updateItem(item.id, { role: v })}>
                <SelectTrigger className="h-7 text-xs w-32 px-2"><SelectValue placeholder="角色" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                className="h-7 text-xs w-16 px-2"
                type="number" min={0} max={2} step={0.1}
                value={item.weight ?? 1}
                onChange={e => updateItem(item.id, { weight: parseFloat(e.target.value) || 1 })}
                title="权重"
              />
            </div>
          )}
        </div>

        {/* 排序 + 删除 */}
        <div className="flex flex-col gap-0.5 shrink-0">
          {!single && items.length > 1 && (
            <>
              <button type="button" onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => moveItem(item.id, 1)} disabled={idx === items.length - 1}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button type="button" onClick={() => removeItem(item.id)}
            className="w-6 h-6 flex items-center justify-center text-destructive/70 hover:text-destructive">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <Label className="text-xs text-muted-foreground">
          {label}{required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}

      {/* 已选列表 */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, idx) => renderItem(item, idx))}
        </div>
      )}

      {/* 空状态占位 */}
      {items.length === 0 && (
        <div className="h-16 rounded-lg border-2 border-dashed border-border/50 flex items-center justify-center text-muted-foreground">
          <KindIcon className="w-5 h-5 mr-2 opacity-50" />
          <span className="text-xs">暂无{kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}</span>
        </div>
      )}

      {/* URL 输入行 */}
      {urlMode && (
        <div className="flex gap-2">
          <Input
            className="flex-1 h-8 text-xs px-2"
            placeholder={`粘贴${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'} URL…`}
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
          />
          <Button size="sm" className="h-8 text-xs" onClick={handleAddUrl}>确认</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setUrlMode(false); setUrlInput(''); }}>取消</Button>
        </div>
      )}

      {/* 添加按钮行 */}
      {!isFull && canAdd && !urlMode && (
        <div className="flex flex-wrap gap-2">
          {/* 本地上传 */}
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />上传中…</>
              : <><Upload className="w-3.5 h-3.5 mr-1.5" />上传本地{kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}</>}
          </Button>
          {/* 素材库 */}
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setPickerOpen(true)}>
            <LibraryBig className="w-3.5 h-3.5 mr-1.5" />从素材库选择
          </Button>
          {/* URL */}
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs"
            onClick={() => setUrlMode(true)}>
            <Link className="w-3.5 h-3.5 mr-1.5" />粘贴 URL
          </Button>

          {maxCount && (
            <Badge variant="outline" className="text-xs text-muted-foreground ml-auto">
              {items.length}/{maxCount}
            </Badge>
          )}
        </div>
      )}

      {/* 隐藏文件 input */}
      <input ref={inputRef} type="file" hidden accept={ACCEPT[kind]}
        multiple={!single} onChange={handleFileChange} />

      {/* 素材库 picker */}
      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePickerSelect}
        multiple={!single}
        assetType={assetType}
        projectId={projectId}
        storyboardIds={storyboardIds}
        title={`选择${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}素材`}
      />
    </div>
  );
}
