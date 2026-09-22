// ImageInputField — 统一图片输入控件
// 支持：上传本地图片（自动压缩）、从素材库选择、手动输入 URL、预览、清空
import AssetPickerDialog from './AssetPickerDialog';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, LibraryBig, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Asset } from '@/types/types';
import { db } from '@/db/client';
import { createAsset } from '@/services/api';

export interface ImageValue {
  assetId?: string;     // 素材库 asset.id
  url: string;          // 最终可访问的图片 URL
  name?: string;        // 展示名称
}

interface ImageInputFieldProps {
  label?: string;
  value?: ImageValue | null;
  onChange: (val: ImageValue | null) => void;
  projectId?: string;
  className?: string;
  required?: boolean;
}

/** 图片压缩：超过 1MB 则压缩为 WEBP，最大 1080p，质量 0.8 */
async function compressImage(file: File): Promise<{ blob: Blob; compressed: boolean; sizeMB: number }> {
  const MAX_BYTES = 1 * 1024 * 1024;
  if (file.size <= MAX_BYTES) {
    return { blob: file, compressed: false, sizeMB: +(file.size / 1024 / 1024).toFixed(2) };
  }
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target?.result as string; };
    reader.onerror = reject;
    img.onload = () => {
      const MAX_DIM = 1080;
      let w = img.width;
      let h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round((h / w) * MAX_DIM); w = MAX_DIM; }
        else { w = Math.round((w / h) * MAX_DIM); h = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('压缩失败')); return; }
        resolve({ blob, compressed: true, sizeMB: +(blob.size / 1024 / 1024).toFixed(2) });
      }, 'image/webp', 0.8);
    };
    reader.readAsDataURL(file);
  });
}

export default function ImageInputField({
  label,
  value,
  onChange,
  projectId,
  className,
  required,
}: ImageInputFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED.includes(file.type)) {
      toast.error('仅支持 JPG / PNG / WebP / GIF 格式');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('图片过大，请压缩后重新上传（最大 20 MB）');
      return;
    }

    setUploading(true);
    try {
      const { compressed, blob, sizeMB } = await compressImage(file);

      // 文件名只保留字母数字，避免 Storage 路径问题
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = compressed ? 'webp' : safeName.split('.').pop() || 'jpg';
      const path = `${projectId || 'shared'}/${Date.now()}_${safeName.replace(/\.[^.]+$/, '')}.${ext}`;

      const { error: upErr } = await db.storage.from('assets').upload(path, blob, {
        contentType: compressed ? 'image/webp' : file.type,
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data: urlData } = db.storage.from('assets').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl || '';

      // 同步保存到 assets 表
      const asset = await createAsset({
        project_id: projectId || '',
        asset_type: 'image',
        name: file.name,
        file_url: publicUrl,
        thumbnail_url: publicUrl,
        source_module: 'upload',
        favorite: false,
      });

      onChange({ assetId: asset.id, url: publicUrl, name: file.name });
      if (compressed) {
        toast.success(`图片已压缩并上传（${sizeMB} MB）`);
      } else {
        toast.success('图片上传成功');
      }
    } catch (err) {
      toast.error(`上传失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setUploading(false);
    }
  }

  function handleLibrarySelect(assets: Asset[]) {
    const a = assets[0];
    if (!a) return;
    onChange({ assetId: a.id, url: a.file_url || a.thumbnail_url || '', name: a.name });
  }

  function handleUrlConfirm() {
    const url = urlInput.trim();
    if (!url) return;
    onChange({ url, name: url.split('/').pop() || 'external' });
    setUrlInput('');
  }

  function handleClear() {
    onChange(null);
    setUrlInput('');
  }

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <Label>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}

      {/* 已选图片预览 */}
      {value?.url ? (
        <div className="relative inline-block">
          <img
            src={value.url}
            alt={value.name || '参考图'}
            className="h-28 w-28 object-cover rounded-lg border border-border"
          />
          <button
            type="button"
            onClick={handleClear}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80"
          >
            <X className="w-3 h-3" />
          </button>
          {value.name && (
            <p className="text-xs text-muted-foreground mt-1 max-w-[7rem] truncate">{value.name}</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-border/60 flex flex-col items-center justify-center h-28 text-muted-foreground gap-1">
          <ImageIcon className="w-6 h-6 opacity-50" />
          <p className="text-xs">尚未选择图片</p>
        </div>
      )}

      {/* 操作按钮行 */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 上传本地 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleUpload}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5 mr-1" />
          )}
          {uploading ? '上传中…' : '上传图片'}
        </Button>

        {/* 从素材库选 */}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setPickerOpen(true)}
        >
          <LibraryBig className="w-3.5 h-3.5 mr-1" />
          素材库
        </Button>

        {/* 输入 URL */}
        <div className="flex gap-1 min-w-0 flex-1">
          <Input
            className="h-8 text-xs min-w-0"
            placeholder="或粘贴图片 URL…"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleUrlConfirm(); } }}
          />
          {urlInput && (
            <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0" onClick={handleUrlConfirm}>
              确认
            </Button>
          )}
        </div>
      </div>

      {/* 素材库弹窗 */}
      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleLibrarySelect}
        assetType="image"
        projectId={projectId}
        title="从素材库选择图片"
      />
    </div>
  );
}
