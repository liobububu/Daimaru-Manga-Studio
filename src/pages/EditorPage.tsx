import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import MainLayout from '@/components/layouts/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Scissors, Plus, Trash2, Split, Gauge, Volume2, VolumeX, Download,
  RefreshCw, Film, Music, Image as ImageIcon, Save, Play, Merge,
  ArrowUp, ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { localSupabase } from '@/db/client';
import { checkLocalMediaFiles, getAssets, getScripts, getStoryboards } from '@/services/api';
import type { Asset, Script, Storyboard } from '@/types/types';
import { useProject } from '@/contexts/ProjectContext';
import { clipStoryboardBinding, mediaWorkKey, rebindTimelineMedia, sortEpisodes, storyboardLoadKey } from '../../shared/episode-flow.js';

const api = localSupabase.api;

interface Clip {
  id: string;
  type: 'video' | 'audio' | 'image';
  src: string;
  assetId?: string | null;
  storyboardId?: string;
  mediaRole?: 'visual' | 'voiceover' | 'dialogue' | string;
  name?: string;
  start: number;
  duration: number;
  sourceStart: number;
  speed: number;
  reversed?: boolean;
  muted?: boolean;
  volume: number;
  transitionIn?: { type: string; duration: number } | null;
}

interface Timeline {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  tracks: Array<{ id: string; type: 'video' | 'audio'; clips: Clip[] }>;
}

const emptyTimeline = (): Timeline => ({
  id: `tl_${Date.now().toString(36)}`,
  name: '主时间线',
  width: 1080,
  height: 1920,
  fps: 30,
  tracks: [
    { id: 'v1', type: 'video', clips: [] },
    { id: 'a1', type: 'audio', clips: [] },
  ],
});

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0.00s';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : `${s.toFixed(2)}s`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatEta(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '计算中';
  if (seconds <= 0) return '0 秒';
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = Math.ceil(seconds % 60);
  return remain ? `${minutes} 分 ${remain} 秒` : `${minutes} 分钟`;
}

export default function EditorPage() {
  const { selectedProjectId } = useProject();
  const location = useLocation();
  const routeState = location.state as { projectId?: string; scriptId?: string } | null;
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [scripts, setScripts] = useState<Script[]>([]);
  const [scriptId, setScriptId] = useState<string>('');
  const [episodeStoryboardIds, setEpisodeStoryboardIds] = useState<Set<string>>(new Set());
  const [episodeStoryboards, setEpisodeStoryboards] = useState<Storyboard[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetsReadyKey, setAssetsReadyKey] = useState('');
  const [assemblingEpisode, setAssemblingEpisode] = useState(false);
  const [assemblyMissing, setAssemblyMissing] = useState<string[]>([]);
  const [invalidTimelineClips, setInvalidTimelineClips] = useState<string[]>([]);
  const openReelRequestIdRef = useRef<string | null>(null);
  const assetsLoadKeyRef = useRef('');
  const scriptsLoadKeyRef = useRef('');
  const storyboardLoadKeyRef = useRef('');
  const assemblyKeyRef = useRef('');
  const editorContextRef = useRef('');
  const renderContextRef = useRef('');
  const savedTimelineLoadRef = useRef('');
  editorContextRef.current = storyboardLoadKey(projectId, scriptId);

  const [timeline, setTimeline] = useState<Timeline>(emptyTimeline());
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const [renderPercent, setRenderPercent] = useState(0);
  const [renderStatus, setRenderStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [renderError, setRenderError] = useState('');
  const [renderOutput, setRenderOutput] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 加载项目 ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await localSupabase.from('projects').select('*').order('created_at', { ascending: false }).limit(50);
        const list = (res.data || []) as Array<{ id: string; name: string }>;
        setProjects(list);
        // 剪辑台必须继承全站当前项目，不能每次偷偷切到“最新项目”。
        const preferredProjectId = routeState?.projectId && list.some(p => p.id === routeState.projectId)
          ? routeState.projectId
          : selectedProjectId && list.some(p => p.id === selectedProjectId)
            ? selectedProjectId
            : list[0]?.id || '';
        setProjectId(preferredProjectId);
      } catch {
        /* 项目为空时忽略 */
      }
    })();
  }, [selectedProjectId, routeState?.projectId]);

  const loadAssets = useCallback(async () => {
    if (!projectId) { setAssets([]); setAssetsReadyKey(''); return; }
    const requestKey = mediaWorkKey(projectId, scriptId);
    assetsLoadKeyRef.current = requestKey;
    setAssetsReadyKey('');
    setLoadingAssets(true);
    try {
      const data = await getAssets(projectId);
      if (assetsLoadKeyRef.current === requestKey) { setAssets(data.filter(a => a.file_url)); setAssetsReadyKey(requestKey); }
    } catch (e) {
      if (assetsLoadKeyRef.current === requestKey) toast.error(`加载素材失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      if (assetsLoadKeyRef.current === requestKey) setLoadingAssets(false);
    }
  }, [projectId, scriptId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  useEffect(() => {
    if (!projectId) { scriptsLoadKeyRef.current = ''; setScripts([]); setScriptId(''); return; }
    const requestKey = `scripts::${projectId}`;
    scriptsLoadKeyRef.current = requestKey;
    getScripts(projectId).then(raw => {
      if (scriptsLoadKeyRef.current !== requestKey) return;
      const list = sortEpisodes(raw) as Script[];
      setScripts(list);
      setScriptId(current => routeState?.scriptId && list.some(item => item.id === routeState.scriptId)
        ? routeState.scriptId
        : current && list.some(item => item.id === current)
          ? current
          : (list.length === 1 ? list[0].id : ''));
    }).catch(() => { if (scriptsLoadKeyRef.current === requestKey) { setScripts([]); setScriptId(''); } });
  }, [projectId]);

  useEffect(() => {
    // 项目/集数一旦改变，先清空上一集时间线。若当前集有已保存方案，后续加载流程会恢复；
    // 若没有保存方案，则必须保持空时间线，绝不能把上一集剪辑方案误当成当前集继续编辑。
    savedTimelineLoadRef.current = '';
    setTimeline(emptyTimeline());
    setSelectedClipId(null);
    setInvalidTimelineClips([]);
    setRenderStatus('idle');
    setRenderPercent(0);
    setRenderError('');
    setRenderOutput('');
  }, [projectId, scriptId]);

  useEffect(() => {
    if (!projectId || !scriptId) { storyboardLoadKeyRef.current = ''; setEpisodeStoryboardIds(new Set()); setEpisodeStoryboards([]); return; }
    const requestKey = storyboardLoadKey(projectId, scriptId);
    storyboardLoadKeyRef.current = requestKey;
    getStoryboards(projectId, scriptId).then(items => {
      if (storyboardLoadKeyRef.current === requestKey) { setEpisodeStoryboardIds(new Set(items.map(item => item.id))); setEpisodeStoryboards(items); }
    }).catch(() => { if (storyboardLoadKeyRef.current === requestKey) { setEpisodeStoryboardIds(new Set()); setEpisodeStoryboards([]); } });
  }, [projectId, scriptId]);

  useEffect(() => {
    if (!projectId || !scriptId || !episodeStoryboards.length || loadingAssets) return;
    const contextKey = storyboardLoadKey(projectId, scriptId);
    if (assetsReadyKey !== mediaWorkKey(projectId, scriptId)) return;
    if (savedTimelineLoadRef.current === contextKey) return;
    savedTimelineLoadRef.current = contextKey;
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<{ data: Array<{ id: string; project_id?: string; script_id?: string; updated_at?: string }> }>('/api/edit/timelines');
        const candidates = (list.data || []).filter(item => item.project_id === projectId).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        let saved: Timeline | null = null;
        let savedId = '';
        for (const meta of candidates) {
          if (meta.script_id && meta.script_id !== scriptId) continue;
          const loaded = await api.post<{ data: { timeline: Timeline } }>('/api/edit/timeline/get', { id: meta.id });
          const candidate = loaded.data?.timeline;
          if (!candidate) continue;
          if (!meta.script_id) {
            const bindings = candidate.tracks.flatMap(track => track.clips.map(clipStoryboardBinding)).filter(Boolean) as Array<{ storyboardId: string }>;
            if (!bindings.length || bindings.some(binding => !episodeStoryboardIds.has(binding.storyboardId))) continue;
          }
          saved = candidate; savedId = meta.id; break;
        }
        if (!saved || cancelled || editorContextRef.current !== contextKey) return;
        const rebound = rebindTimelineMedia(saved, episodeStoryboards, assets);
        setTimeline(rebound.timeline as Timeline);
        setSelectedClipId(null);
        if (rebound.changed) {
          await api.post('/api/edit/timeline/save', { id: savedId || rebound.timeline.id, name: rebound.timeline.name, project_id: projectId, script_id: scriptId, timeline: rebound.timeline });
          if (!cancelled && editorContextRef.current === contextKey) toast.info('已将剪辑方案中的旧素材重新绑定到当前镜头最新素材');
        }
      } catch { /* 没有已保存方案时保持当前空时间线 */ }
    })();
    return () => { cancelled = true; };
  }, [projectId, scriptId, episodeStoryboards, episodeStoryboardIds, assets, loadingAssets, assetsReadyKey]);

  const usableAssets = useMemo(
    () => assets.filter(a => ['video', 'image', 'audio'].includes(a.asset_type) && (!scriptId || !a.storyboard_id || episodeStoryboardIds.has(a.storyboard_id))),
    [assets, scriptId, episodeStoryboardIds],
  );

  const totalDuration = useMemo(() => {
    return timeline.tracks.reduce((max, t) => {
      for (const c of t.clips) max = Math.max(max, c.start + c.duration);
      return max;
    }, 0);
  }, [timeline]);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const t of timeline.tracks) {
      const c = t.clips.find(x => x.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [timeline, selectedClipId]);

  // ── 时间线命令：统一走后端，成功后拿回最新时间线 ──────────
  const runCommand = useCallback(async (cmd: Record<string, unknown>) => {
    const requestKey = editorContextRef.current;
    const timelineId = timeline.id;
    try {
      const res = await api.post<{ data: { timeline: Timeline } }>('/api/edit/command', { timelineId, cmd });
      if (editorContextRef.current !== requestKey) return false;
      if (res.data?.timeline) setTimeline(res.data.timeline);
      return true;
    } catch (e) {
      if (editorContextRef.current === requestKey) toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [timeline.id]);

  /** 先确保时间线已保存（命令路由要求时间线存在） */
  const ensureSaved = useCallback(async () => {
    const requestKey = editorContextRef.current;
    const snapshot = timeline;
    const ownerProjectId = projectId || null;
    const res = await api.post<{ data: { id: string } }>('/api/edit/timeline/save', {
      id: snapshot.id, name: snapshot.name, project_id: ownerProjectId, script_id: scriptId || null, timeline: snapshot,
    });
    if (editorContextRef.current !== requestKey) return snapshot.id;
    return res.data?.id || snapshot.id;
  }, [timeline, projectId, scriptId]);

  const addAssetToTimeline = async (asset: Asset) => {
    const type = asset.asset_type === 'audio' ? 'audio' : 'video';
    let duration = 5;
    // 本地素材可以探测真实时长；远端地址拿不到就用默认值
    const assetUrl = asset.file_url || '';
    if (assetUrl.startsWith('/api/files/')) {
      try {
        const probe = await api.post<{ data: { duration: number | null } }>('/api/edit/probe', { url: assetUrl });
        if (probe.data?.duration) duration = probe.data.duration;
      } catch { /* 探测失败用默认值 */ }
    }

    await ensureSaved();
    const ok = await runCommand({
      type: 'addClip',
      clip: {
        type,
        src: assetUrl,
        name: asset.name || '',
        duration,
        sourceStart: 0,
        speed: 1,
        volume: 1,
      },
    });
    if (ok) toast.success(`已加入时间线：${asset.name}`);
  };

  const probeAssetDuration = async (asset: Asset, fallback = 5) => {
    const assetUrl = asset.file_url || '';
    if (assetUrl.startsWith('/api/files/')) {
      try {
        const probe = await api.post<{ data: { duration: number | null } }>('/api/edit/probe', { url: assetUrl });
        if (probe.data?.duration) return probe.data.duration;
      } catch { /* 探测失败使用兜底时长 */ }
    }
    return fallback;
  };

  const assembleEpisodeTimeline = async () => {
    if (!projectId || assemblingEpisode) return;
    setAssemblingEpisode(true);
    setAssemblyMissing([]);
    const assemblyKey = storyboardLoadKey(projectId, scriptId);
    assemblyKeyRef.current = assemblyKey;
    try {
      if (scripts.length > 1 && !scriptId) {
        toast.error('该项目包含多个剧本/集数，请先选择要组装的剧本，避免把不同集的分镜混在一起');
        return;
      }
      const [storyboards, projectAssets] = await Promise.all([getStoryboards(projectId, scriptId || undefined), getAssets(projectId)]);
      if (assemblyKeyRef.current !== assemblyKey) return;
      const byId = new Map(projectAssets.map(a => [a.id, a]));
      const localUrls = projectAssets.map(asset => asset.file_url || '').filter(url => url.startsWith('/api/files/'));
      const localChecks = await checkLocalMediaFiles(localUrls);
      const assetAvailable = (asset?: Asset) => {
        if (!asset?.file_url) return false;
        return !asset.file_url.startsWith('/api/files/') || localChecks[asset.file_url]?.exists === true;
      };
      const ordered = [...storyboards].sort((a, b) => a.shot_index - b.shot_index);
      const missing: string[] = [];
      const next = emptyTimeline();
      const selectedScript = scripts.find(item => item.id === scriptId);
      next.name = selectedScript ? `${selectedScript.title} · 整集自动时间线` : '整集自动时间线';
      let cursor = 0;

      for (const shot of ordered) {
        const video = shot.video_asset_id ? byId.get(shot.video_asset_id) : undefined;
        const image = shot.image_asset_id ? byId.get(shot.image_asset_id) : undefined;
        const visual = assetAvailable(video) ? video : assetAvailable(image) ? image : undefined;
        const visualDuration = visual?.asset_type === 'video' ? await probeAssetDuration(visual, 5) : 5;

        // 先计算该镜全部语音的真实长度，再决定镜头槽位长度，避免下一镜压到当前配音上。
        const audios = [
          { asset: shot.voiceover_audio || (shot.voiceover_asset_id ? byId.get(shot.voiceover_asset_id) : undefined), label: '旁白', required: !!shot.voiceover?.trim(), duration: 0 },
          { asset: shot.dialogue_audio || (shot.dialogue_asset_id ? byId.get(shot.dialogue_asset_id) : undefined), label: '对白', required: !!shot.dialogue?.trim(), duration: 0 },
        ];
        for (const item of audios) {
          if (assetAvailable(item.asset)) item.duration = await probeAssetDuration(item.asset!, visualDuration);
          else if (item.required) missing.push(`镜${shot.shot_index}：${item.asset?.file_url ? `${item.label}音频文件已丢失` : `缺${item.label}音频`}`);
        }
        const audioDuration = audios.reduce((sum, item) => sum + item.duration, 0);
        const shotDuration = Math.max(visualDuration, audioDuration || 0);

        if (visual) {
          // 静态图可直接延长；视频若短于配音则自动降速铺满该镜，避免黑场/提前切下一镜。
          const speed = visual.asset_type === 'video' && shotDuration > visualDuration ? visualDuration / shotDuration : 1;
          next.tracks[0].clips.push({ id: `shot_${shot.id}_visual`, type: 'video', src: visual.file_url!, assetId: visual.id, storyboardId: shot.id, mediaRole: 'visual', name: `镜${shot.shot_index} · ${visual.name}`, start: cursor, duration: shotDuration, sourceStart: 0, speed, reversed: false, muted: false, volume: 1, transitionIn: null });
          if (!assetAvailable(video)) missing.push(`镜${shot.shot_index}：${video?.file_url ? '视频文件已丢失' : '缺视频'}，已用图片占位`);
        } else missing.push(`镜${shot.shot_index}：缺视频和图片`);

        let audioOffset = cursor;
        for (const item of audios) {
          const audioAsset = item.asset;
          if (!audioAsset || !assetAvailable(audioAsset) || !audioAsset.file_url || item.duration <= 0) continue;
          next.tracks[1].clips.push({ id: `shot_${shot.id}_${item.label}`, type: 'audio', src: audioAsset.file_url, assetId: audioAsset.id, storyboardId: shot.id, mediaRole: item.label === '旁白' ? 'voiceover' : 'dialogue', name: `镜${shot.shot_index} · ${item.label}`, start: audioOffset, duration: item.duration, sourceStart: 0, speed: 1, reversed: false, muted: false, volume: 1, transitionIn: null });
          audioOffset += item.duration;
        }
        cursor += shotDuration;
      }

      if (assemblyKeyRef.current !== assemblyKey) return;
      setTimeline(next);
      setSelectedClipId(null);
      setAssemblyMissing(missing);
      await api.post('/api/edit/timeline/save', { id: next.id, name: next.name, project_id: projectId, script_id: scriptId || null, timeline: next });
      if (assemblyKeyRef.current !== assemblyKey) return;
      toast.success(`整集时间线已组装：${ordered.length} 个分镜${missing.length ? `，${missing.length} 项素材缺失` : ''}`);
    } catch (e) {
      toast.error(`整集组装失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally { if (assemblyKeyRef.current === assemblyKey) setAssemblingEpisode(false); }
  };

  const handleSplit = async () => {
    if (!selectedClip) return;
    const at = Number(window.prompt('在时间线的第几秒分割？', (selectedClip.start + selectedClip.duration / 2).toFixed(2)));
    if (!Number.isFinite(at)) return;
    await runCommand({ type: 'splitClip', clipId: selectedClip.id, at });
  };

  const handleTrim = async (edge: 'head' | 'tail') => {
    if (!selectedClip) return;
    const target = Number(window.prompt(`裁剪后保留多少秒？（${edge === 'head' ? '保留尾部' : '保留开头'}）`, selectedClip.duration.toFixed(2)));
    if (!Number.isFinite(target)) return;
    await runCommand({ type: 'trimClip', clipId: selectedClip.id, edge, duration: target });
  };

  const patchSelected = async (patch: Record<string, unknown>) => {
    if (!selectedClip) return;
    await runCommand({ type: 'patchClip', clipId: selectedClip.id, patch });
  };

  const setSpeedForSelected = async (speed: number) => {
    if (!selectedClip) return;
    await runCommand({ type: 'setSpeed', clipId: selectedClip.id, speed });
  };

  const removeSelected = async () => {
    if (!selectedClip) return;
    await runCommand({ type: 'removeClip', clipId: selectedClip.id });
  };

  // 与后一段合并。合并要求「同一素材 + 同方向 + 首尾相接」（见 lib/timeline.js），
  // 这里先自查再发命令——能当场说清为什么合不了，比撞到服务端报错友好。
  const handleMerge = async () => {
    if (!selectedClip) return;
    const track = timeline.tracks.find(t => t.clips.some(c => c.id === selectedClip.id));
    if (!track) return;
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex(c => c.id === selectedClip.id);
    const next = sorted[idx + 1];
    if (!next) { toast.error('后面没有相邻的片段可以合并'); return; }
    if (next.src !== selectedClip.src) { toast.error('后一段是不同素材，不能合并'); return; }
    if (!!next.reversed !== !!selectedClip.reversed) { toast.error('反转方向不同，不能合并'); return; }
    await runCommand({ type: 'mergeClips', clipIdA: selectedClip.id, clipIdB: next.id });
    setSelectedClipId(null);
  };

  // 与相邻片段交换顺序。走服务端 swapClips（原子操作），
  // 不用两次 moveClip——那会在中间留下一个两片段重叠的状态。
  const handleSwap = async (dir: 'up' | 'down') => {
    if (!selectedClip) return;
    const track = timeline.tracks.find(t => t.clips.some(c => c.id === selectedClip.id));
    if (!track) return;
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex(c => c.id === selectedClip.id);
    const other = dir === 'up' ? sorted[idx - 1] : sorted[idx + 1];
    if (!other) {
      toast.error(dir === 'up' ? '已经是第一个片段了' : '已经是最后一个片段了');
      return;
    }
    await runCommand({ type: 'swapClips', clipIdA: selectedClip.id, clipIdB: other.id });
  };

  const validateTimelineMedia = useCallback(async () => {
    const localClips = timeline.tracks.flatMap(track => track.clips).filter(clip => clip.src?.startsWith('/api/files/'));
    if (!localClips.length) { setInvalidTimelineClips([]); return []; }
    const checks = await checkLocalMediaFiles(localClips.map(clip => clip.src));
    const invalid = localClips.filter(clip => checks[clip.src]?.exists !== true).map(clip => clip.name || clip.id);
    setInvalidTimelineClips(invalid);
    return invalid;
  }, [timeline]);

  useEffect(() => {
    const timer = window.setTimeout(() => { validateTimelineMedia().catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  }, [validateTimelineMedia]);

  // ── 渲染导出 ─────────────────────────────────────────────
  const startRender = async () => {
    const renderKey = 'render::' + editorContextRef.current + '::' + timeline.id;
    renderContextRef.current = renderKey;
    if (timeline.tracks.every(t => t.clips.length === 0)) {
      toast.error('时间线是空的');
      return;
    }
    try {
      const invalid = await validateTimelineMedia();
      if (renderContextRef.current !== renderKey) return;
      if (invalid.length) {
        toast.error(`时间线有 ${invalid.length} 个本地素材文件已丢失，请先重新组装或替换素材`);
        return;
      }
    } catch (e) {
      toast.error(`导出前素材检查失败：${e instanceof Error ? e.message : '未知错误'}`);
      return;
    }
    setRenderStatus('running');
    setRenderPercent(0);
    setRenderError('');
    setRenderOutput('');
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      await ensureSaved();
      if (renderContextRef.current !== renderKey) return;
      const res = await api.post<{ data: { jobId: string } }>('/api/edit/render', {
        timelineId: timeline.id,
        name: timeline.name,
      });
      const jobId = res.data?.jobId;
      if (!jobId) throw new Error('未返回任务 ID');
      if (renderContextRef.current !== renderKey) return;

      pollRef.current = setInterval(async () => {
        try {
          const j = await api.get<{
            data: { status: string; percent: number; output?: string; error?: string };
          }>(`/api/edit/job?id=${jobId}`);
          const job = j.data;
          if (renderContextRef.current !== renderKey) return;
          setRenderPercent(job.percent || 0);
          if (job.status === 'done') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRenderStatus('done');
            setRenderOutput(job.output || '');
            toast.success('导出完成');
          } else if (job.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRenderStatus('failed');
            setRenderError(job.error || '渲染失败');
          }
        } catch (e) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRenderStatus('failed');
          setRenderError(e instanceof Error ? e.message : String(e));
        }
      }, 1000);
    } catch (e) {
      setRenderStatus('failed');
      setRenderError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    renderContextRef.current = '';
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setRenderStatus('idle'); setRenderPercent(0); setRenderError(''); setRenderOutput('');
  }, [projectId, scriptId]);

  useEffect(() => {
    renderContextRef.current = '';
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setRenderStatus('idle'); setRenderPercent(0); setRenderError(''); setRenderOutput('');
  }, [projectId, scriptId]);

  const assetIcon = (type: string) => {
    if (type === 'video') return <Film className="w-4 h-4" />;
    if (type === 'audio') return <Music className="w-4 h-4" />;
    return <ImageIcon className="w-4 h-4" />;
  };

  // OpenReel Desktop 是完整剪辑能力的首选入口；旧 Web 版仅保留兼容回退。
  const editorUrl = `${import.meta.env?.VITE_API_BASE || ''}/editor/`;
  const apiBase = import.meta.env?.VITE_API_BASE || '';
  const [mode, setMode] = useState<'desktop' | 'openreel' | 'simple'>('desktop');
  const [desktopAvailable, setDesktopAvailable] = useState<boolean | null>(null);
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [launchingDesktop, setLaunchingDesktop] = useState(false);
  const [sendingToDesktop, setSendingToDesktop] = useState(false);
  const [desktopImportProgress, setDesktopImportProgress] = useState<{ current: number; total: number; percent: number; name: string; loaded?: number; bytesTotal?: number; bytesPerSecond?: number; etaSeconds?: number | null } | null>(null);
  const [failedDesktopAssets, setFailedDesktopAssets] = useState<Array<{ id: string; name: string; error: string }>>([]);
  const desktopImportAbortRef = useRef<AbortController | null>(null);
  const [restoredStageJobId, setRestoredStageJobId] = useState<string | null>(null);
  const importSessionKey = projectId ? `openreel-import-session:${projectId}` : '';

  useEffect(() => {
    if (!importSessionKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(importSessionKey) || 'null');
      if (Array.isArray(saved?.failed)) setFailedDesktopAssets(saved.failed);
      if (saved?.progress) setDesktopImportProgress(saved.progress);
      if (saved?.stageJobId && saved?.active) {
        let stopped = false;
        setRestoredStageJobId(saved.stageJobId);
        const resume = async () => {
          while (!stopped) try {
            const res = await fetch(`${apiBase}/api/media/stage-local-file/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: saved.stageJobId }) });
            const job = await res.json();
            if (stopped || !res.ok) break;
            setDesktopImportProgress(prev => ({ current: prev?.current || saved.progress?.current || 1, total: prev?.total || saved.progress?.total || 1, name: prev?.name || saved.progress?.name || '本地素材', percent: job.progress || 0, loaded: job.loaded || 0, bytesTotal: job.total || 0, bytesPerSecond: job.bytesPerSecond || 0, etaSeconds: job.etaSeconds }));
            if (job.status === 'completed') {
              setRestoredStageJobId(null);
              localStorage.setItem(importSessionKey, JSON.stringify({ ...saved, active: false, progress: null }));
              setDesktopImportProgress(null);
              break;
            }
            if (job.status === 'failed' || job.status === 'cancelled') {
              const failed = [...(Array.isArray(saved.failed) ? saved.failed : []), { id: saved.assetId || saved.stageJobId, name: saved.progress?.name || '本地素材', error: job.error || (job.status === 'cancelled' ? '已取消' : '导入失败') }];
              setFailedDesktopAssets(failed);
              localStorage.setItem(importSessionKey, JSON.stringify({ ...saved, active: false, failed }));
              setRestoredStageJobId(null);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch { break; }
        };
        void resume();
        return () => { stopped = true; };
      }
    } catch { localStorage.removeItem(importSessionKey); }
  }, [apiBase, importSessionKey]);

  useEffect(() => {
    if (!importSessionKey) return;
    const current = JSON.parse(localStorage.getItem(importSessionKey) || '{}');
    localStorage.setItem(importSessionKey, JSON.stringify({ ...current, progress: desktopImportProgress, failed: failedDesktopAssets }));
  }, [desktopImportProgress, failedDesktopAssets, importSessionKey]);

  useEffect(() => {
    fetch(`${apiBase}/api/openreel/desktop/status`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('status failed')))
      .then(data => {
        setDesktopAvailable(Boolean(data.available));
        setDesktopConnected(Boolean(data.connected));
      })
      .catch(() => setDesktopAvailable(false));
  }, [apiBase]);

  const launchOpenReelDesktop = async () => {
    setLaunchingDesktop(true);
    try {
      const res = await fetch(`${apiBase}/api/openreel/desktop/launch`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '启动 OpenReel Desktop 失败');
      setDesktopAvailable(true);
      toast.success('OpenReel Desktop 已启动');
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const statusRes = await fetch(`${apiBase}/api/openreel/desktop/status`);
        if (!statusRes.ok) continue;
        const status = await statusRes.json();
        if (status.connected) {
          setDesktopConnected(true);
          toast.success('已连接 OpenReel Desktop 编辑器');
          break;
        }
      }
    } catch (error) {
      setDesktopAvailable(false);
      toast.error(error instanceof Error ? error.message : '启动 OpenReel Desktop 失败');
    } finally {
      setLaunchingDesktop(false);
    }
  };

  const sendProjectToOpenReel = async () => {
    if (!projectId) {
      toast.error('请先选择动画项目');
      return;
    }
    try {
      const invalid = await validateTimelineMedia();
      if (invalid.length) {
        toast.error(`时间线有 ${invalid.length} 个本地素材文件已丢失，请先重新组装或替换素材`);
        return;
      }
    } catch (e) {
      toast.error(`导出前素材检查失败：${e instanceof Error ? e.message : '未知错误'}`);
      return;
    }
    setSendingToDesktop(true);
    if (!openReelRequestIdRef.current) openReelRequestIdRef.current = `openreel_${projectId}_${timeline.id}_${Date.now()}`;
    setFailedDesktopAssets([]);
    const controller = new AbortController();
    desktopImportAbortRef.current = controller;
    try {
      let connected = desktopConnected;
      if (!connected) {
        const launchRes = await fetch(`${apiBase}/api/openreel/desktop/launch`, { method: 'POST' });
        const launchData = await launchRes.json().catch(() => ({}));
        if (!launchRes.ok) throw new Error(launchData.error || '启动 OpenReel Desktop 失败');
        setDesktopAvailable(true);
        for (let i = 0; i < 30; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const statusRes = await fetch(`${apiBase}/api/openreel/desktop/status`);
          if (!statusRes.ok) continue;
          const status = await statusRes.json();
          if (status.connected) {
            connected = true;
            setDesktopConnected(true);
            break;
          }
        }
      }
      if (!connected) throw new Error('OpenReel Desktop 已启动，但 MCP 服务尚未就绪，请稍后重试');

      const project = projects.find(item => item.id === projectId);
      const timelineAssetIds = new Set(timeline.tracks.flatMap(track => track.clips.map(clip => clip.assetId).filter((id): id is string => !!id)));
      const timelineUrls = new Set(timeline.tracks.flatMap(track => track.clips.map(clip => clip.src).filter(Boolean)));
      const exportAssets = usableAssets.filter(asset => timelineAssetIds.has(asset.id) || (!!asset.file_url && timelineUrls.has(asset.file_url)));
      const unresolvedClips = timeline.tracks.flatMap(track => track.clips).filter(clip => !exportAssets.some(asset => asset.id === clip.assetId || asset.file_url === clip.src));
      if (unresolvedClips.length) toast.warning(`当前时间线有 ${unresolvedClips.length} 个片段找不到对应素材，OpenReel 将跳过这些片段`, { duration: 8000 });
      const media = [];
      const localFailures: Array<{ id: string; name: string; error: string }> = [];
      for (let assetIndex = 0; assetIndex < exportAssets.length; assetIndex++) {
        if (controller.signal.aborted) throw new DOMException('已取消导入', 'AbortError');
        const asset = exportAssets[assetIndex];
        if (!asset.file_url) continue;
        setDesktopImportProgress({ current: assetIndex + 1, total: exportAssets.length, percent: 0, name: asset.name || asset.id });
        const sourceUrl = asset.file_url;
        let url = asset.file_url;
        // blob: URL 只存在于当前浏览器进程。先把内容落到本地媒体目录，
        // 再把持久化 URL 交给后端/OpenReel，避免桌面进程无法读取浏览器 Blob。
        if (url.startsWith('blob:')) {
          try {
            const blob = await fetch(url).then(response => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return response.blob();
            });
            const ext = asset.name?.match(/\.[A-Za-z0-9]+$/)?.[0] || ({
              'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
              'video/mp4': '.mp4', 'video/webm': '.webm',
              'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
            }[blob.type] || '');
            const fileName = asset.name || `openreel_${asset.id}${ext}`;
            const uploadRes = await fetch(`${apiBase}/api/media/upload`, {
              method: 'POST',
              headers: { 'x-file-name': encodeURIComponent(fileName) },
              body: blob,
            });
            const uploaded = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok || !uploaded.url) throw new Error(uploaded.error || 'Blob 落盘失败');
            url = uploaded.url;
          } catch (error) {
            localFailures.push({ id: asset.id, name: asset.name || asset.id, error: error instanceof Error ? error.message : String(error) });
            continue;
          }
        } else if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\')) {
          try {
            const stageRes = await fetch(`${apiBase}/api/media/stage-local-file/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: url, name: asset.name }),
            });
            const staged = await stageRes.json().catch(() => ({}));
            if (!stageRes.ok || !staged.id) throw new Error(staged.error || '本地文件暂存任务启动失败');
            if (importSessionKey) localStorage.setItem(importSessionKey, JSON.stringify({ active: true, stageJobId: staged.id, assetId: asset.id, progress: { current: assetIndex + 1, total: usableAssets.length, percent: 0, name: asset.name || asset.id }, failed: localFailures }));
            for (;;) {
              if (controller.signal.aborted) {
                await fetch(`${apiBase}/api/media/stage-local-file/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: staged.id }) }).catch(() => {});
                throw new DOMException('已取消导入', 'AbortError');
              }
              await new Promise(resolve => setTimeout(resolve, 200));
              const statusRes = await fetch(`${apiBase}/api/media/stage-local-file/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: staged.id }) });
              const status = await statusRes.json().catch(() => ({}));
              if (!statusRes.ok) throw new Error(status.error || '读取暂存进度失败');
              setDesktopImportProgress({
                current: assetIndex + 1, total: exportAssets.length, percent: status.progress || 0, name: asset.name || asset.id,
                loaded: status.loaded || 0, bytesTotal: status.total || 0, bytesPerSecond: status.bytesPerSecond || 0, etaSeconds: status.etaSeconds,
              });
              if (status.status === 'completed') { url = status.url; break; }
              if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error || '本地文件暂存失败');
            }
            if (importSessionKey) localStorage.setItem(importSessionKey, JSON.stringify({ active: false, progress: null, failed: localFailures }));
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            localFailures.push({ id: asset.id, name: asset.name || asset.id, error: error instanceof Error ? error.message : String(error) });
            continue;
          }
        }
        media.push({ id: asset.id, name: asset.name, type: asset.asset_type, url, sourceUrl });
      }
      const res = await fetch(`${apiBase}/api/openreel/desktop/create-project-with-timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project?.name || timeline.name || '动画项目',
          width: timeline.width,
          height: timeline.height,
          frameRate: timeline.fps,
          media,
          timeline,
          requestId: openReelRequestIdRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '创建 OpenReel 工程失败');
      const openReelFailures = Array.isArray(data.failed)
        ? data.failed.map((item: { id?: string; name?: string; error?: string }) => ({
          id: item.id || item.name || 'openreel',
          name: item.name || item.id || '素材',
          error: item.error || 'OpenReel 导入失败',
        }))
        : [];
      const allFailures = [...localFailures, ...openReelFailures];
      setFailedDesktopAssets(allFailures);
      if (importSessionKey) localStorage.setItem(importSessionKey, JSON.stringify({ active: false, progress: null, failed: allFailures }));
      if (data.failedCount > 0) {
        const examples = (data.failed || []).slice(0, 3).map((item: { name?: string; error?: string }) => `${item.name || '素材'}：${item.error || '导入失败'}`).join('；');
        toast.warning(`OpenReel 工程已保存：成功导入 ${data.importedCount}/${data.total} 个素材，${data.failedCount} 个失败。${examples ? ` ${examples}` : ''}`, { duration: 8000 });
      } else {
        toast.success(`已创建并保存 OpenReel 工程：导入 ${data.importedCount} 个素材，铺入 ${data.clipCount || 0} 个片段、${data.transitionCount || 0} 个转场`);
      }
      if (Array.isArray(data.warnings) && data.warnings.length) toast.warning(`时间线映射有 ${data.warnings.length} 条提示：${data.warnings.slice(0, 2).join('；')}`, { duration: 8000 });
      openReelRequestIdRef.current = null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') toast.info('已取消本地素材导入');
      else toast.error(error instanceof Error ? error.message : '发送到 OpenReel 失败');
    } finally {
      desktopImportAbortRef.current = null;
      setDesktopImportProgress(null);
      setSendingToDesktop(false);
    }
  };

  const cancelDesktopImport = () => {
    if (desktopImportAbortRef.current) desktopImportAbortRef.current.abort();
    if (restoredStageJobId) {
      void fetch(`${apiBase}/api/media/stage-local-file/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: restoredStageJobId }) });
    }
  };

  const retryFailedDesktopImports = async () => {
    if (!failedDesktopAssets.length) return;
    setSendingToDesktop(true);
    const controller = new AbortController();
    desktopImportAbortRef.current = controller;
    const stillFailed: Array<{ id: string; name: string; error: string }> = [];
    const retryMedia: Array<{ id: string; name: string; type: string; url: string }> = [];
    try {
      for (let index = 0; index < failedDesktopAssets.length; index++) {
        if (controller.signal.aborted) throw new DOMException('已取消重试', 'AbortError');
        const failed = failedDesktopAssets[index];
        const asset = usableAssets.find(item => item.id === failed.id);
        if (!asset?.file_url || asset.file_url.startsWith('blob:')) {
          stillFailed.push({ ...failed, error: asset?.file_url?.startsWith('blob:') ? '页面刷新后 Blob 已失效，请重新添加该素材' : '原素材已不存在' });
          continue;
        }
        let url = asset.file_url;
        setDesktopImportProgress({ current: index + 1, total: failedDesktopAssets.length, percent: 0, name: asset.name || asset.id });
        if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\')) {
          try {
            const startRes = await fetch(`${apiBase}/api/media/stage-local-file/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: url, name: asset.name }) });
            const started = await startRes.json();
            if (!startRes.ok || !started.id) throw new Error(started.error || '暂存任务启动失败');
            for (;;) {
              if (controller.signal.aborted) {
                await fetch(`${apiBase}/api/media/stage-local-file/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: started.id }) }).catch(() => {});
                throw new DOMException('已取消重试', 'AbortError');
              }
              await new Promise(resolve => setTimeout(resolve, 200));
              const statusRes = await fetch(`${apiBase}/api/media/stage-local-file/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: started.id }) });
              const status = await statusRes.json();
              if (!statusRes.ok) throw new Error(status.error || '读取重试进度失败');
              setDesktopImportProgress({ current: index + 1, total: failedDesktopAssets.length, percent: status.progress || 0, name: asset.name || asset.id, loaded: status.loaded || 0, bytesTotal: status.total || 0, bytesPerSecond: status.bytesPerSecond || 0, etaSeconds: status.etaSeconds });
              if (status.status === 'completed') { url = status.url; break; }
              if (status.status === 'failed' || status.status === 'cancelled') throw new Error(status.error || '本地文件暂存失败');
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            stillFailed.push({ id: asset.id, name: asset.name || asset.id, error: error instanceof Error ? error.message : String(error) });
            continue;
          }
        }
        retryMedia.push({ id: asset.id, name: asset.name || asset.id, type: asset.asset_type, url });
      }
      if (retryMedia.length) {
        const res = await fetch(`${apiBase}/api/openreel/desktop/import-media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media: retryMedia }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '重试导入 OpenReel 失败');
        for (const item of data.failed || []) stillFailed.push({ id: item.id, name: item.name || item.id, error: item.error || '导入失败' });
      }
      setFailedDesktopAssets(stillFailed);
      if (importSessionKey) localStorage.setItem(importSessionKey, JSON.stringify({ active: false, progress: null, failed: stillFailed }));
      if (stillFailed.length) toast.warning(`重试完成，仍有 ${stillFailed.length} 个素材失败`);
      else toast.success('失败素材已全部重新导入并保存');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') toast.info('已取消失败素材重试');
      else toast.error(error instanceof Error ? error.message : '重试失败素材失败');
    } finally {
      desktopImportAbortRef.current = null;
      setDesktopImportProgress(null);
      setSendingToDesktop(false);
    }
  };

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scissors className="w-6 h-6" /> 剪辑台
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              成片输出后的内部剪辑：分割、裁剪、变速、静音、转场，导出 H.264 MP4。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-40 h-8 text-sm"
              value={timeline.name}
              onChange={e => setTimeline(t => ({ ...t, name: e.target.value }))}
              placeholder="时间线名称"
            />
            <Button variant="outline" size="sm" onClick={ensureSaved}>
              <Save className="w-4 h-4 mr-1" /> 保存
            </Button>
            <Button size="sm" onClick={startRender} disabled={renderStatus === 'running'}>
              {renderStatus === 'running' ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
              {renderStatus === 'running' ? `导出中 ${renderPercent}%` : '导出成片'}
            </Button>
          </div>
        </div>

        {invalidTimelineClips.length > 0 && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
            时间线有 {invalidTimelineClips.length} 个本地素材文件已丢失：{invalidTimelineClips.slice(0, 4).join('、')}{invalidTimelineClips.length > 4 ? '…' : ''}。请重新组装整集或替换素材后再导出。
          </div>
        )}
        {renderStatus === 'running' && (
          <div className="h-2 w-full bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${renderPercent}%` }} />
          </div>
        )}
        {renderStatus === 'failed' && (
          // 失败信息常常是 FFmpeg 的多行原始输出，直接塞进一行里既读不了也会撑破布局。
          // 保留换行、等宽字体、限高可滚动。
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 max-h-56 overflow-auto">
            <div className="font-medium mb-1">导出失败</div>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{renderError}</pre>
          </div>
        )}
        {renderStatus === 'done' && renderOutput && (
          <div className="text-sm bg-green-500/10 border border-green-500/30 rounded px-3 py-2 flex items-center gap-3 flex-wrap">
            <span>导出完成：</span>
            <a className="underline" href={renderOutput} target="_blank" rel="noreferrer">预览</a>
            {/* 不带 download 值时文件名是服务端那串时间戳，用户拿到手认不出是哪条片子 */}
            <a className="underline" href={renderOutput}
               download={`${(timeline.name || '成片').replace(/[\\/:*?"<>|]/g, '_')}.mp4`}>
              下载
            </a>
          </div>
        )}

        {/* Desktop 为主入口；Web 内嵌与简易剪辑台只作为兼容回退。 */}
        <div className="flex items-center gap-2">
          <Button variant={mode === 'desktop' ? 'default' : 'outline'} size="sm" onClick={() => setMode('desktop')}>
            OpenReel Desktop
          </Button>
          <Button variant={mode === 'openreel' ? 'default' : 'outline'} size="sm"
                  onClick={() => setMode('openreel')}>
            Web 兼容版
          </Button>
          <Button variant={mode === 'simple' ? 'default' : 'outline'} size="sm"
                  onClick={() => setMode('simple')}>
            简易剪辑台
          </Button>
          {mode === 'desktop' && (
            <span className="text-xs text-muted-foreground">
              {desktopAvailable === null ? '正在检测桌面版…' : desktopConnected ? '桌面版已连接，可通过本地 MCP 控制编辑器' : desktopAvailable ? '已检测到桌面版' : '未检测到桌面版，可安装后重试'}
            </span>
          )}
          {mode === 'openreel' && (
            <span className="text-xs text-muted-foreground">
              在浏览器本地运行，素材不会上传；可直接粘贴本项目的素材链接导入
            </span>
          )}
        </div>

        {mode === 'desktop' ? (
          <Card>
            <CardContent className="py-10 flex flex-col items-center justify-center gap-4 text-center">
              <Scissors className="w-10 h-10 text-primary" />
              <div>
                <div className="font-semibold text-lg">使用 OpenReel Desktop 剪辑</div>
                <div className="text-sm text-muted-foreground mt-1 max-w-xl">
                  桌面版作为完整剪辑器运行。最新版 OpenReel 已提供本地 MCP 编辑接口，本项目会通过它创建/打开工程、导入素材并控制剪辑器，不再依赖未公开的命令行参数。
                </div>
              </div>
              <Button onClick={launchOpenReelDesktop} disabled={launchingDesktop}>
                {launchingDesktop ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                {desktopAvailable ? '打开 OpenReel Desktop' : '检测并打开桌面版'}
              </Button>
              <Button onClick={sendProjectToOpenReel} disabled={sendingToDesktop || loadingAssets || !projectId}>
                {sendingToDesktop ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Scissors className="w-4 h-4 mr-1" />}
                {sendingToDesktop ? '正在创建并导入素材…' : '一键去剪辑'}
              </Button>
              {(sendingToDesktop || restoredStageJobId) && (
                <Button variant="destructive" size="sm" onClick={cancelDesktopImport}>取消导入</Button>
              )}
              {desktopImportProgress && (
                <div className="w-full max-w-xl text-xs space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="truncate">{desktopImportProgress.name}（{desktopImportProgress.current}/{desktopImportProgress.total}）</span>
                    <span>{desktopImportProgress.percent}%</span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${desktopImportProgress.percent}%` }} />
                  </div>
                  {(desktopImportProgress.bytesTotal || 0) > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>已处理 {formatBytes(desktopImportProgress.loaded || 0)} / {formatBytes(desktopImportProgress.bytesTotal || 0)}</span>
                      <span>速度 {formatBytes(desktopImportProgress.bytesPerSecond || 0)}/s</span>
                      <span>预计剩余 {formatEta(desktopImportProgress.etaSeconds)}</span>
                    </div>
                  )}
                </div>
              )}
              {failedDesktopAssets.length > 0 && !sendingToDesktop && (
                <div className="w-full max-w-xl text-xs text-destructive">
                  {failedDesktopAssets.length} 个本地素材失败。
                  <Button variant="link" size="sm" className="h-auto px-1 text-xs" onClick={retryFailedDesktopImports}>仅重试失败素材</Button>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                将当前项目素材库中的 {usableAssets.length} 个图片、视频、音频创建为新的 OpenReel 工程并保存。
              </div>
              {!desktopAvailable && desktopAvailable !== null && (
                <Button variant="ghost" size="sm" onClick={() => setMode('openreel')}>暂用 Web 兼容版</Button>
              )}
            </CardContent>
          </Card>
        ) : mode === 'openreel' ? (
          <div className="rounded border overflow-hidden bg-background">
            <iframe
              title="OpenReel 剪辑台"
              src={editorUrl}
              className="w-full border-0"
              style={{ height: 'calc(100vh - 260px)', minHeight: 560 }}
              allow="autoplay; fullscreen; clipboard-read; clipboard-write"
            />
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-4">
          {/* 素材 */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center justify-between">
                素材
                <Button variant="ghost" size="sm" onClick={loadAssets}><RefreshCw className="w-3 h-3" /></Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择项目" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {scripts.length > 0 && (
                <Select value={scriptId || '__all__'} onValueChange={value => setScriptId(value === '__all__' ? '' : value)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择剧本 / 集数" /></SelectTrigger>
                  <SelectContent>
                    {scripts.length === 1 ? null : <SelectItem value="__all__">请选择剧本 / 集数</SelectItem>}
                    {scripts.map(script => <SelectItem key={script.id} value={script.id}>{script.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" className="w-full" onClick={assembleEpisodeTimeline} disabled={!projectId || assemblingEpisode || (scripts.length > 1 && !scriptId)}>
                {assemblingEpisode ? '正在组装整集…' : '按分镜一键组装整集'}
              </Button>
              {assemblyMissing.length > 0 && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] space-y-0.5">
                  <div className="font-medium">缺失素材 {assemblyMissing.length} 项</div>
                  {assemblyMissing.slice(0, 8).map((item, index) => <div key={`${item}_${index}`}>{item}</div>)}
                  {assemblyMissing.length > 8 && <div>还有 {assemblyMissing.length - 8} 项未显示</div>}
                </div>
              )}
              {loadingAssets ? (
                <Skeleton className="h-24 w-full" />
              ) : usableAssets.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">该项目暂无可用素材</p>
              ) : (
                <div className="space-y-1 max-h-[520px] overflow-y-auto">
                  {usableAssets.map(a => (
                    <button
                      key={a.id}
                      onClick={() => addAssetToTimeline(a)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary text-left text-xs"
                    >
                      {assetIcon(a.asset_type)}
                      <span className="truncate flex-1">{a.name}</span>
                      <Plus className="w-3 h-3 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 时间线 */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center justify-between">
                时间线
                <span className="text-xs text-muted-foreground font-normal">
                  总时长 {fmtTime(totalDuration)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {timeline.tracks.map(track => (
                <div key={track.id}>
                  <div className="text-xs text-muted-foreground mb-1">
                    {track.type === 'video' ? '视频轨' : '音频轨'}
                  </div>
                  <div className="relative h-14 bg-muted/50 rounded border border-border overflow-x-auto">
                    {track.clips.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                        从左侧素材点击加入
                      </div>
                    ) : (
                      <div className="relative h-full min-w-full" style={{ minWidth: `${Math.max(100, totalDuration * 40)}px` }}>
                        {track.clips.map(clip => {
                          const left = totalDuration > 0 ? (clip.start / totalDuration) * 100 : 0;
                          const width = totalDuration > 0 ? (clip.duration / totalDuration) * 100 : 10;
                          const active = clip.id === selectedClipId;
                          return (
                            <button
                              key={clip.id}
                              onClick={() => setSelectedClipId(clip.id)}
                              className={`absolute top-1 bottom-1 rounded px-1 text-[10px] text-left overflow-hidden border transition-colors ${
                                active
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : track.type === 'video'
                                    ? 'bg-blue-500/30 border-blue-500/50 hover:bg-blue-500/40'
                                    : 'bg-amber-500/30 border-amber-500/50 hover:bg-amber-500/40'
                              }`}
                              style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
                              title={`${clip.name || clip.src} · ${fmtTime(clip.duration)}`}
                            >
                              <div className="truncate">{clip.name || '片段'}</div>
                              <div className="opacity-70">{fmtTime(clip.duration)}{clip.speed !== 1 ? ` ×${clip.speed}` : ''}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-2 flex-wrap pt-1">
                <Button variant="outline" size="sm" onClick={handleSplit} disabled={!selectedClip}>
                  <Split className="w-3 h-3 mr-1" /> 分割
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleTrim('head')} disabled={!selectedClip}>
                  裁开头
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleTrim('tail')} disabled={!selectedClip}>
                  裁结尾
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleSwap('up')} disabled={!selectedClip}>
                  <ArrowUp className="w-3 h-3 mr-1" /> 上移
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleSwap('down')} disabled={!selectedClip}>
                  <ArrowDown className="w-3 h-3 mr-1" /> 下移
                </Button>
                <Button variant="outline" size="sm" onClick={handleMerge} disabled={!selectedClip}>
                  <Merge className="w-3 h-3 mr-1" /> 合并
                </Button>
                <Button variant="outline" size="sm" onClick={removeSelected} disabled={!selectedClip}>
                  <Trash2 className="w-3 h-3 mr-1" /> 删除
                </Button>
                {selectedClip && (
                  <Badge variant="secondary" className="text-xs">
                    已选 {fmtTime(selectedClip.duration)} · 起点 {fmtTime(selectedClip.start)}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 属性面板 */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">片段属性</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedClip ? (
                <p className="text-xs text-muted-foreground py-6 text-center">在时间线上选择一个片段</p>
              ) : (
                <>
                  <div className="text-xs break-all text-muted-foreground">{selectedClip.name || selectedClip.src}</div>

                  <div>
                    <Label className="text-xs flex items-center gap-1"><Gauge className="w-3 h-3" /> 速度</Label>
                    <Select value={String(selectedClip.speed)} onValueChange={v => setSpeedForSelected(Number(v))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['0.25', '0.5', '0.75', '1', '1.25', '1.5', '2', '3'].map(v => (
                          <SelectItem key={v} value={v}>{v}×</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1">变速后时间线时长会按倍率反向缩放</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1">
                      {selectedClip.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />} 静音
                    </Label>
                    <Switch checked={!!selectedClip.muted} onCheckedChange={v => patchSelected({ muted: v })} />
                  </div>

                  <div>
                    <Label className="text-xs">音量 {selectedClip.volume.toFixed(2)}</Label>
                    <input
                      type="range" min={0} max={2} step={0.05}
                      value={selectedClip.volume}
                      onChange={e => patchSelected({ volume: Number(e.target.value) })}
                      className="w-full mt-1"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs">反转播放</Label>
                    <Switch checked={!!selectedClip.reversed} onCheckedChange={v => patchSelected({ reversed: v })} />
                  </div>

                  <div>
                    <Label className="text-xs">淡入时长（秒）</Label>
                    <Input
                      className="mt-1 h-8 text-xs" type="number" min={0} step={0.1}
                      value={selectedClip.transitionIn?.duration ?? 0}
                      onChange={e => patchSelected({
                        transitionIn: Number(e.target.value) > 0
                          ? { type: 'fade', duration: Number(e.target.value) }
                          : null,
                      })}
                    />
                  </div>

                  <div className="pt-2 border-t border-border space-y-1 text-[11px] text-muted-foreground">
                    <div>时间线起点：{fmtTime(selectedClip.start)}</div>
                    <div>时长：{fmtTime(selectedClip.duration)}</div>
                    <div>源内偏移：{fmtTime(selectedClip.sourceStart)}</div>
                  </div>

                  {selectedClip.src.startsWith('/api/files/') && selectedClip.type === 'video' && (
                    <video src={selectedClip.src} controls className="w-full rounded border border-border" />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
        )}

        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Play className="w-3 h-3" />
          提示：导出在本机完成，不上传任何内容；成片与素材都存放在应用的数据目录中。
        </div>
      </div>
    </MainLayout>
  );
}
