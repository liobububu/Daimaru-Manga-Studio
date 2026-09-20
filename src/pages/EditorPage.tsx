import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  RefreshCw, Film, Music, Image as ImageIcon, Save, Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { localSupabase } from '@/db/client';
import { getAssets } from '@/services/api';
import type { Asset } from '@/types/types';

const api = localSupabase.api;

interface Clip {
  id: string;
  type: 'video' | 'audio' | 'image';
  src: string;
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

export default function EditorPage() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

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
        if (list.length > 0) setProjectId(list[0].id);
      } catch {
        /* 项目为空时忽略 */
      }
    })();
  }, []);

  const loadAssets = useCallback(async () => {
    if (!projectId) { setAssets([]); return; }
    setLoadingAssets(true);
    try {
      const data = await getAssets(projectId);
      setAssets(data.filter(a => a.file_url));
    } catch (e) {
      toast.error(`加载素材失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setLoadingAssets(false);
    }
  }, [projectId]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const usableAssets = useMemo(
    () => assets.filter(a => ['video', 'image', 'audio'].includes(a.asset_type)),
    [assets],
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
    try {
      const res = await api.post<{ data: { timeline: Timeline } }>('/api/edit/command', {
        timelineId: timeline.id,
        cmd,
      });
      if (res.data?.timeline) setTimeline(res.data.timeline);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [timeline.id]);

  /** 先确保时间线已保存（命令路由要求时间线存在） */
  const ensureSaved = useCallback(async () => {
    const res = await api.post<{ data: { id: string } }>('/api/edit/timeline/save', {
      id: timeline.id,
      name: timeline.name,
      project_id: projectId || null,
      timeline,
    });
    return res.data?.id || timeline.id;
  }, [timeline, projectId]);

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
    setSelectedClipId(null);
  };

  // ── 渲染导出 ─────────────────────────────────────────────
  const startRender = async () => {
    if (timeline.tracks.every(t => t.clips.length === 0)) {
      toast.error('时间线是空的');
      return;
    }
    setRenderStatus('running');
    setRenderPercent(0);
    setRenderError('');
    setRenderOutput('');
    try {
      await ensureSaved();
      const res = await api.post<{ data: { jobId: string } }>('/api/edit/render', {
        timelineId: timeline.id,
        name: timeline.name,
      });
      const jobId = res.data?.jobId;
      if (!jobId) throw new Error('未返回任务 ID');

      pollRef.current = setInterval(async () => {
        try {
          const j = await api.get<{
            data: { status: string; percent: number; output?: string; error?: string };
          }>(`/api/edit/job?id=${jobId}`);
          const job = j.data;
          setRenderPercent(job.percent || 0);
          if (job.status === 'done') {
            if (pollRef.current) clearInterval(pollRef.current);
            setRenderStatus('done');
            setRenderOutput(job.output || '');
            toast.success('导出完成');
          } else if (job.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setRenderStatus('failed');
            setRenderError(job.error || '渲染失败');
          }
        } catch (e) {
          if (pollRef.current) clearInterval(pollRef.current);
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

  const assetIcon = (type: string) => {
    if (type === 'video') return <Film className="w-4 h-4" />;
    if (type === 'audio') return <Music className="w-4 h-4" />;
    return <ImageIcon className="w-4 h-4" />;
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

        {renderStatus === 'running' && (
          <div className="h-2 w-full bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${renderPercent}%` }} />
          </div>
        )}
        {renderStatus === 'failed' && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
            导出失败：{renderError}
          </div>
        )}
        {renderStatus === 'done' && renderOutput && (
          <div className="text-sm bg-green-500/10 border border-green-500/30 rounded px-3 py-2 flex items-center gap-3 flex-wrap">
            <span>导出完成：</span>
            <a className="underline" href={renderOutput} target="_blank" rel="noreferrer">预览</a>
            <a className="underline" href={renderOutput} download>下载</a>
          </div>
        )}

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

        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Play className="w-3 h-3" />
          提示：导出在本机完成，不上传任何内容；成片与素材都存放在应用的数据目录中。
        </div>
      </div>
    </MainLayout>
  );
}
