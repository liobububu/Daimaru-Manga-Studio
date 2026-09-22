import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Archive, Search, Download, Trash2, Pencil, Copy, Upload, Play, Video, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { getAssets, updateAsset, deleteAsset, createAsset } from '@/services/api';
import type { Asset } from '@/types/types';
import { ASSET_TYPE_LABELS } from '@/types/types';
import { db } from '@/db/client';

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'text', label: '文本' },
];
const CREATIVE_CATEGORIES = [
  { value: 'all', label: '全部用途' },
  { value: 'character', label: '角色资产' },
  { value: 'scene', label: '场景资产' },
  { value: 'prop', label: '道具资产' },
  { value: 'uncategorized', label: '未分类' },
];

const typeColors: Record<string, string> = {
  image: 'bg-green-500/20 text-green-300',
  video: 'bg-blue-500/20 text-blue-300',
  audio: 'bg-yellow-500/20 text-yellow-300',
  text: 'bg-purple-500/20 text-purple-300',
  other: 'bg-muted text-muted-foreground',
};

export default function AssetsPage() {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await getAssets(selectedProjectId, typeFilter !== 'all' ? typeFilter as Asset['asset_type'] : undefined);
      setAssets(data);
    } catch { toast.error('加载失败'); }
    finally { setLoading(false); }
  }, [selectedProjectId, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = assets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) &&
    (categoryFilter === 'all' ||
      (categoryFilter === 'uncategorized' ? !a.metadata?.category : a.metadata?.category === categoryFilter)),
  );

  async function handleDelete(id: string) {
    await deleteAsset(id);
    setAssets(prev => prev.filter(a => a.id !== id));
    toast.success('已删除');
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    await updateAsset(id, { name: renameValue });
    setAssets(prev => prev.map(a => a.id === id ? { ...a, name: renameValue } : a));
    setRenamingId(null);
    toast.success('已重命名');
  }

  async function setCreativeCategory(asset: Asset, category?: 'character' | 'scene' | 'prop') {
    const metadata = { ...(asset.metadata || {}) };
    if (category) metadata.category = category;
    else delete metadata.category;
    await updateAsset(asset.id, { metadata });
    setAssets(prev => prev.map(item => item.id === asset.id ? { ...item, metadata } : item));
    toast.success(category ? '已加入创作资产分类' : '已取消创作资产分类');
  }

  function handleDownload(a: Asset) {
    const url = a.file_url || a.thumbnail_url;
    if (!url) { toast.error('无可下载文件'); return; }
    const el = document.createElement('a');
    el.href = url; el.download = a.name; el.target = '_blank'; el.click();
  }

  function handleCopyUrl(a: Asset) {
    const url = a.file_url || a.thumbnail_url || '';
    navigator.clipboard.writeText(url);
    toast.success('已复制文件地址');
  }

  function handleCopyPrompt(a: Asset) {
    if (!a.prompt) { toast.error('该素材无提示词'); return; }
    navigator.clipboard.writeText(a.prompt);
    toast.success('已复制提示词');
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      for (const file of files) {
        const type = file.type.startsWith('image/') ? 'image' :
          file.type.startsWith('video/') ? 'video' :
          file.type.startsWith('audio/') ? 'audio' : 'other';
        // 上传到本地媒体目录
        const path = `${selectedProjectId}/${Date.now()}_${file.name}`;
        const { data: uploadData } = await db.storage.from('assets').upload(path, file);
        if (uploadData) {
          const { data: urlData } = db.storage.from('assets').getPublicUrl(path);
          await createAsset({
            project_id: selectedProjectId,
            asset_type: type as Asset['asset_type'],
            name: file.name,
            file_url: urlData?.publicUrl || '',
            thumbnail_url: type === 'image' ? urlData?.publicUrl : undefined,
            source_module: 'upload',
            favorite: false,
          });
        }
      }
      toast.success(`成功上传 ${files.length} 个文件`);
      await load();
    } catch (e) {
      toast.error(`上传失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
    e.target.value = '';
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Archive className="w-5 h-5 text-orange-400" />素材库
          </h1>
          <div className="flex items-center gap-2">
            <ProjectSelector className="w-40" />
            <label>
              <input type="file" multiple className="hidden" onChange={handleUpload} />
              <span className="cursor-pointer inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
                <Upload className="w-4 h-4 mr-1" />上传素材
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-0 md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索素材…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>{TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>{CREATIVE_CATEGORIES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {!selectedProjectId ? (
          <div className="text-center py-16 text-muted-foreground">
            <Archive className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>请先选择项目</p>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="aspect-square rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Archive className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{assets.length === 0 ? '暂无素材，点击「上传素材」或通过生成页面添加' : '没有匹配的素材'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map(a => (
              <div key={a.id} className="group relative rounded-lg overflow-hidden border border-border bg-card hover:border-primary/30 transition-colors">
                {/* 预览区 */}
                <div className="aspect-square relative bg-muted flex items-center justify-center">
                  {a.asset_type === 'image' && a.thumbnail_url ? (
                    <img src={a.thumbnail_url} alt={a.name} className="w-full h-full object-cover" />
                  ) : a.asset_type === 'video' ? (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Play className="w-8 h-8" />
                      {a.thumbnail_url && <img src={a.thumbnail_url} alt="thumb" className="absolute inset-0 w-full h-full object-cover opacity-50" />}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs p-2 text-center">
                      {ASSET_TYPE_LABELS[a.asset_type] || '文件'}
                    </div>
                  )}
                  {/* 类型标签 */}
                  <Badge className={`absolute top-1 left-1 text-xs ${typeColors[a.asset_type] || typeColors.other}`} variant="outline">
                    {ASSET_TYPE_LABELS[a.asset_type] || a.asset_type}
                  </Badge>
                  {typeof a.metadata?.category === 'string' && (
                    <Badge className="absolute top-1 right-1 text-xs bg-black/70 text-white border-0">
                      {a.metadata.category === 'character' ? '角色' : a.metadata.category === 'scene' ? '场景' : a.metadata.category === 'prop' ? '道具' : a.metadata.category}
                    </Badge>
                  )}
                  {/* 悬停操作 */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                    <div className="flex justify-end gap-1">
                      <button className="p-1.5 rounded bg-black/50 hover:bg-black/80 text-white" onClick={() => setPreviewAsset(a)}>
                        <Play className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded bg-black/50 hover:bg-black/80 text-white" onClick={() => handleDownload(a)}>
                        <Download className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded bg-black/50 hover:bg-black/80 text-white" onClick={() => { setRenamingId(a.id); setRenameValue(a.name); }}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded bg-black/50 hover:bg-black/80 text-white text-red-400" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* 图片素材快捷操作 */}
                    {a.asset_type === 'image' && (
                      <div className="flex flex-col gap-1">
                        <div className="grid grid-cols-3 gap-1">
                          {(['character','scene','prop'] as const).map(category => (
                            <button key={category} className={`py-1 rounded text-[10px] ${a.metadata?.category === category ? 'bg-primary text-primary-foreground' : 'bg-black/50 hover:bg-black/80 text-white'}`}
                              onClick={() => setCreativeCategory(a, a.metadata?.category === category ? undefined : category)}>
                              {category === 'character' ? '角色' : category === 'scene' ? '场景' : '道具'}
                            </button>
                          ))}
                        </div>
                        <button
                          className="w-full py-1 rounded bg-primary/90 hover:bg-primary text-primary-foreground text-xs flex items-center justify-center gap-1 font-medium"
                          onClick={() => navigate(`/videos?mode=image_to_video&reference_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />图生视频
                        </button>
                        <button
                          className="w-full py-1 rounded bg-black/50 hover:bg-black/80 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => navigate(`/videos?mode=audio_driven&reference_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />音频驱动视频
                        </button>
                        <button
                          className="w-full py-1 rounded bg-black/50 hover:bg-black/80 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => navigate(`/images?mode=image_to_image&reference_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <ImageIcon className="w-3 h-3" />用于图生图
                        </button>
                      </div>
                    )}
                    {/* 视频素材快捷操作 */}
                    {a.asset_type === 'video' && (
                      <div className="flex flex-col gap-1">
                        <button
                          className="w-full py-1 rounded bg-primary/90 hover:bg-primary text-primary-foreground text-xs flex items-center justify-center gap-1 font-medium"
                          onClick={() => navigate(`/videos?mode=video_to_video&video_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />视频转视频
                        </button>
                        <button
                          className="w-full py-1 rounded bg-black/50 hover:bg-black/80 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => navigate(`/videos?mode=video_extend&video_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />续写视频
                        </button>
                        <button
                          className="w-full py-1 rounded bg-black/50 hover:bg-black/80 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => navigate(`/videos?mode=video_audio_to_video&video_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />视频+音频生视频
                        </button>
                      </div>
                    )}
                    {/* 音频素材快捷操作 */}
                    {a.asset_type === 'audio' && (
                      <div className="flex flex-col gap-1">
                        <button
                          className="w-full py-1 rounded bg-primary/90 hover:bg-primary text-primary-foreground text-xs flex items-center justify-center gap-1 font-medium"
                          onClick={() => navigate(`/videos?mode=audio_driven&audio_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />音频驱动视频
                        </button>
                        <button
                          className="w-full py-1 rounded bg-black/50 hover:bg-black/80 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => navigate(`/videos?mode=lip_sync&audio_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />口型同步
                        </button>
                        <button
                          className="w-full py-1 rounded bg-black/50 hover:bg-black/80 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => navigate(`/videos?mode=image_audio_to_video&audio_asset_id=${a.id}${selectedProjectId ? `&project_id=${selectedProjectId}` : ''}`)}
                        >
                          <Video className="w-3 h-3" />图片+音频生视频
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* 名称 */}
                <div className="p-2">
                  {renamingId === a.id ? (
                    <div className="flex gap-1">
                      <Input className="h-6 text-xs px-1" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') handleRename(a.id); if (e.key === 'Escape') setRenamingId(null); }} />
                      <Button size="sm" className="h-6 px-2 text-xs" onClick={() => handleRename(a.id)}>✓</Button>
                    </div>
                  ) : (
                    <p className="text-xs truncate text-muted-foreground">{a.name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 预览弹窗 */}
      <Dialog open={!!previewAsset} onOpenChange={open => !open && setPreviewAsset(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl bg-card border-border">
          <DialogHeader><DialogTitle className="truncate">{previewAsset?.name}</DialogTitle></DialogHeader>
          {previewAsset && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden bg-muted flex items-center justify-center max-h-[60vh]">
                {previewAsset.asset_type === 'image' ? (
                  <img src={previewAsset.file_url || previewAsset.thumbnail_url || ''} alt={previewAsset.name} className="max-w-full max-h-[60vh] object-contain" />
                ) : previewAsset.asset_type === 'video' ? (
                  <video src={previewAsset.file_url || ''} controls className="max-w-full max-h-[60vh]" style={{ objectFit: 'contain' }}>
                    <track kind="captions" />
                  </video>
                ) : (
                  <div className="p-8 text-muted-foreground text-sm">{previewAsset.name}</div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="secondary" onClick={() => handleDownload(previewAsset)}>
                  <Download className="w-4 h-4 mr-1" />下载
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleCopyUrl(previewAsset)}>
                  <Copy className="w-4 h-4 mr-1" />复制地址
                </Button>
                {previewAsset.prompt && (
                  <Button size="sm" variant="secondary" onClick={() => handleCopyPrompt(previewAsset)}>
                    <Copy className="w-4 h-4 mr-1" />复制提示词
                  </Button>
                )}
                {previewAsset.asset_type === 'image' && (
                  <>
                    <Button size="sm" onClick={() => { navigate(`/videos?mode=image_to_video&reference_asset_id=${previewAsset.id}`); setPreviewAsset(null); }}>
                      <Video className="w-4 h-4 mr-1" />用此图生成视频
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { navigate(`/images?mode=image_to_image&reference_asset_id=${previewAsset.id}`); setPreviewAsset(null); }}>
                      <ImageIcon className="w-4 h-4 mr-1" />用于图生图
                    </Button>
                  </>
                )}
              </div>
              {previewAsset.prompt && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  <span className="font-medium">提示词：</span>{previewAsset.prompt}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
