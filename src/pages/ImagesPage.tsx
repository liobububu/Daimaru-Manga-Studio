import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import ModelSelector from '@/components/common/ModelSelector';
import AssetPickerDialog from '@/components/common/AssetPickerDialog';
import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Image, Sparkles, Download, Copy, Star, StarOff, Trash2, X, ZoomIn, ZoomOut, Maximize, Video, Plus, LibraryBig, RefreshCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { db } from '@/db/client';
import { createAsset, getAssets, deleteAsset, updateAsset, updateStoryboard, getStoryboards } from '@/services/api';
import type { Asset, Storyboard } from '@/types/types';
import { creativeAssetSuggestions, insertCreativeAssetToken, resolveCreativeAssetRefs } from '@/lib/creativeAssetRefs';
import { ASPECT_RATIO_OPTIONS } from '@/types/types';
import { mediaWorkKey } from '../../shared/episode-flow.js';

const IMAGE_STYLES = ['写实', '动漫', '水彩', '油画', '扁平插画', '赛博朋克', '国风', '像素'];
const IMAGE_SIZES = ['512x512', '768x768', '1024x1024', '1024x768', '768x1024', '1280x720'];

type ImageBatchStatus = 'idle' | 'running' | 'paused' | 'completed';
type ImageBatchItemState = 'pending' | 'running' | 'completed' | 'failed';
type ImageBatchSnapshot = {
  projectId: string;
  scriptId: string;
  queueIds: string[];
  status: ImageBatchStatus;
  items: Record<string, { state: ImageBatchItemState; error?: string }>;
  params: { modelId: string; apiConfigId: string; negativePrompt: string; size: string; count: number; style: string; mode: string };
  updatedAt: string;
};

const IMAGE_BATCH_STORAGE_PREFIX = 'daimaru:image-batch:v1:';
function imageBatchStorageKey(projectId: string, scriptId: string) { return `${IMAGE_BATCH_STORAGE_PREFIX}${projectId}:${scriptId}`; }


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
  const [storyboardBoundAssetId, setStoryboardBoundAssetId] = useState<string | null>(null);
  const autoAdvanceQueue = true;
  const [batchSnapshot, setBatchSnapshot] = useState<ImageBatchSnapshot | null>(null);
  const batchStopRef = useRef(false);
  const batchRunningRef = useRef(false);

  // 生成结果（本次生成的图片 URL）
  const [generatedImages, setGeneratedImages] = useState<Array<{ url: string; assetId?: string }>>([]);

  // Preview
  const [preview, setPreview] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const routeState = location.state as { storyboard?: Storyboard; storyboardQueue?: string[] } | null;
  const passedStoryboard = routeState?.storyboard;
  const storyboardQueue = routeState?.storyboardQueue || [];
  const mediaContextRef = useRef('');
  mediaContextRef.current = mediaWorkKey(selectedProjectId || undefined, passedStoryboard?.id, storyboardQueue);
  const [queuedStoryboards, setQueuedStoryboards] = useState<Storyboard[]>([]);
  const queueIndex = passedStoryboard ? queuedStoryboards.findIndex(s => s.id === passedStoryboard.id) : -1;
  const scopedStoryboardIds = queuedStoryboards.length ? queuedStoryboards.map(item => item.id) : passedStoryboard ? [passedStoryboard.id] : undefined;
  const scopedAssets = scopedStoryboardIds
    ? assets.filter(asset => !asset.storyboard_id || scopedStoryboardIds.includes(asset.storyboard_id))
    : assets;
  const batchDone = batchSnapshot ? Object.values(batchSnapshot.items).filter(item => item.state === 'completed').length : 0;
  const batchFailed = batchSnapshot ? Object.values(batchSnapshot.items).filter(item => item.state === 'failed').length : 0;
  const batchTotal = batchSnapshot?.queueIds.length || 0;
  const batchRunning = batchSnapshot?.status === 'running';

  const persistBatch = useCallback((snapshot: ImageBatchSnapshot | null) => {
    setBatchSnapshot(snapshot);
    if (!snapshot) return;
    localStorage.setItem(imageBatchStorageKey(snapshot.projectId, snapshot.scriptId), JSON.stringify(snapshot));
  }, []);


  // 读取 URL 参数预填入（来自素材库 / 分镜）
  useEffect(() => {
    const urlMode = searchParams.get('mode');
    const refAssetId = searchParams.get('reference_asset_id');
    if (urlMode === 'image_to_image' || urlMode === 'image2image') setGenMode('image2image');
    if (refAssetId) {
      // 查询素材详情后填入
      (async () => {
        const { data } = await db.from('assets').select('*').eq('id', refAssetId).single();
        if (data) setRefImage({ assetId: data.id, url: data.file_url || data.thumbnail_url || '', name: data.name });
      })();
    }
  }, [searchParams]);

  useEffect(() => {
    if (passedStoryboard?.image_prompt) setPrompt(passedStoryboard.image_prompt);
    setStoryboardBoundAssetId(passedStoryboard?.image_asset_id || null);
    setGeneratedImages([]);
    if (passedStoryboard?.image_asset_id) {
      const requestKey = mediaWorkKey(selectedProjectId || undefined, passedStoryboard.id, storyboardQueue);
      (async () => {
        const { data } = await db.from('assets').select('*').eq('id', passedStoryboard.image_asset_id).single();
        const url = data?.file_url || data?.thumbnail_url || '';
        if (mediaContextRef.current === requestKey && data && url) setGeneratedImages([{ url, assetId: data.id }]);
      })();
    }
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

  useEffect(() => {
    if (!selectedProjectId || !passedStoryboard?.script_id) { setBatchSnapshot(null); return; }
    const key = imageBatchStorageKey(selectedProjectId, passedStoryboard.script_id);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) { setBatchSnapshot(null); return; }
      const restored = JSON.parse(raw) as ImageBatchSnapshot;
      if (restored.projectId !== selectedProjectId || restored.scriptId !== passedStoryboard.script_id) return;
      // 页面离开时同步请求无法继续；恢复为暂停态，避免重新进入后静默重复扣费。
      const items = Object.fromEntries(Object.entries(restored.items).map(([id, item]) => [id, item.state === 'running' ? { ...item, state: 'pending' as const } : item]));
      const safe = { ...restored, status: restored.status === 'running' ? 'paused' as const : restored.status, items };
      setBatchSnapshot(safe);
      localStorage.setItem(key, JSON.stringify(safe));
    } catch { setBatchSnapshot(null); }
  }, [selectedProjectId, passedStoryboard?.script_id]);

  useEffect(() => () => { batchStopRef.current = true; }, []);

  useEffect(() => {
    if (!selectedProjectId || storyboardQueue.length === 0) { setQueuedStoryboards([]); return; }
    const requestKey = mediaWorkKey(selectedProjectId, passedStoryboard?.id, storyboardQueue);
    getStoryboards(selectedProjectId).then(items => {
      if (mediaContextRef.current !== requestKey) return;
      const byId = new Map(items.map(item => [item.id, item]));
      const scoped = storyboardQueue.map(id => byId.get(id)).filter((item): item is Storyboard => !!item);
      const scriptId = passedStoryboard?.script_id;
      setQueuedStoryboards(scriptId ? scoped.filter(item => item.script_id === scriptId) : scoped);
    }).catch(() => { if (mediaContextRef.current === requestKey) setQueuedStoryboards([]); });
  }, [selectedProjectId, storyboardQueue.join('|')]);

  function goToQueuedStoryboard(offset: number) {
    const target = queuedStoryboards[queueIndex + offset];
    if (!target) return;
    navigate('/images', { state: { storyboard: target, storyboardQueue } });
  }

  async function generateImageForStoryboard(shot: Storyboard, snapshot: ImageBatchSnapshot) {
    const shotPrompt = String(shot.image_prompt || '').trim();
    if (!shotPrompt) throw new Error(`第 ${shot.shot_index} 镜缺少图片提示词`);
    const creativeRefs = resolveCreativeAssetRefs(shotPrompt, assets.filter(asset => !asset.storyboard_id || asset.storyboard_id === shot.id));
    const creativeImages = creativeRefs.filter(ref => ref.asset.file_url || ref.asset.thumbnail_url).map(ref => ({ url: ref.asset.file_url || ref.asset.thumbnail_url || '', assetId: ref.asset.id }));
    const body: Record<string, unknown> = {
      apiConfigId: snapshot.params.apiConfigId, modelId: snapshot.params.modelId, prompt: shotPrompt,
      negativePrompt: snapshot.params.negativePrompt, size: snapshot.params.size, count: snapshot.params.count,
      style: snapshot.params.style, mode: snapshot.params.mode,
    };
    if (creativeImages.length) {
      body.referenceImageUrls = creativeImages.map(item => item.url);
      body.referenceAssetIds = creativeImages.map(item => item.assetId).filter(Boolean);
    } else if (snapshot.params.mode === 'image2image') {
      if (!refImage?.url) throw new Error('批量图生图需要当前参考图片');
      body.referenceImageUrl = refImage.url; body.referenceImageAssetId = refImage.assetId;
    } else if (snapshot.params.mode === 'multi_reference') {
      if (!refImages.length) throw new Error('批量多图参考需要至少一张参考图片');
      body.referenceImages = refImages.map(r => ({ url: r.url, assetId: r.assetId }));
    }
    const { data, error } = await db.functions.invoke('ai-generate-image', { body });
    if (error) { const msg = await error?.context?.text?.(); throw new Error(msg || error.message); }
    const images = data?.images as string[] || [];
    if (!images.length) throw new Error('未收到图片数据');
    let firstAssetId = '';
    for (const imgUrl of images) {
      const asset = await createAsset({ project_id: snapshot.projectId, storyboard_id: shot.id, asset_type: 'image', name: `图片_${Date.now()}`, file_url: imgUrl, thumbnail_url: imgUrl, prompt: shotPrompt, source_module: 'image_generation', favorite: false });
      if (!firstAssetId) firstAssetId = asset.id;
    }
    if (!firstAssetId) throw new Error('图片保存失败');
    await updateStoryboard(shot.id, { image_asset_id: firstAssetId });
    return firstAssetId;
  }

  async function runImageBatch(seed: ImageBatchSnapshot, onlyFailed = false) {
    if (batchRunningRef.current) return;
    batchRunningRef.current = true; batchStopRef.current = false;
    let current: ImageBatchSnapshot = { ...seed, status: 'running', items: { ...seed.items }, updatedAt: new Date().toISOString() };
    persistBatch(current);
    try {
      const all = await getStoryboards(seed.projectId);
      const byId = new Map(all.filter(item => item.script_id === seed.scriptId).map(item => [item.id, item]));
      for (const id of seed.queueIds) {
        if (batchStopRef.current) break;
        const original = current.items[id];
        if (!original || original.state === 'completed') continue;
        if (onlyFailed && original.state !== 'failed') continue;
        const shot = byId.get(id);
        if (!shot) {
          current = { ...current, items: { ...current.items, [id]: { state: 'failed', error: '分镜已不存在' } }, updatedAt: new Date().toISOString() }; persistBatch(current); continue;
        }
        // 离开后恢复时以数据库绑定为准，已经成功的镜头不重复生成。
        if (shot.image_asset_id) {
          current = { ...current, items: { ...current.items, [id]: { state: 'completed' } }, updatedAt: new Date().toISOString() }; persistBatch(current); continue;
        }
        current = { ...current, items: { ...current.items, [id]: { state: 'running' } }, updatedAt: new Date().toISOString() }; persistBatch(current);
        try {
          await generateImageForStoryboard(shot, current);
          current = { ...current, items: { ...current.items, [id]: { state: 'completed' } }, updatedAt: new Date().toISOString() };
        } catch (e) {
          current = { ...current, items: { ...current.items, [id]: { state: 'failed', error: e instanceof Error ? e.message : '未知错误' } }, updatedAt: new Date().toISOString() };
        }
        persistBatch(current);
      }
      const stopped = batchStopRef.current;
      const remaining = Object.values(current.items).some(item => item.state === 'pending' || item.state === 'running');
      current = { ...current, status: stopped || remaining ? 'paused' : 'completed', updatedAt: new Date().toISOString() };
      persistBatch(current);
      await loadAssets();
      if (stopped) toast.info('已停止后续图片任务；已完成结果已保留');
      else toast.success(`整集图片队列完成：成功 ${Object.values(current.items).filter(i => i.state === 'completed').length}，失败 ${Object.values(current.items).filter(i => i.state === 'failed').length}`);
    } finally { batchRunningRef.current = false; }
  }

  async function handleStartBatch() {
    if (!selectedProjectId || !passedStoryboard?.script_id) { toast.error('请从具体分集的图片待办队列进入'); return; }
    if (!modelId || !apiConfigId) { toast.error('请先选择图片生成模型'); return; }
    const all = await getStoryboards(selectedProjectId);
    const episode = all.filter(item => item.script_id === passedStoryboard.script_id).sort((a, b) => a.shot_index - b.shot_index);
    const queue = episode.filter(item => !item.image_asset_id);
    if (!queue.length) { toast.info('本集没有待生成图片的分镜'); return; }
    const snapshot: ImageBatchSnapshot = { projectId: selectedProjectId, scriptId: passedStoryboard.script_id, queueIds: queue.map(item => item.id), status: 'idle', items: Object.fromEntries(queue.map(item => [item.id, { state: 'pending' as const }])), params: { modelId, apiConfigId, negativePrompt, size, count: imgCount, style: imgStyle, mode: genMode }, updatedAt: new Date().toISOString() };
    await runImageBatch(snapshot);
  }

  function handleStopBatch() { batchStopRef.current = true; }
  function handleResumeBatch() { if (batchSnapshot) void runImageBatch(batchSnapshot); }
  function handleRetryFailedBatch() { if (batchSnapshot) void runImageBatch(batchSnapshot, true); }

  async function handleGenerate() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!modelId) { toast.error('请先选择图片生成模型'); return; }
    if (!prompt.trim()) { toast.error('请填写提示词'); return; }
    if (genMode === 'image2image' && !refImage?.url) { toast.error('图生图模式请先选择或上传参考图片'); return; }
    if (genMode === 'multi_reference' && refImages.length < 1) { toast.error('多图参考模式请至少添加一张参考图片'); return; }

    const creativeRefs = resolveCreativeAssetRefs(prompt, scopedAssets);
    const creativeImages: ImageValue[] = creativeRefs
      .filter(ref => ref.asset.file_url || ref.asset.thumbnail_url)
      .map(ref => ({ url: ref.asset.file_url || ref.asset.thumbnail_url || '', assetId: ref.asset.id, name: ref.asset.name }));
    setGenerating(true);
    setGeneratedImages([]);
    const generationKey = mediaContextRef.current;
    try {
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
      if (creativeImages.length) {
        body.referenceImageUrls = [...creativeImages, ...refImages].map(item => item.url);
        body.referenceAssetIds = [...creativeImages, ...refImages].map(item => item.assetId).filter(Boolean);
      } else if (genMode === 'image2image') {
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

      if (mediaContextRef.current === generationKey) setGeneratedImages(generated);
      if (passedStoryboard?.id && generated[0]?.assetId) {
        await updateStoryboard(passedStoryboard.id, { image_asset_id: generated[0].assetId });
        if (mediaContextRef.current === generationKey) setStoryboardBoundAssetId(generated[0].assetId);
        toast.success('首张生成图已绑定到对应分镜');
      }
      toast.success(`成功生成 ${images.length} 张图片`);
      if (mediaContextRef.current === generationKey && autoAdvanceQueue && queueIndex >= 0 && queueIndex < queuedStoryboards.length - 1) {
        const next = queuedStoryboards[queueIndex + 1];
        toast.success(`镜${passedStoryboard?.shot_index}完成，继续镜${next.shot_index}`);
        navigate('/images', { state: { storyboard: next, storyboardQueue }, replace: true });
      }
    } catch (e) {
      toast.error(`生成失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      if (mediaContextRef.current === generationKey) setGenerating(false);
    }
  }

  async function handleSaveToLibrary(imgUrl: string) {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    try {
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
      if (passedStoryboard?.id) {
        await updateStoryboard(passedStoryboard.id, { image_asset_id: asset.id });
        setStoryboardBoundAssetId(asset.id);
      }
      await loadAssets();
      toast.success('已保存到素材库');
    } catch { toast.error('保存失败'); }
  }

  function handleGoToVideo(_imgUrl: string, assetId?: string) {
    if (assetId) {
      if (passedStoryboard) {
        navigate(`/videos?mode=image_to_video&reference_asset_id=${assetId}&project_id=${selectedProjectId || ''}`, {
          state: { storyboard: { ...passedStoryboard, image_asset_id: assetId }, storyboardQueue },
        });
      } else {
        navigate(`/videos?mode=image_to_video&reference_asset_id=${assetId}&project_id=${selectedProjectId || ''}`);
      }
    } else {
      // 没有 assetId 时先提示
      toast.info('请先将图片保存到素材库，再进入视频生成');
    }
  }

  async function handleBindToStoryboard(assetId: string) {
    if (!passedStoryboard?.id) return;
    try {
      await updateStoryboard(passedStoryboard.id, { image_asset_id: assetId });
      setStoryboardBoundAssetId(assetId);
      toast.success('已设为该分镜的主图');
    } catch { toast.error('绑定分镜失败'); }
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Image className="w-5 h-5 text-green-400" />图片生成
          </h1>
          {queuedStoryboards.length > 0 && queueIndex >= 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-xs text-muted-foreground">批量队列 {queueIndex + 1} / {queuedStoryboards.length} · 第 {passedStoryboard?.shot_index} 镜</span>
              <Button size="sm" variant="ghost" disabled={queueIndex <= 0 || generating} onClick={() => goToQueuedStoryboard(-1)}>上一镜</Button>
              <Button size="sm" variant="secondary" disabled={queueIndex >= queuedStoryboards.length - 1 || generating} onClick={() => goToQueuedStoryboard(1)}>下一镜</Button>
            </div>
          )}
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
                  storyboardIds={queuedStoryboards.length ? queuedStoryboards.map(item => item.id) : passedStoryboard ? [passedStoryboard.id] : undefined}
                  title="选择参考图片（多选）"
                />
              </div>
            )}

            <div><Label>提示词 *</Label>
              <Textarea className="mt-1" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder={passedStoryboard ? `从分镜导入：${passedStoryboard.image_prompt}` : '描述要生成的画面内容，支持中英文...'} />
              {creativeAssetSuggestions(prompt, scopedAssets).length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1 rounded border border-border p-1.5">
                  {creativeAssetSuggestions(prompt, scopedAssets).map(asset => (
                    <button key={asset.id} type="button" className="text-xs px-2 py-1 rounded bg-muted hover:bg-accent"
                      onClick={() => setPrompt(value => insertCreativeAssetToken(value, asset.name))}>
                      @{asset.name}
                    </button>
                  ))}
                </div>
              )}
              {resolveCreativeAssetRefs(prompt, scopedAssets).length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1">
                  {resolveCreativeAssetRefs(prompt, scopedAssets).map(ref => <Badge key={ref.asset.id} variant="secondary">@{ref.asset.name} · {ref.category === 'character' ? '角色' : ref.category === 'scene' ? '场景' : '道具'}</Badge>)}
                </div>
              )}
            </div>
            <div><Label>负面提示词（可选）</Label>
              <Textarea className="mt-1" rows={2} value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} placeholder="不希望出现的内容..." />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={saveToLibrary} onCheckedChange={setSaveToLibrary} id="save-lib" />
                <Label htmlFor="save-lib">自动保存到素材库</Label>
              </div>
              <div className="flex items-center gap-2 mr-auto">
                <Button variant="outline" onClick={handleStartBatch} disabled={generating || batchRunning || !passedStoryboard?.script_id}>
                  <Sparkles className="w-4 h-4 mr-2" />一键生成本集待办
                </Button>
                {batchRunning && <Button variant="outline" onClick={handleStopBatch}><Square className="w-3.5 h-3.5 mr-1.5" />停止后续</Button>}
                {!batchRunning && batchSnapshot?.status === 'paused' && <Button variant="outline" onClick={handleResumeBatch}>继续队列</Button>}
                {!batchRunning && batchFailed > 0 && <Button variant="outline" onClick={handleRetryFailedBatch}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />重试失败 {batchFailed}</Button>}
              </div>
              <Button onClick={handleGenerate} disabled={generating || batchRunning}>
                <Sparkles className="w-4 h-4 mr-2" />{generating ? '生成中…' : '生成当前镜'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 本次生成结果 */}
        {batchSnapshot && batchTotal > 0 && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>本集图片队列 · {batchSnapshot.status === 'running' ? '生成中' : batchSnapshot.status === 'paused' ? '已暂停，可恢复' : batchSnapshot.status === 'completed' ? '已完成' : '待开始'}</span>
                <span className="text-muted-foreground">完成 {batchDone}/{batchTotal} · 失败 {batchFailed}</span>
              </div>
              <Progress value={batchTotal ? Math.round(batchDone / batchTotal * 100) : 0} className="h-1.5" />
              {batchFailed > 0 && <div className="space-y-1">{batchSnapshot.queueIds.filter(id => batchSnapshot.items[id]?.state === 'failed').slice(0, 5).map(id => {
                const shot = queuedStoryboards.find(item => item.id === id);
                return <p key={id} className="text-xs text-destructive">镜{shot?.shot_index ?? '?'}：{batchSnapshot.items[id]?.error || '生成失败'}</p>;
              })}</div>}
            </CardContent>
          </Card>
        )}

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
                    {passedStoryboard?.id && img.assetId && (
                      <button
                        className="w-full py-1 rounded bg-black/40 hover:bg-black/70 text-white text-xs"
                        onClick={() => handleBindToStoryboard(img.assetId!)}
                      >
                        {storyboardBoundAssetId === img.assetId ? '✓ 当前分镜主图' : '设为分镜主图'}
                      </button>
                    )}
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
                  {img.assetId && storyboardBoundAssetId === img.assetId && (
                    <Badge className="absolute top-1 right-1 text-xs bg-primary/90 text-primary-foreground border-0">分镜主图</Badge>
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

