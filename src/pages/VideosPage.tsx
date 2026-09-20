import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import ModelSelector from '@/components/common/ModelSelector';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import MediaInput, { type MediaItem } from '@/components/common/MediaInput';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Video, Sparkles, RotateCcw, Download, Copy, Trash2, Play,
  Clock, ChevronDown, AlertCircle, CheckCircle2,
  Loader2, RefreshCw, LibraryBig, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { createVideoTask, getVideoTasks, updateVideoTask, createAsset } from '@/services/api';
import type { VideoTask, Storyboard, ModelCapability } from '@/types/types';
import { VIDEO_STATUS_LABELS } from '@/types/types';

// ── 轮询间隔与超时设置 ─────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 240;

// ── 视频比例 → 宽高预设 ────────────────────────────────────────────────────
const RATIO_PRESETS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1':  { width: 960,  height: 960 },
  '4:3':  { width: 960,  height: 720 },
  '3:4':  { width: 720,  height: 960 },
};
const RATIO_OPTIONS = Object.keys(RATIO_PRESETS);

// ── 模式分组定义 ──────────────────────────────────────────────────────────
interface VideoModeConfig {
  value: string;
  label: string;
  group: string;
  capability: ModelCapability;
  /** 该模式需要的素材类型 */
  needsImages?: boolean;
  needsVideos?: boolean;
  needsAudios?: boolean;
  /** 至少需要的数量 */
  minImages?: number;
  minVideos?: number;
  minAudios?: number;
  /** 图片 role（预设）*/
  imageRole?: string;
  /** 视频 role */
  videoRole?: string;
  /** 音频 role */
  audioRole?: string;
  showPrompt?: boolean;
  promptRequired?: boolean;
  showNegPrompt?: boolean;
  showMotionStrength?: boolean;
  showStyleStrength?: boolean;
  showAudioStrength?: boolean;
  showDriveType?: boolean;
  showPreserveOptions?: boolean;
  showRefStrength?: boolean;
  showStyleRef?: boolean;
}

const VIDEO_MODES: VideoModeConfig[] = [
  // 基础生成类
  { value: 'text2video',    label: '文生视频',      group: '基础生成', capability: 'text_to_video',               showPrompt: true, promptRequired: true, showNegPrompt: true },
  { value: 'image2video',   label: '图生视频',       group: '基础生成', capability: 'image_to_video',              showPrompt: true, needsImages: true, minImages: 1, imageRole: 'reference', showMotionStrength: true },
  { value: 'keyframes',     label: '首尾帧视频',     group: '基础生成', capability: 'first_last_frame_video',      showPrompt: true, needsImages: true, minImages: 2 },
  { value: 'multi_image',   label: '多图参考视频',   group: '基础生成', capability: 'multi_image_reference_video', showPrompt: true, needsImages: true, minImages: 2 },
  // 视频输入类
  { value: 'video_ref',     label: '视频参考生成',   group: '视频输入', capability: 'video_reference_generation',  showPrompt: true, needsVideos: true, minVideos: 1, videoRole: 'reference', showRefStrength: true },
  { value: 'video2video',   label: '视频转视频',     group: '视频输入', capability: 'video_to_video',              showPrompt: true, needsVideos: true, minVideos: 1, videoRole: 'source',    showPreserveOptions: true },
  { value: 'video_extend',  label: '视频续写',       group: '视频输入', capability: 'video_extend',                showPrompt: true, needsVideos: true, minVideos: 1, videoRole: 'continuation_source' },
  { value: 'video_repaint', label: '视频重绘',       group: '视频输入', capability: 'video_repaint',               showPrompt: true, needsVideos: true, minVideos: 1, videoRole: 'repaint_source', showMotionStrength: true },
  { value: 'video_style',   label: '视频风格迁移',   group: '视频输入', capability: 'video_style_transfer',        showPrompt: true, needsVideos: true, minVideos: 1, videoRole: 'source', showStyleStrength: true, showStyleRef: true },
  // 音频驱动类
  { value: 'audio_driven',  label: '音频驱动视频',   group: '音频驱动', capability: 'audio_driven_video',          showPrompt: true, needsImages: true, needsAudios: true, minAudios: 1, audioRole: 'driver', showDriveType: true, showAudioStrength: true },
  { value: 'lip_sync',      label: '口型同步',       group: '音频驱动', capability: 'lip_sync',                    needsImages: true, needsAudios: true, minAudios: 1, audioRole: 'lip_sync_audio' },
  { value: 'img_audio',     label: '图片+音频生视频', group: '音频驱动', capability: 'image_audio_to_video',        showPrompt: true, needsImages: true, minImages: 1, needsAudios: true, minAudios: 1, showDriveType: true },
  { value: 'vid_audio',     label: '视频+音频生视频', group: '音频驱动', capability: 'video_audio_to_video',        showPrompt: true, needsVideos: true, minVideos: 1, needsAudios: true, minAudios: 1, showAudioStrength: true },
  // 多模态综合类
  { value: 'multimodal',    label: '多模态参考生成', group: '多模态',   capability: 'multimodal_video_generation', showPrompt: true, promptRequired: true, needsImages: true, needsVideos: true, needsAudios: true },
  { value: 'char_ref',      label: '角色参考视频',   group: '多模态',   capability: 'character_reference_video',   showPrompt: true, needsImages: true, minImages: 1, imageRole: 'character_reference' },
  { value: 'motion_ref',    label: '运动参考视频',   group: '多模态',   capability: 'motion_reference_video',      showPrompt: true, needsVideos: true, minVideos: 1, videoRole: 'motion_reference', needsImages: true },
];

const MODE_MAP = Object.fromEntries(VIDEO_MODES.map(m => [m.value, m]));

const DRIVE_TYPES = [
  { value: 'lip_sync',            label: '口型驱动' },
  { value: 'expression',         label: '表情驱动' },
  { value: 'action_rhythm',      label: '动作节奏驱动' },
  { value: 'music_rhythm',       label: '音乐节奏驱动' },
  { value: 'narration_emotion',  label: '旁白情绪驱动' },
];

const statusColors: Record<string, string> = {
  pending:       'text-muted-foreground border-border',
  submitted:     'text-blue-400 border-blue-400/30',
  processing:    'text-yellow-400 border-yellow-400/30',
  fetching:      'text-yellow-400 border-yellow-400/30',
  completed:     'text-green-400 border-green-400/30',
  failed:        'text-red-400 border-red-400/30',
  expired:       'text-muted-foreground border-border',
  timeout:       'text-orange-400 border-orange-400/30',
  storage_failed:'text-red-400 border-red-400/30',
};

const isActiveStatus = (s: string) => ['submitted', 'processing', 'fetching'].includes(s);

// 按分组聚合模式列表
const MODE_GROUPS = VIDEO_MODES.reduce<Record<string, VideoModeConfig[]>>((acc, m) => {
  (acc[m.group] = acc[m.group] || []).push(m); return acc;
}, {});

export default function VideosPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { selectedProjectId } = useProject();
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewTask, setPreviewTask] = useState<VideoTask | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 工作台表单状态 ────────────────────────────────────────────────────────
  const [mode, setMode]           = useState('text2video');
  const [prompt, setPrompt]       = useState('');
  const [negPrompt, setNegPrompt] = useState('');
  const [ratio, setRatio]         = useState('9:16');
  const [width, setWidth]         = useState(720);
  const [height, setHeight]       = useState(1280);
  const [duration, setDuration]   = useState<number | ''>(5);
  const [fps, setFps]             = useState<number | ''>('');
  const [seed, setSeed]           = useState<number | ''>('');
  const [driveType, setDriveType] = useState('lip_sync');

  // 强度滑块
  const [motionStrength, setMotionStrength] = useState(0.8);
  const [styleStrength, setStyleStrength]   = useState(0.6);
  const [audioStrength, setAudioStrength]   = useState(0.8);
  const [refStrength, setRefStrength]       = useState(0.7);

  // 保留选项（视频转视频 / 重绘）
  const [preserveMotion, setPreserveMotion]   = useState(true);
  const [preserveStruct, setPreserveStruct]   = useState(true);
  const [preservePerson, setPreservePerson]   = useState(false);

  // 多模态素材
  const [images, setImages] = useState<MediaItem[]>([]);
  const [videos, setVideos] = useState<MediaItem[]>([]);
  const [audios, setAudios] = useState<MediaItem[]>([]);
  // 风格参考图（video_style 模式可选）
  const [styleRefImages, setStyleRefImages] = useState<MediaItem[]>([]);

  const [modelId, setModelId]         = useState('');
  const [apiConfigId, setApiConfigId] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [advancedOpen, setAdvancedOpen]   = useState(false);

  const passedStoryboard = (location.state as { storyboard?: Storyboard })?.storyboard;
  const modeConfig = MODE_MAP[mode] || VIDEO_MODES[0];

  // ── URL 参数预填入 ────────────────────────────────────────────────────────
  useEffect(() => {
    const urlMode     = searchParams.get('mode');
    const refAssetId  = searchParams.get('reference_asset_id');
    const audioAssetId = searchParams.get('audio_asset_id');
    const videoAssetId = searchParams.get('video_asset_id');
    const urlPrompt   = searchParams.get('prompt');

    // 模式映射
    const modeMap: Record<string, string> = {
      image_to_video: 'image2video', image2video: 'image2video',
      keyframes: 'keyframes', multi_image: 'multi_image',
      video_to_video: 'video2video', audio_driven_video: 'audio_driven',
      lip_sync: 'lip_sync', image_audio_to_video: 'img_audio',
      video_audio_to_video: 'vid_audio', multimodal: 'multimodal',
      character_reference_video: 'char_ref', motion_reference_video: 'motion_ref',
    };
    if (urlMode && modeMap[urlMode]) setMode(modeMap[urlMode]);
    if (urlPrompt) setPrompt(decodeURIComponent(urlPrompt));

    if (refAssetId) {
      (async () => {
        const { db } = await import('@/db/client');
        const { data } = await db.from('assets').select('*').eq('id', refAssetId).single();
        if (data) {
          const item: MediaItem = { id: `init_${refAssetId}`, asset_id: data.id, url: data.file_url || data.thumbnail_url || '', name: data.name, role: 'reference', weight: 1 };
          setImages([item]);
        }
      })();
    }
    if (audioAssetId) {
      (async () => {
        const { db } = await import('@/db/client');
        const { data } = await db.from('assets').select('*').eq('id', audioAssetId).single();
        if (data) {
          const item: MediaItem = { id: `init_${audioAssetId}`, asset_id: data.id, url: data.file_url || '', name: data.name, role: 'driver', weight: 1 };
          setAudios([item]);
        }
      })();
    }
    if (videoAssetId) {
      (async () => {
        const { db } = await import('@/db/client');
        const { data } = await db.from('assets').select('*').eq('id', videoAssetId).single();
        if (data) {
          const item: MediaItem = { id: `init_${videoAssetId}`, asset_id: data.id, url: data.file_url || '', name: data.name, role: 'source', weight: 1 };
          setVideos([item]);
        }
      })();
    }
  }, [searchParams]);

  // 分镜预填
  useEffect(() => {
    if (passedStoryboard?.video_prompt) setPrompt(passedStoryboard.video_prompt);
    if (passedStoryboard?.image_asset_id) {
      (async () => {
        const { db } = await import('@/db/client');
        const { data } = await db.from('assets').select('*').eq('id', passedStoryboard.image_asset_id).single();
        if (data) {
          const item: MediaItem = { id: `sb_${data.id}`, asset_id: data.id, url: data.file_url || data.thumbnail_url || '', name: data.name, role: 'reference', weight: 1 };
          setImages([item]);
          setMode('image2video');
        }
      })();
    }
  }, [passedStoryboard]);

  // 同步比例 → 宽高
  useEffect(() => {
    const preset = RATIO_PRESETS[ratio];
    if (preset) { setWidth(preset.width); setHeight(preset.height); }
  }, [ratio]);

  // 切换模式时重置素材
  useEffect(() => {
    setImages([]); setVideos([]); setAudios([]); setStyleRefImages([]);
  }, [mode]);

  // ── 加载任务 ──────────────────────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try { setTasks(await getVideoTasks(selectedProjectId)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [selectedProjectId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // ── 轮询 ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const active = tasks.filter(t => isActiveStatus(t.status));
    if (active.length > 0) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(async () => {
        const { db } = await import('@/db/client');
        for (const task of active) {
          try {
            const upstreamTaskId = task.upstream_video_id || task.upstream_task_id;
            if (!upstreamTaskId || !apiConfigId) continue;
            const { data } = await db.functions.invoke('check-video-task', {
              body: { taskId: task.id, upstreamTaskId, apiConfigId },
            });
            if (!data?.status) continue;
            const retryCount = (task.polling_retry_count || 0) + 1;
            const now = new Date().toISOString();
            const updates: Partial<VideoTask> = {
              status: data.status as VideoTask['status'],
              progress: typeof data.progress === 'number' ? data.progress : task.progress,
              polling_retry_count: retryCount,
              raw_poll_response: data.raw,
            };
            if (data.status === 'completed') {
              updates.video_url = data.videoUrl;
              updates.progress  = 100;
              updates.completed_at = now;
              if (saveToLibrary && data.videoUrl && selectedProjectId) {
                const asset = await createAsset({
                  project_id: selectedProjectId,
                  storyboard_id: task.storyboard_id,
                  asset_type: 'video',
                  name: `视频_${Date.now()}`,
                  file_url: data.videoUrl,
                  thumbnail_url: '',
                  prompt: task.prompt || '',
                  source_module: 'video_generation',
                  favorite: false,
                });
                if (asset) updates.result_asset_id = asset.id;
                toast.success('视频已生成并保存到素材库');
              } else if (data.videoUrl) {
                toast.success('视频生成完成');
              }
            } else if (data.status === 'failed') {
              updates.failed_at     = now;
              updates.error_message = data.errorMessage || '视频生成失败';
              toast.error(`视频生成失败: ${updates.error_message}`);
            } else if (retryCount >= MAX_POLL_COUNT) {
              updates.status = 'timeout';
              updates.timeout_at = now;
              toast.warning('视频任务超时，请重新生成');
            }
            await updateVideoTask(task.id, updates);
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updates } : t));
          } catch { /* 单个任务失败不影响其他 */ }
        }
      }, POLL_INTERVAL_MS);
    } else {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [tasks, apiConfigId, saveToLibrary, selectedProjectId]);

  // ── 提交校验 ──────────────────────────────────────────────────────────────
  function getSubmitError(): string | null {
    if (!selectedProjectId) return '请先选择项目';
    if (!modelId) return '请先选择视频模型';
    const cfg = modeConfig;
    if (cfg.promptRequired && !prompt.trim()) return '请填写视频提示词';
    if (cfg.needsImages && (cfg.minImages || 0) > 0 && images.length < (cfg.minImages || 0))
      return `当前模式至少需要 ${cfg.minImages} 张图片`;
    if (cfg.needsVideos && (cfg.minVideos || 0) > 0 && videos.length < (cfg.minVideos || 0))
      return `当前模式至少需要 ${cfg.minVideos} 个视频`;
    if (cfg.needsAudios && (cfg.minAudios || 0) > 0 && audios.length < (cfg.minAudios || 0))
      return `当前模式至少需要 ${cfg.minAudios} 段音频`;
    return null;
  }

  // ── 提交任务 ──────────────────────────────────────────────────────────────
  async function handleSubmit() {
    const err = getSubmitError();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      const { db } = await import('@/db/client');

      const inputsPayload = {
        images: images.map((it, i) => ({ asset_id: it.asset_id, url: it.url, role: it.role || 'reference', weight: it.weight || 1, sort_order: i })),
        videos: videos.map((it, i) => ({ asset_id: it.asset_id, url: it.url, role: it.role || 'source', weight: it.weight || 1, sort_order: i })),
        audios: audios.map((it, i) => ({ asset_id: it.asset_id, url: it.url, role: it.role || 'driver', weight: it.weight || 1, sort_order: i })),
      };
      const paramsPayload = {
        aspect_ratio: ratio, width, height,
        duration: duration !== '' ? Number(duration) : undefined,
        fps: fps !== '' ? Number(fps) : undefined,
        seed: seed !== '' ? Number(seed) : undefined,
        motion_strength: motionStrength,
        style_strength: styleStrength,
        audio_drive_strength: audioStrength,
        ref_strength: refStrength,
        preserve_motion: preserveMotion,
        preserve_structure: preserveStruct,
        preserve_person: preservePerson,
        drive_type: driveType,
      };

      const sourceAssetIds = [
        ...images.map(i => i.asset_id).filter(Boolean),
        ...videos.map(v => v.asset_id).filter(Boolean),
        ...audios.map(a => a.asset_id).filter(Boolean),
      ] as string[];

      const body = {
        apiConfigId, modelId, prompt: prompt.trim(),
        negativePrompt: negPrompt.trim() || undefined,
        mode, inputs: inputsPayload, params: paramsPayload,
        // 旧版兼容字段（后端可能仍读取）
        imageUrl:   images[0]?.url,
        imageUrls:  images.map(i => i.url),
        width, height,
        numFrames:  fps !== '' ? Number(fps) : undefined,
        frameRate:  fps !== '' ? Number(fps) : undefined,
      };

      const { data, error } = await db.functions.invoke('video-generate', { body });

      if (error) {
        const rawText = await error?.context?.text?.().catch(() => null) as string | null;
        let errMsg = error.message || '未知错误';
        // 优先尝试解析 EF 返回的 JSON（包含真实错误信息，如 provider 报错）
        if (rawText) {
          try {
            const p = JSON.parse(rawText) as Record<string, unknown>;
            if (p?.error) {
              errMsg = String(p.error);
              // provider 返回 404（接口路径错误）附加引导提示
              if (String(p.error).includes('Invalid URL') || (String(p.error).includes('404') && p.url))
                errMsg += '\n👉 请前往「模型配置 → 异步视频接口配置」检查「创建任务路径」是否正确。';
            }
          } catch {
            // rawText 不是 JSON → 判断是否为真正的 EF 未部署（Supabase 网关级 404）
            if (rawText.includes('404') || error.message?.includes('404'))
              errMsg = 'video-generate 后端函数不存在或未部署，请联系管理员检查 Edge Function。';
            else
              errMsg = rawText;
          }
        }
        throw new Error(errMsg);
      }
      if (data?.error) {
        const msg = String(data.error);
        let hint = '';
        if (msg.includes('404') || msg.includes('Invalid URL'))
          hint = '\n👉 请前往「模型配置 → 异步视频接口配置」检查「创建任务路径」是否正确。';
        else if (msg.includes('401') || msg.includes('Unauthorized'))
          hint = '\n👉 API Key 无效或无权限，请检查密钥配置。';
        else if (msg.includes('不具备'))
          hint = '\n👉 请在「模型配置」中为该模型开启对应的视频能力标签。';
        else if (msg.includes('Base URL 为空'))
          hint = '\n👉 请在「模型配置」中填写正确的 Base URL。';
        throw new Error(msg + hint);
      }

      const task = await createVideoTask({
        project_id:          selectedProjectId!,
        storyboard_id:       passedStoryboard?.id,
        model_catalog_id:    modelId,
        upstream_task_id:    data?.taskId,
        upstream_video_id:   data?.videoId || undefined,
        prompt:              prompt.trim() || undefined,
        negative_prompt:     negPrompt.trim() || undefined,
        mode,
        inputs:              inputsPayload,
        params:              paramsPayload,
        source_asset_ids:    sourceAssetIds,
        // 旧版兼容
        reference_image_url: images[0]?.url,
        reference_image_asset_id: images[0]?.asset_id,
        first_frame_url:     images.find(i => i.role === 'first_frame')?.url,
        first_frame_asset_id: images.find(i => i.role === 'first_frame')?.asset_id,
        last_frame_url:      images.find(i => i.role === 'last_frame')?.url,
        last_frame_asset_id: images.find(i => i.role === 'last_frame')?.asset_id,
        status:              'submitted',
        progress:            0,
        polling_retry_count: 0,
        submitted_at:        new Date().toISOString(),
        raw_create_response: data?.raw,
        params_snapshot:     paramsPayload,
      });

      setTasks(prev => [task, ...prev]);
      toast.success('视频任务已提交，正在排队生成…');
    } catch (e) {
      toast.error(`提交失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally { setSubmitting(false); }
  }

  async function handleRetry(task: VideoTask) {
    const updates: Partial<VideoTask> = { status: 'submitted', progress: 0, polling_retry_count: 0, error_message: undefined };
    await updateVideoTask(task.id, updates);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updates } : t));
    toast.info('已重置任务，开始重新轮询');
  }

  async function handleDelete(id: string) {
    await updateVideoTask(id, { status: 'failed' });
    setTasks(prev => prev.filter(t => t.id !== id));
    toast.success('已删除');
  }

  function handleDownload(url: string) {
    const a = document.createElement('a');
    a.href = url; a.download = `video_${Date.now()}.mp4`;
    a.target = '_blank'; a.click();
  }

  async function handleAddToLibrary(task: VideoTask) {
    if (!task.video_url || !selectedProjectId) return;
    try {
      await createAsset({ project_id: selectedProjectId, asset_type: 'video', name: `视频_${Date.now()}`, file_url: task.video_url, thumbnail_url: task.thumbnail_url || '', prompt: task.prompt || '', source_module: 'video_generation', favorite: false });
      toast.success('已添加到素材库');
    } catch { toast.error('添加失败'); }
  }

  const activeTasks = tasks.filter(t => isActiveStatus(t.status));
  const submitError = getSubmitError();

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Video className="w-5 h-5 text-red-400" />多模态视频生成工作台
          </h1>
          {activeTasks.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <Loader2 className="w-4 h-4 animate-spin" />{activeTasks.length} 个任务生成中
            </div>
          )}
        </div>

        {/* ── 工作台主体 ── */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 md:p-5 space-y-5">

            {/* 基础三列：项目 / 模型 / 比例 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><Label>所属项目</Label><ProjectSelector className="mt-1 w-full" /></div>
              <div>
                <Label>使用模型</Label>
                <ModelSelector
                  requiredCapability="video_generation"
                  value={modelId}
                  onChange={(mid, acid) => { setModelId(mid); setApiConfigId(acid); }}
                  className="mt-1 w-full"
                  placeholder="选择视频模型"
                />
              </div>
              <div>
                <Label>视频比例</Label>
                <Select value={ratio} onValueChange={setRatio}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{RATIO_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* 生成模式选择（分组展示） */}
            <div>
              <Label>生成模式</Label>
              <div className="mt-2 space-y-2">
                {Object.entries(MODE_GROUPS).map(([group, modes]) => (
                  <div key={group} className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {modes.map(m => (
                        <button key={m.value} type="button"
                          onClick={() => setMode(m.value)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            mode === m.value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground'
                          }`}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 动态素材输入区 */}
            {(modeConfig.needsImages || mode === 'keyframes') && (
              <div className="space-y-3">
                {mode === 'keyframes' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <MediaInput
                      kind="image" label="首帧图片 *" single
                      items={images.filter(i => i.role === 'first_frame')}
                      onChange={v => setImages(prev => [...prev.filter(i => i.role !== 'first_frame'), ...v.map(i => ({ ...i, role: 'first_frame' }))])}
                      projectId={selectedProjectId || undefined} required
                    />
                    <MediaInput
                      kind="image" label="尾帧图片 *" single
                      items={images.filter(i => i.role === 'last_frame')}
                      onChange={v => setImages(prev => [...prev.filter(i => i.role !== 'last_frame'), ...v.map(i => ({ ...i, role: 'last_frame' }))])}
                      projectId={selectedProjectId || undefined} required
                    />
                  </div>
                ) : (
                  <MediaInput
                    kind="image"
                    label={`图片 *${modeConfig.minImages ? `（至少 ${modeConfig.minImages} 张）` : ''}`}
                    items={images} onChange={setImages}
                    projectId={selectedProjectId || undefined}
                    showRole={mode === 'multi_image' || mode === 'multimodal' || mode === 'char_ref' || mode === 'motion_ref'}
                    required={!!modeConfig.minImages}
                    maxCount={mode === 'image2video' || mode === 'lip_sync' || mode === 'img_audio' ? 1 : undefined}
                    single={mode === 'image2video' || mode === 'lip_sync' || mode === 'img_audio'}
                  />
                )}
              </div>
            )}

            {modeConfig.needsVideos && (
              <MediaInput
                kind="video"
                label={`视频 *${modeConfig.minVideos ? `（至少 ${modeConfig.minVideos} 个）` : ''}`}
                items={videos} onChange={setVideos}
                projectId={selectedProjectId || undefined}
                showRole={mode === 'multimodal'}
                required={!!modeConfig.minVideos}
                single={['video_ref','video2video','video_extend','video_repaint','video_style','vid_audio'].includes(mode)}
              />
            )}

            {modeConfig.needsAudios && (
              <MediaInput
                kind="audio"
                label={`音频 *${modeConfig.minAudios ? `（至少 ${modeConfig.minAudios} 段）` : ''}`}
                items={audios} onChange={setAudios}
                projectId={selectedProjectId || undefined}
                showRole={mode === 'multimodal'}
                required={!!modeConfig.minAudios}
                single={['audio_driven','lip_sync','img_audio','vid_audio'].includes(mode)}
              />
            )}

            {/* 风格参考图（视频风格迁移可选） */}
            {modeConfig.showStyleRef && (
              <MediaInput kind="image" label="风格参考图（可选）"
                items={styleRefImages} onChange={setStyleRefImages}
                projectId={selectedProjectId || undefined} single />
            )}

            {/* 驱动类型选择 */}
            {modeConfig.showDriveType && (
              <div>
                <Label>驱动类型</Label>
                <Select value={driveType} onValueChange={setDriveType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{DRIVE_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            {/* 提示词区 */}
            {modeConfig.showPrompt !== false && (
              <div>
                <Label>
                  视频提示词{modeConfig.promptRequired ? ' *' : '（可选）'}
                </Label>
                <Textarea className="mt-1" rows={3} value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder={passedStoryboard ? `分镜提示词：${passedStoryboard.video_prompt}` : '描述视频内容、场景、动作、风格…'} />
              </div>
            )}

            {/* 高级参数 */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground px-0">
                  <ChevronDown className={`w-4 h-4 mr-1 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                  高级参数
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pt-3 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div><Label className="text-xs">宽度 (px)</Label>
                      <Input className="mt-1" type="number" value={width} onChange={e => setWidth(Number(e.target.value))} />
                    </div>
                    <div><Label className="text-xs">高度 (px)</Label>
                      <Input className="mt-1" type="number" value={height} onChange={e => setHeight(Number(e.target.value))} />
                    </div>
                    <div><Label className="text-xs">时长 (秒)</Label>
                      <Input className="mt-1" type="number" value={duration} onChange={e => setDuration(e.target.value ? Number(e.target.value) : '')} placeholder="5" />
                    </div>
                    <div><Label className="text-xs">帧率</Label>
                      <Input className="mt-1" type="number" value={fps} onChange={e => setFps(e.target.value ? Number(e.target.value) : '')} placeholder="默认" />
                    </div>
                  </div>

                  {modeConfig.showMotionStrength && (
                    <div><Label className="text-xs">运动强度 {motionStrength.toFixed(1)}</Label>
                      <Slider className="mt-2" min={0} max={1} step={0.1} value={[motionStrength]} onValueChange={v => setMotionStrength(v[0])} />
                    </div>
                  )}
                  {modeConfig.showStyleStrength && (
                    <div><Label className="text-xs">风格强度 {styleStrength.toFixed(1)}</Label>
                      <Slider className="mt-2" min={0} max={1} step={0.1} value={[styleStrength]} onValueChange={v => setStyleStrength(v[0])} />
                    </div>
                  )}
                  {modeConfig.showAudioStrength && (
                    <div><Label className="text-xs">音频驱动强度 {audioStrength.toFixed(1)}</Label>
                      <Slider className="mt-2" min={0} max={1} step={0.1} value={[audioStrength]} onValueChange={v => setAudioStrength(v[0])} />
                    </div>
                  )}
                  {modeConfig.showRefStrength && (
                    <div><Label className="text-xs">参考强度 {refStrength.toFixed(1)}</Label>
                      <Slider className="mt-2" min={0} max={1} step={0.1} value={[refStrength]} onValueChange={v => setRefStrength(v[0])} />
                    </div>
                  )}
                  {modeConfig.showPreserveOptions && (
                    <div className="flex flex-wrap gap-4">
                      {[['保留运动', preserveMotion, setPreserveMotion], ['保留结构', preserveStruct, setPreserveStruct], ['保留人物', preservePerson, setPreservePerson]].map(([l, v, set]) => (
                        <div key={String(l)} className="flex items-center gap-2">
                          <Switch checked={Boolean(v)} onCheckedChange={fn => (set as React.Dispatch<React.SetStateAction<boolean>>)(fn)} id={`sw_${l}`} />
                          <Label htmlFor={`sw_${l}`} className="text-xs">{String(l)}</Label>
                        </div>
                      ))}
                    </div>
                  )}

                  {modeConfig.showNegPrompt && (
                    <div><Label className="text-xs">负面提示词</Label>
                      <Textarea className="mt-1" rows={2} value={negPrompt} onChange={e => setNegPrompt(e.target.value)} placeholder="不希望出现的内容" />
                    </div>
                  )}
                  <div><Label className="text-xs">随机种子</Label>
                    <Input className="mt-1" type="number" value={seed} onChange={e => setSeed(e.target.value ? Number(e.target.value) : '')} placeholder="留空=随机" />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* 底部操作行 */}
            <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={saveToLibrary} onCheckedChange={setSaveToLibrary} id="save-vid-lib" />
                <Label htmlFor="save-vid-lib" className="text-sm">完成后保存到素材库</Label>
              </div>
              <div className="flex items-center gap-3">
                {submitError && !submitting && (
                  <p className="text-xs text-muted-foreground">{submitError}</p>
                )}
                <Button onClick={handleSubmit} disabled={submitting || !!submitError}>
                  {submitting
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />提交中…</>
                    : <><Sparkles className="w-4 h-4 mr-2" />提交生成任务</>}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 任务列表 ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Layers className="w-4 h-4" />{tasks.length} 个视频任务
            </h2>
            <Button variant="ghost" size="sm" onClick={loadTasks}>
              <RotateCcw className="w-4 h-4 mr-1" />刷新
            </Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Video className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>还没有视频任务，选择模式后提交生成</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tasks.map(t => (
                <Card key={t.id} className="bg-card border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-14 h-14 rounded-lg bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                        {t.status === 'completed' && t.video_url
                          ? <video src={t.video_url} className="w-full h-full object-cover" muted />
                          : t.status === 'completed'
                            ? <CheckCircle2 className="w-6 h-6 text-green-400" />
                            : (t.status === 'failed' || t.status === 'timeout')
                              ? <AlertCircle className="w-6 h-6 text-red-400" />
                              : <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className={`text-xs ${statusColors[t.status] || ''}`}>
                            {VIDEO_STATUS_LABELS[t.status] || t.status}
                          </Badge>
                          {t.mode && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              {MODE_MAP[t.mode]?.label || t.mode}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{t.prompt || '（无提示词）'}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>{new Date(t.created_at).toLocaleString('zh-CN')}</span>
                          {(t.polling_retry_count || 0) > 0 && (
                            <span className="shrink-0">· 已轮询 {t.polling_retry_count} 次</span>
                          )}
                        </div>
                        {t.error_message && (
                          <p className="text-xs text-destructive mt-1 line-clamp-2">{t.error_message}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {t.status === 'completed' && t.video_url && (
                          <>
                            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setPreviewTask(t)}>
                              <Play className="w-3 h-3 mr-1" />播放
                            </Button>
                            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleDownload(t.video_url!)}>
                              <Download className="w-3 h-3 mr-1" />下载
                            </Button>
                            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleAddToLibrary(t)}>
                              <LibraryBig className="w-3 h-3 mr-1" />素材库
                            </Button>
                          </>
                        )}
                        {(t.status === 'failed' || t.status === 'timeout') && (
                          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleRetry(t)}>
                            <RefreshCw className="w-3 h-3 mr-1" />重轮询
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleDelete(t.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {isActiveStatus(t.status) && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{t.status === 'submitted' ? '排队中…' : t.status === 'processing' ? '生成中…' : '获取结果…'}</span>
                          {(t.progress || 0) > 0 && <span>{t.progress}%</span>}
                        </div>
                        <Progress value={t.progress || 0} className="h-1" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 视频预览 Dialog */}
      <Dialog open={!!previewTask} onOpenChange={open => !open && setPreviewTask(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
          <DialogHeader><DialogTitle>视频预览</DialogTitle></DialogHeader>
          {previewTask?.video_url && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden bg-black flex items-center justify-center max-h-[60vh]">
                <video src={previewTask.video_url} controls className="max-w-full max-h-[60vh]" style={{ objectFit: 'contain' }}>
                  <track kind="captions" />
                </video>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="secondary"
                  onClick={() => { navigator.clipboard.writeText(previewTask.prompt || ''); toast.success('已复制提示词'); }}>
                  <Copy className="w-4 h-4 mr-1" />复制提示词
                </Button>
                <Button size="sm" onClick={() => handleDownload(previewTask.video_url!)}>
                  <Download className="w-4 h-4 mr-1" />下载
                </Button>
                <Button size="sm" variant="secondary" onClick={() => handleAddToLibrary(previewTask)}>
                  <LibraryBig className="w-4 h-4 mr-1" />添加到素材库
                </Button>
              </div>
              {previewTask.params_snapshot && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">查看任务参数</summary>
                  <pre className="mt-1 bg-muted rounded p-2 overflow-auto text-xs">
                    {JSON.stringify(previewTask.params_snapshot, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

