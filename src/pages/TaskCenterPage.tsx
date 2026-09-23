import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock3, Film, Image, Music, RefreshCw, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useProject } from '@/contexts/ProjectContext';
import { checkLocalMediaFiles, getAssets, getScripts, getStoryboards, getVideoTasks } from '@/services/api';
import type { Asset, Script, Storyboard, VideoTask } from '@/types/types';
import { VIDEO_STATUS_LABELS } from '@/types/types';
import { resolveEpisodeStage, sortEpisodes, storyboardLoadKey } from '../../shared/episode-flow.js';

export default function TaskCenterPage() {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [scriptId, setScriptId] = useState('');
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [localFileState, setLocalFileState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const loadKeyRef = useRef('');
  const projectLoadRef = useRef('');
  const currentProjectRef = useRef(selectedProjectId || '');
  currentProjectRef.current = selectedProjectId || '';

  async function load() {
    if (!selectedProjectId) { projectLoadRef.current = ''; setScripts([]); setStoryboards([]); setTasks([]); setAssets([]); return; }
    const projectId = selectedProjectId;
    projectLoadRef.current = projectId;
    setLoading(true);
    try {
      const [rawScripts, taskList, assetList] = await Promise.all([getScripts(projectId), getVideoTasks(projectId), getAssets(projectId)]);
      if (projectLoadRef.current !== projectId) return;
      const scriptList = sortEpisodes(rawScripts) as Script[];
      setScripts(scriptList);
      const nextScriptId = scriptId && scriptList.some(item => item.id === scriptId) ? scriptId : (scriptList[0]?.id || '');
      setScriptId(nextScriptId);
      setTasks(taskList);
      setAssets(assetList);
      const localUrls = assetList.map(asset => asset.file_url || '').filter(url => url.startsWith('/api/files/'));
      const checks = await checkLocalMediaFiles(localUrls).catch(() => ({}));
      if (projectLoadRef.current !== projectId) return;
      setLocalFileState(Object.fromEntries(Object.entries(checks).map(([url, state]) => [url, state.exists])));
      if (nextScriptId) {
        const requestKey = storyboardLoadKey(projectId, nextScriptId);
        loadKeyRef.current = requestKey;
        const shots = await getStoryboards(projectId, nextScriptId);
        if (loadKeyRef.current === requestKey && projectLoadRef.current === projectId) setStoryboards(shots);
      } else setStoryboards([]);
    } finally { if (projectLoadRef.current === projectId) setLoading(false); }
  }

  useEffect(() => { load(); }, [selectedProjectId]);
  useEffect(() => {
    if (!selectedProjectId || !scriptId) { setStoryboards([]); return; }
    const requestKey = storyboardLoadKey(selectedProjectId, scriptId);
    loadKeyRef.current = requestKey;
    getStoryboards(selectedProjectId, scriptId).then(items => {
      if (loadKeyRef.current === requestKey && projectLoadRef.current === selectedProjectId) setStoryboards(items);
    }).catch(() => { if (loadKeyRef.current === requestKey) setStoryboards([]); });
  }, [selectedProjectId, scriptId]);

  const scopedTasks = useMemo(() => {
    const ids = new Set(storyboards.map(item => item.id));
    return tasks.filter(task => !task.storyboard_id || ids.has(task.storyboard_id));
  }, [tasks, storyboards]);
  const taskByShot = useMemo(() => {
    const map = new Map<string, VideoTask[]>();
    for (const task of scopedTasks) {
      if (!task.storyboard_id) continue;
      map.set(task.storyboard_id, [...(map.get(task.storyboard_id) || []), task]);
    }
    return map;
  }, [scopedTasks]);

  const assetsById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const assetUsable = (id?: string) => {
    if (!id) return false;
    const url = assetsById.get(id)?.file_url;
    if (!url) return false;
    if (url.startsWith('/api/files/')) return localFileState[url] === true;
    return true;
  };

  const total = storyboards.length;
  const imageDone = storyboards.filter(item => assetUsable(item.image_asset_id)).length;
  const videoDone = storyboards.filter(item => assetUsable(item.video_asset_id)).length;
  const audioNeeded = storyboards.filter(item => !!item.voiceover?.trim() || !!item.dialogue?.trim()).length;
  const audioDone = storyboards.filter(item => (!item.voiceover?.trim() || assetUsable(item.voiceover_asset_id)) && (!item.dialogue?.trim() || assetUsable(item.dialogue_asset_id))).length;
  const complete = storyboards.filter(item => assetUsable(item.video_asset_id) && (!item.voiceover?.trim() || assetUsable(item.voiceover_asset_id)) && (!item.dialogue?.trim() || assetUsable(item.dialogue_asset_id))).length;
  const percent = total ? Math.round(complete / total * 100) : 0;
  const currentScriptIndex = scripts.findIndex(item => item.id === scriptId);
  const nextScript = currentScriptIndex >= 0 ? scripts[currentScriptIndex + 1] : undefined;
  const episodeReadyForEdit = total > 0 && videoDone === total && audioDone === total;
  const todoQueue = useMemo(() => storyboards.flatMap(shot => {
    const latest = (taskByShot.get(shot.id) || [])[0];
    const failedVideo = !!latest && ['failed', 'expired', 'timeout', 'storage_failed'].includes(latest.status);
    const items: Array<{ shot: Storyboard; target: 'image' | 'video' | 'audio'; label: string }> = [];
    const videoUsable = assetUsable(shot.video_asset_id);
    if (!videoUsable && !assetUsable(shot.image_asset_id)) items.push({ shot, target: 'image', label: shot.image_asset_id ? '图片素材失效' : '缺图片' });
    if ((!videoUsable && assetUsable(shot.image_asset_id)) || failedVideo) items.push({ shot, target: 'video', label: failedVideo ? '视频失败' : shot.video_asset_id ? '视频素材失效' : '缺视频' });
    if ((!!shot.voiceover?.trim() && !assetUsable(shot.voiceover_asset_id)) || (!!shot.dialogue?.trim() && !assetUsable(shot.dialogue_asset_id))) items.push({ shot, target: 'audio', label: '音频缺失/失效' });
    return items;
  }), [storyboards, taskByShot]);

  function openTodoQueue(target: 'image' | 'video') {
    const shots = storyboards.filter(shot => todoQueue.some(item => item.target === target && item.shot.id === shot.id));
    if (!shots.length) return;
    const path = target === 'image' ? '/images' : '/videos';
    navigate(path, { state: { storyboard: shots[0], storyboardQueue: shots.map(shot => shot.id) } });
  }

  function openShot(shot: Storyboard, target: 'image' | 'video' | 'audio') {
    if (target === 'image' || target === 'video') {
      const queue = storyboards
        .filter(item => todoQueue.some(todo => todo.target === target && todo.shot.id === item.id))
        .map(item => item.id);
      navigate(target === 'image' ? '/images' : '/videos', { state: { storyboard: shot, storyboardQueue: queue.length ? queue : [shot.id] } });
    }
    if (target === 'audio') navigate('/audio-production', { state: { tab: 'storyboard', storyboardId: shot.id, type: shot.voiceover?.trim() && !assetUsable(shot.voiceover_asset_id) ? 'voiceover' : 'dialogue' } });
  }

  async function continueToNextEpisode() {
    if (!selectedProjectId || !nextScript) return;
    const projectId = selectedProjectId;
    if (!nextScript.content?.trim()) {
      if (currentProjectRef.current === projectId) navigate('/scripts', { state: { script: nextScript } });
      return;
    }
    const nextShots = await getStoryboards(projectId, nextScript.id);
    if (currentProjectRef.current !== projectId) return;
    setScriptId(nextScript.id);
    setStoryboards(nextShots);
    if (!nextShots.length) {
      navigate('/storyboards', { state: { script: nextScript, content: nextScript.content || '' } });
      return;
    }
    const stage = resolveEpisodeStage(nextScript, nextShots, assetUsable);
    if (stage.stage === 'image' && stage.shot) {
      navigate('/images', { state: { storyboard: stage.shot, storyboardQueue: nextShots.filter(shot => !assetUsable(shot.video_asset_id) && !assetUsable(shot.image_asset_id)).map(shot => shot.id) } });
      return;
    }
    if (stage.stage === 'video' && stage.shot) {
      navigate('/videos', { state: { storyboard: stage.shot, storyboardQueue: nextShots.filter(shot => !assetUsable(shot.video_asset_id) && assetUsable(shot.image_asset_id)).map(shot => shot.id) } });
      return;
    }
    if (stage.stage === 'audio' && stage.shot) {
      navigate('/audio-production', { state: { tab: 'storyboard', storyboardId: stage.shot.id, type: stage.shot.voiceover?.trim() && !assetUsable(stage.shot.voiceover_asset_id) ? 'voiceover' : 'dialogue' } });
      return;
    }
    navigate('/editor', { state: { projectId, scriptId: nextScript.id } });
  }

  return <div className="p-6 space-y-5">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold">任务中心</h1><p className="text-sm text-muted-foreground mt-1">按集数和镜头检查生产完成度，直接处理缺失与失败任务。</p></div>
      <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" />刷新</Button>
    </div>
    {!selectedProjectId ? <Card><CardContent className="py-10 text-center text-muted-foreground">请先选择项目</CardContent></Card> : <>
      {scripts.length > 0 && <Select value={scriptId} onValueChange={setScriptId}>
        <SelectTrigger className="max-w-sm"><SelectValue placeholder="选择剧本 / 集数" /></SelectTrigger>
        <SelectContent>{scripts.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent>
      </Select>}
      <Card><CardHeader><CardTitle className="text-base">整集完成度 · {complete}/{total} 镜</CardTitle></CardHeader><CardContent className="space-y-3">
        <Progress value={percent} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><Image className="inline w-4 h-4 mr-1" />图片 {imageDone}/{total}</div>
          <div><Video className="inline w-4 h-4 mr-1" />视频 {videoDone}/{total}</div>
          <div><Music className="inline w-4 h-4 mr-1" />音频 {audioDone}/{total}{audioNeeded ? ` · ${audioNeeded}镜需要` : ''}</div>
          <div><CheckCircle2 className="inline w-4 h-4 mr-1" />完整 {percent}%</div>
        </div>
        {episodeReadyForEdit && <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => navigate('/editor', { state: { projectId: selectedProjectId, scriptId } })}>进入本集剪辑台</Button>
          {nextScript && <Button size="sm" variant="outline" onClick={continueToNextEpisode}>继续下一集 · {nextScript.title}</Button>}
        </div>}
      </CardContent></Card>
      {todoQueue.length > 0 && <Card><CardHeader><CardTitle className="text-base">本集待办 · {todoQueue.length} 项</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-2">
        <Button onClick={() => openShot(todoQueue[0].shot, todoQueue[0].target)}>继续处理下一处 · 镜{todoQueue[0].shot.shot_index} {todoQueue[0].label}</Button>
        {todoQueue.some(item => item.target === 'image') && <Button variant="outline" onClick={() => openTodoQueue('image')}>批量补缺图片</Button>}
        {todoQueue.some(item => item.target === 'video') && <Button variant="outline" onClick={() => openTodoQueue('video')}>批量补缺/失败视频</Button>}
        <div className="w-full text-xs text-muted-foreground mt-1">按镜头顺序汇总缺图片、缺视频、视频失败和缺音频；图片/视频会只把待处理镜头组成生产队列。</div>
      </CardContent></Card>}
      <div className="space-y-2">
        {storyboards.map(shot => {
          const shotTasks = taskByShot.get(shot.id) || [];
          const latest = shotTasks[0];
          const failed = latest && ['failed', 'expired', 'timeout', 'storage_failed'].includes(latest.status);
          const missingImage = !assetUsable(shot.image_asset_id);
          const missingVideo = !assetUsable(shot.video_asset_id);
          const missingAudio = (!!shot.voiceover?.trim() && !assetUsable(shot.voiceover_asset_id)) || (!!shot.dialogue?.trim() && !assetUsable(shot.dialogue_asset_id));
          const done = !missingVideo && !missingAudio;
          return <Card key={shot.id}><CardContent className="py-3 flex flex-wrap items-center gap-3">
            <div className="w-20 font-medium">镜 {shot.shot_index}</div>
            <div className="flex-1 min-w-52 text-sm text-muted-foreground truncate">{shot.visual_description || shot.video_prompt || shot.image_prompt || '未填写镜头描述'}</div>
            <div className="flex items-center gap-1.5">
              <Badge variant={missingImage ? 'outline' : 'secondary'}>图 {missingImage ? '缺' : '✓'}</Badge>
              <Badge variant={missingVideo ? 'outline' : 'secondary'}>视频 {missingVideo ? '缺' : '✓'}</Badge>
              {missingAudio && <Badge variant="outline">音频缺</Badge>}
              {latest && <Badge variant={failed ? 'destructive' : 'secondary'}>{VIDEO_STATUS_LABELS[latest.status]}{latest.progress ? ` ${latest.progress}%` : ''}</Badge>}
              {done && <CheckCircle2 className="w-4 h-4" />}
              {failed && <AlertTriangle className="w-4 h-4" />}
              {latest && ['submitted', 'processing', 'fetching', 'pending'].includes(latest.status) && <Clock3 className="w-4 h-4" />}
            </div>
            <div className="flex gap-1">
              {missingImage && <Button size="sm" variant="outline" onClick={() => openShot(shot, 'image')}>补图片</Button>}
              {(missingVideo || failed) && <Button size="sm" variant="outline" onClick={() => openShot(shot, 'video')}>{failed ? '重做视频' : '补视频'}</Button>}
              {missingAudio && <Button size="sm" variant="outline" onClick={() => openShot(shot, 'audio')}>补音频</Button>}
            </div>
          </CardContent></Card>;
        })}
        {!loading && total === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground"><Film className="w-5 h-5 inline mr-2" />当前范围暂无分镜</CardContent></Card>}
      </div>
    </>}
  </div>;
}
