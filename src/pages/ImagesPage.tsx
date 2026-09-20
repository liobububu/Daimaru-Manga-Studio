import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import ModelSelector from '@/components/common/ModelSelector';
import AssetPickerDialog from '@/components/common/AssetPickerDialog';
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import ImageInputField, { type ImageValue } from '@/components/common/ImageInputField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Image, Sparkles, Download, Copy, Star, StarOff, Trash2, X, ZoomIn, ZoomOut, Maximize, Video, Plus, LibraryBig } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { createAsset, getAssets, deleteAsset, updateAsset } from '@/services/api';
import type { Asset, Storyboard } from '@/types/types';
import { ASPECT_RATIO_OPTIONS } from '@/types/types';

const IMAGE_STYLES = ['写实', '动漫', '水彩', '油画', '扁平插画', '赛博朋克', '国风', '像素'];
const IMAGE_SIZES = ['512x512', '768x768', '1024x1024', '1024x768', '768x1024', '1280x720'];

const GEN_MODES = [
  { value: 'text2image', label: '文生图' },
  { value: 'image2image', label: '图生图' },
  { value: 'multi_reference', label: '多图参考' },
];

export default function ImagesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedProjectId } = useProject();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // 生成模式
  const [genMode, setGenMode] = useState<string>('text2image');

  // 单图参考（图生图）
  const [refImage, setRefImage] = useState<ImageValue | null>(null);

  // 多图参考列表
  const [refImages, setRefImages] = useState<ImageValue[]>([]);
  const [multiPickerOpen, setMultiPickerOpen] = useState(false);

  // Form
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [size, setSize] = useState('1024x1024');
  const [imgCount, setImgCount] = useState(2);
  const [imgStyle, setImgStyle] = useState('动漫');
  const [modelId, setModelId] = useState('');
  const [apiConfigId, setApiConfigId] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(true);

  // 生成结果（本次生成的图片 URL）
  const [generatedImages, setGeneratedImages] = useState<Array<{ url: string; assetId?: string }>>([]);

  // Preview
  const [preview, setPreview] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const passedStoryboard = (location.state as { storyboard?: Storyboard })?.storyboard;

  // 读取 URL 参数预填入（来自素材库 / 分镜）
  useEffect(() => {
    const urlMode = searchParams.get('mode');
    const refAssetId = searchParams.get('reference_asset_id');
    if (urlMode === 'image_to_image' || urlMode === 'image2image') setGenMode('image2image');
    if (refAssetId) {
      // 查询素材详情后填入
      (async () => {
        const { db } = await import('@/db/client');
        const { data } = await db.from('assets').select('*').eq('id', refAssetId).single();
        if (data) setRefImage({ assetId: data.id, url: data.file_url || data.thumbnail_url || '', name: data.name });
      })();
    }
  }, [searchParams]);

  useEffect(() => {
    if (passedStoryboard?.image_prompt) setPrompt(passedStoryboard.image_prompt);
  }, [passedStoryboard]);

  const loadAssets = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await getAssets(selectedProjectId, 'image');
      setAssets(data);
    } catch { }
    finally { setLoading(false); }
  }, [selectedProjectId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  async function handleGenerate() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!modelId) { toast.error('请先选择图片生成模型'); return; }
    if (!prompt.trim()) { toast.error('请填写提示词'); return; }
    if (genMode === 'image2image' && !refImage?.url) { toast.error('图生图模式请先选择或上传参考图片'); return; }
    if (genMode === 'multi_reference' && refImages.length < 1) { toast.error('多图参考模式请至少添加一张参考图片'); return; }

    setGenerating(true);
    setGeneratedImages([]);
    try {
      const { db } = await import('@/db/client');
      const body: Record<string, unknown> = {
        apiConfigId,
        modelId,
        prompt,
        negativePrompt,
        size,
        count: imgCount,
        style: imgStyle,
        mode: genMode,
      };
      if (genMode === 'image2image') {
        body.referenceImageUrl = refImage?.url;
        body.referenceImageAssetId = refImage?.assetId;
      } else if (genMode === 'multi_reference') {
        body.referenceImages = refImages.map(r => ({ url: r.url, assetId: r.assetId }));
      }

      const { data, error } = await db.functions.invoke('ai-generate-image', { body });

      if (error) {
        const msg = await error?.context?.text?.();
        throw new Error(msg || error.message);
      }

      const images = data?.images as string[] || [];
      if (images.length === 0) throw new Error('未收到图片数据');

      const generated: Array<{ url: string; assetId?: string }> = [];

      if (saveToLibrary && selectedProjectId) {
        for (const imgUrl of images) {
          const asset = await createAsset({
            project_id: selectedProjectId,
            storyboard_id: passedStoryboard?.id,
            asset_type: 'image',
            name: `图片_${Date.now()}`,
            file_url: imgUrl,
            thumbnail_url: imgUrl,
            prompt,
            source_module: 'image_generation',
            favorite: false,
          });
          generated.push({ url: imgUrl, assetId: asset.id });
        }
        await loadAssets();
      } else {
        for (const imgUrl of images) generated.push({ url: imgUrl });
      }

      setGeneratedImages(generated);
      toast.success(`成功生成 ${images.length} 张图片`);
    } catch (e) {
      toast.error(`生成失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveToLibrary(imgUrl: string) {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    try {
      await createAsset({
        project_id: selectedProjectId,
        asset_type: 'image',
        name: `图片_${Date.now()}`,
        file_url: imgUrl,
        thumbnail_url: imgUrl,
        prompt,
        source_module: 'image_generation',
        favorite: false,
      });
      await loadAssets();
      toast.success('已保存到素材库');
    } catch { toast.error('保存失败'); }
  }

  function handleGoToVideo(_imgUrl: string, assetId?: string) {
    if (assetId) {
      navigate(`/videos?mode=image_to_video&reference_asset_id=${assetId}&project_id=${selectedProjectId || ''}`);
    } else {
      // 没有 assetId 时先提示
      toast.info('请先将图片保存到素材库，再进入视频生成');
    }
  }

  async function handleDelete(id: string) {
    await deleteAsset(id);
    setAssets(prev => prev.filter(a => a.id !== id));
    toast.success('已删除');
  }

  async function handleFavorite(a: Asset) {
    await updateAsset(a.id, { favorite: !a.favorite });
    setAssets(prev => prev.map(x => x.id === a.id ? {...x, favorite: !x.favorite} : x));
  }

  function handleCopyPrompt(a: Asset) {
    if (a.prompt) { navigator.clipboard.writeText(a.prompt); toast.success('已复制提示词'); }
  }

  function handleDownload(url: string) {
    const a = document.createElement('a');
    a.href = url; a.download = `image_${Date.now()}.jpg`;
    a.target = '_blank'; a.click();
  }

  // 多图参考：从素材库多选后追加
  function handleMultiLibrarySelect(picked: Asset[]) {
    const newItems = picked.map(a => ({
      assetId: a.id,
      url: a.file_url || a.thumbnail_url || '',
      name: a.name,
    }));
    setRefImages(prev => [...prev, ...newItems]);
  }

  function removeRefImage(idx: number) {
    setRefImages(prev => prev.filter((_, i) => i !== idx));
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Image className="w-5 h-5 text-green-400" />图片生成
          </h1>
        </div>

        {/* 参数面板 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">生成参数</h2></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><Label>所属项目</Label><ProjectSelector className="mt-1 w-full" /></div>
              <div><Label>使用模型</Label>
                <ModelSelector requiredCapability="image_generation" value={modelId} onChange={(mid, acid) => { setModelId(mid); setApiConfigId(acid); }} className="mt-1 w-full" placeholder="选择图片生成模型" />
              </div>
              {/* 生成模式 */}
              <div><Label>生成模式</Label>
                <Select value={genMode} onValueChange={v => { setGenMode(v); setRefImage(null); setRefImages([]); }}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{GEN_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>图片风格</Label>
                <Select value={imgStyle} onValueChange={setImgStyle}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{IMAGE_STYLES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>图片比例</Label>
                <Select value={ratio} onValueChange={setRatio}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASPECT_RATIO_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>图片尺寸</Label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{IMAGE_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>生成数量</Label>
                <Input type="number" className="mt-1" min={1} max={8} value={imgCount} onChange={e => setImgCount(Number(e.target.value))} />
              </div>
            </div>

            {/* 图生图 — 单张参考图 */}
            {genMode === 'image2image' && (
              <ImageInputField
                label="参考图片 *"
                value={refImage}
                onChange={setRefImage}
                projectId={selectedProjectId || undefined}
                required
              />
            )}

            {/* 多图参考 */}
            {genMode === 'multi_reference' && (
              <div className="space-y-2">
                <Label>参考图片列表（多张）</Label>
                <div className="flex flex-wrap gap-3">
                  {refImages.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img.url} alt={img.name || `参考图${idx+1}`} className="h-20 w-20 object-cover rounded-lg border border-border" />
                      <button type="button" onClick={() => removeRefImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </button>
                      <p className="text-xs text-muted-foreground text-center mt-0.5 w-20 truncate">{idx + 1}</p>
                    </div>
                  ))}
                  {/* 添加按钮 */}
                  <div className="flex flex-col gap-1.5">
                    <button type="button" onClick={() => setMultiPickerOpen(true)}
                      className="h-20 w-20 rounded-lg border-2 border-dashed border-border/60 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors">
                      <Plus className="w-5 h-5" />
                      <span className="text-xs mt-0.5">素材库</span>
                    </button>
                  </div>
                </div>
                <AssetPickerDialog
                  open={multiPickerOpen}
                  onOpenChange={setMultiPickerOpen}
                  onSelect={handleMultiLibrarySelect}
                  multiple
                  assetType="image"
                  projectId={selectedProjectId || undefined}
                  title="选择参考图片（多选）"
                />
              </div>
            )}

            <div><Label>提示词 *</Label>
              <Textarea className="mt-1" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder={passedStoryboard ? `从分镜导入：${passedStoryboard.image_prompt}` : '描述要生成的画面内容，支持中英文...'} />
            </div>
            <div><Label>负面提示词（可选）</Label>
              <Textarea className="mt-1" rows={2} value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} placeholder="不希望出现的内容..." />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={saveToLibrary} onCheckedChange={setSaveToLibrary} id="save-lib" />
                <Label htmlFor="save-lib">自动保存到素材库</Label>
              </div>
              <Button onClick={handleGenerate} disabled={generating}>
                <Sparkles className="w-4 h-4 mr-2" />{generating ? '生成中…' : '生成图片'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 本次生成结果 */}
        {generatedImages.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3">本次生成结果（{generatedImages.length} 张）</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {generatedImages.map((img, idx) => (
                <div key={idx} className="group relative rounded-lg overflow-hidden border border-border bg-muted aspect-square">
                  <img src={img.url} alt={`生成结果${idx+1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1">
                    {/* 核心操作：用此图生成视频 */}
                    <button
                      className="w-full py-1.5 rounded bg-primary/90 hover:bg-primary text-primary-foreground text-xs flex items-center justify-center gap-1 font-medium"
                      onClick={() => handleGoToVideo(img.url, img.assetId)}
                    >
                      <Video className="w-3 h-3" />用此图生成视频
                    </button>
                    <div className="flex gap-1">
                      <button className="flex-1 py-1 rounded bg-black/40 hover:bg-black/70 text-white text-xs flex items-center justify-center gap-1"
                        onClick={() => { setPreview(img.url); setZoom(1); }}>
                        <ZoomIn className="w-3 h-3" />预览
                      </button>
                      <button className="flex-1 py-1 rounded bg-black/40 hover:bg-black/70 text-white text-xs flex items-center justify-center gap-1"
                        onClick={() => handleDownload(img.url)}>
                        <Download className="w-3 h-3" />下载
                      </button>
                      {!img.assetId && (
                        <button className="flex-1 py-1 rounded bg-black/40 hover:bg-black/70 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => handleSaveToLibrary(img.url)}>
                          <LibraryBig className="w-3 h-3" />保存
                        </button>
                      )}
                    </div>
                  </div>
                  {img.assetId && (
                    <Badge className="absolute top-1 left-1 text-xs bg-green-600/80 text-white border-0">已存库</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 素材库图片网格 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{assets.length} 张图片（素材库）</h2>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <Skeleton key={i} className="aspect-square rounded-lg" />)}
            </div>
          ) : assets.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Image className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>还没有图片，填写参数后点击生成</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {assets.map(a => (
                <div key={a.id} className="group relative rounded-lg overflow-hidden border border-border bg-muted aspect-square">
                  {a.thumbnail_url ? (
                    <img src={a.thumbnail_url} alt={a.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Image className="w-8 h-8" />
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                    <div className="flex justify-end gap-1">
                      <button className="p-1 rounded bg-black/40 hover:bg-black/70 text-white" onClick={() => handleFavorite(a)}>
                        {a.favorite ? <Star className="w-3 h-3 text-yellow-400" fill="currentColor" /> : <StarOff className="w-3 h-3" />}
                      </button>
                      <button className="p-1 rounded bg-black/40 hover:bg-black/70 text-white" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      {/* 用此图生成视频 */}
                      <button className="w-full py-1 rounded bg-primary/90 hover:bg-primary text-primary-foreground text-xs flex items-center justify-center gap-1 font-medium"
                        onClick={() => navigate(`/videos?mode=image_to_video&reference_asset_id=${a.id}`)}>
                        <Video className="w-3 h-3" />用此图生成视频
                      </button>
                      <div className="flex gap-1">
                        <button className="flex-1 py-1 rounded bg-black/40 hover:bg-black/70 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => { setPreview(a.file_url || a.thumbnail_url || null); setZoom(1); }}>
                          <ZoomIn className="w-3 h-3" />预览
                        </button>
                        <button className="flex-1 py-1 rounded bg-black/40 hover:bg-black/70 text-white text-xs flex items-center justify-center gap-1"
                          onClick={() => handleDownload(a.file_url || a.thumbnail_url || '')}>
                          <Download className="w-3 h-3" />下载
                        </button>
                        <button className="py-1 px-1.5 rounded bg-black/40 hover:bg-black/70 text-white"
                          onClick={() => handleCopyPrompt(a)}>
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 大图预览 */}
      <Dialog open={!!preview} onOpenChange={open => !open && setPreview(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-4xl bg-black/90 border-border p-0">
          <div className="relative">
            <div className="absolute top-3 right-3 z-10 flex gap-2">
              <button className="p-2 rounded bg-black/60 text-white hover:bg-black/80" onClick={() => setZoom(z => Math.min(z + 0.25, 3))}>
                <ZoomIn className="w-4 h-4" />
              </button>
              <button className="p-2 rounded bg-black/60 text-white hover:bg-black/80" onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}>
                <ZoomOut className="w-4 h-4" />
              </button>
              <button className="p-2 rounded bg-black/60 text-white hover:bg-black/80" onClick={() => setZoom(1)}>
                <Maximize className="w-4 h-4" />
              </button>
              <button className="p-2 rounded bg-black/60 text-white hover:bg-black/80" onClick={() => setPreview(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto max-h-[80vh] flex items-center justify-center p-4">
              {preview && (
                <img
                  src={preview}
                  alt="预览"
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.2s' }}
                  className="max-w-full rounded"
                />
              )}
            </div>
            <div className="flex justify-center gap-3 p-3 border-t border-border/30">
              <Button size="sm" variant="secondary" onClick={() => preview && handleDownload(preview)}>
                <Download className="w-4 h-4 mr-1" />下载
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { if (preview) { navigator.clipboard.writeText(preview); toast.success('已复制图片地址'); }}}>
                <Copy className="w-4 h-4 mr-1" />复制地址
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

