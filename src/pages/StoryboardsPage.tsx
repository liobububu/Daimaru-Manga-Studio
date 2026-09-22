import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import ModelSelector from '@/components/common/ModelSelector';
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Film, Sparkles, Plus, Trash2, Edit, Copy, Download, Image, Video, ChevronRight, Mic, Play, Pause, Loader2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { getStoryboards, createStoryboards, createStoryboard, updateStoryboard, deleteStoryboard, callAiGenerate, buildPromptFromTemplate, parseJsonSafely, getPromptTemplates, getScripts, bindStoryboardAudio } from '@/services/api';
import type { Storyboard, Script, PromptTemplate } from '@/types/types';
import { ASPECT_RATIO_OPTIONS } from '@/types/types';

const SHOT_TYPES = ['特写', '近景', '中景', '远景', '全景', '俯拍', '仰拍', '空镜'];
const CAMERA_MOVEMENTS = ['固定', '推进', '拉远', '横移', '旋转', '手持', '跟随'];
const ART_STYLES = ['写实', '动漫', '水彩', '油画', '扁平', '像素', '赛博朋克', '国风'];

interface StoryboardRaw {
  shot_index?: number;
  duration?: string;
  shot_type?: string;
  camera_movement?: string;
  visual_description?: string;
  character_action?: string;
  expression?: string;
  dialogue?: string;
  voiceover?: string;
  sound_effect?: string;
  image_prompt?: string;
  video_prompt?: string;
}

function ShotBadge({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <Badge variant="outline" className="text-xs">{label}：{value}</Badge>;
}

export default function StoryboardsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);

  // 参数
  const [scriptInput, setScriptInput] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [shotCount, setShotCount] = useState(8);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [cameraStyle] = useState('固定');
  const [artStyle, setArtStyle] = useState('动漫');
  const [modelId, setModelId] = useState('');
  const [apiConfigId, setApiConfigId] = useState('');
  const [templateId] = useState('');

  // 编辑
  const [editShot, setEditShot] = useState<Storyboard | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());

  // 音频生成状态：{ [storyboardId_type]: 'generating' | 'done' | 'error' }
  const [audioGenStates] = useState<Record<string, 'generating' | 'done' | 'error'>>({});
  // 音频播放状态
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRefs: Record<string, HTMLAudioElement | null> = {};

  // 从剧本页跳转
  const passedScript = (location.state as { script?: Script; content?: string })?.script;
  const passedContent = (location.state as { content?: string })?.content;

  useEffect(() => {
    if (passedContent) setScriptInput(passedContent);
    if (passedScript) setSelectedScriptId(passedScript.id);
  }, [passedContent, passedScript]);

  const loadStoryboards = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await getStoryboards(selectedProjectId, selectedScriptId || undefined);
      setStoryboards(data);
    } catch { toast.error('加载分镜失败'); }
    finally { setLoading(false); }
  }, [selectedProjectId, selectedScriptId]);

  useEffect(() => { loadStoryboards(); }, [loadStoryboards]);

  useEffect(() => {
    if (selectedProjectId) {
      getScripts(selectedProjectId).then(setScripts).catch(() => {});
    }
    getPromptTemplates('storyboard_generation').then(setTemplates).catch(() => {});
  }, [selectedProjectId]);

  async function handleGenerate() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!modelId) { toast.error('请先选择模型'); return; }
    if (!scriptInput.trim()) { toast.error('请填写剧本内容'); return; }

    setGenerating(true);
    try {
      let prompt = '';
      const selectedTemplate = templates.find(t => t.id === templateId);
      if (selectedTemplate) {
        prompt = buildPromptFromTemplate(selectedTemplate.content, {
          script: scriptInput, count: String(shotCount), aspect_ratio: aspectRatio, art_style: artStyle,
        });
      } else {
        prompt = `你是一位专业的分镜脚本师。根据以下剧本内容，生成${shotCount}个分镜脚本。

剧本内容：
${scriptInput}

分镜要求：
- 视频比例：${aspectRatio}
- 画风：${artStyle}
- 运镜风格：${cameraStyle}

请以JSON数组格式输出，每个分镜包含以下字段：
[{
  "shot_index": 1,
  "duration": "3秒",
  "shot_type": "${SHOT_TYPES[0]}",
  "camera_movement": "${cameraStyle}",
  "visual_description": "画面描述",
  "character_action": "人物动作",
  "expression": "表情",
  "dialogue": "台词",
  "voiceover": "旁白",
  "sound_effect": "音效",
  "image_prompt": "英文图片生成提示词",
  "video_prompt": "视频生成提示词"
}]

请直接返回JSON数组。`;
      }

      const result = await callAiGenerate(apiConfigId, modelId, prompt);
      const parsed = parseJsonSafely<StoryboardRaw[]>(result);
      if (!parsed || !Array.isArray(parsed)) {
        const preview = result ? result.slice(0, 200) : '（空响应）';
        toast.error(`解析失败，模型返回内容: ${preview}`);
        return;
      }

      const toSave = parsed.map((item, i) => ({
        project_id: selectedProjectId,
        script_id: selectedScriptId || undefined,
        shot_index: item.shot_index || i + 1,
        duration: item.duration || '3秒',
        shot_type: item.shot_type || '',
        camera_movement: item.camera_movement || '',
        visual_description: item.visual_description || '',
        character_action: item.character_action || '',
        expression: item.expression || '',
        dialogue: item.dialogue || '',
        voiceover: item.voiceover || '',
        sound_effect: item.sound_effect || '',
        image_prompt: item.image_prompt || '',
        video_prompt: item.video_prompt || '',
      }));

      await createStoryboards(toSave);
      toast.success(`成功生成 ${parsed.length} 个分镜`);
      await loadStoryboards();
    } catch (e) {
      toast.error(`生成失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAddShot() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    const maxIndex = storyboards.reduce((m, s) => Math.max(m, s.shot_index), 0);
    const newShot = await createStoryboard({
      project_id: selectedProjectId,
      script_id: selectedScriptId || undefined,
      shot_index: maxIndex + 1,
      duration: '3秒',
    });
    setStoryboards(prev => [...prev, newShot]);
  }

  async function handleDeleteShot() {
    if (!deleteId) return;
    await deleteStoryboard(deleteId);
    setStoryboards(prev => prev.filter(s => s.id !== deleteId));
    setDeleteId(null);
    toast.success('已删除');
  }

  function toggleShotSelection(id: string) {
    setSelectedShotIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function selectedShots() { return storyboards.filter(s => selectedShotIds.has(s.id)); }

  function batchGoToImages() {
    const shots = selectedShots();
    if (!shots.length) { toast.error('请先选择分镜'); return; }
    const first = shots.find(s => !s.image_asset_id) || shots[0];
    navigate('/images', { state: { storyboard: first, storyboardQueue: shots.map(s => s.id) } });
    toast.info(`已带入 ${shots.length} 个分镜，先处理第 ${first.shot_index} 镜`);
  }

  function batchGoToVideos() {
    const shots = selectedShots();
    if (!shots.length) { toast.error('请先选择分镜'); return; }
    const first = shots.find(s => !s.video_asset_id) || shots[0];
    navigate('/videos', { state: { storyboard: first, storyboardQueue: shots.map(s => s.id) } });
    toast.info(`已带入 ${shots.length} 个分镜，先处理第 ${first.shot_index} 镜`);
  }

  async function handleSaveEdit() {
    if (!editShot) return;
    await updateStoryboard(editShot.id, editShot);
    setStoryboards(prev => prev.map(s => s.id === editShot.id ? editShot : s));
    setEditOpen(false);
    toast.success('已保存');
  }

  function handleCopyShot(s: Storyboard) {
    const text = `【分镜 ${s.shot_index}】\n画面：${s.visual_description}\n台词：${s.dialogue}\n旁白：${s.voiceover}\n图片提示词：${s.image_prompt}\n视频提示词：${s.video_prompt}`;
    navigator.clipboard.writeText(text);
    toast.success('已复制');
  }

  async function handleGenerateAudio(s: Storyboard, type: 'voiceover' | 'dialogue') {
    const text = type === 'voiceover' ? s.voiceover : s.dialogue;
    if (!text?.trim()) {
      toast.error(type === 'voiceover' ? '该分镜没有旁白内容' : '该分镜没有台词内容');
      return;
    }
    // 引导用户到音频制作页配置语音模型后批量配音
    navigate('/audio-production', { state: { tab: 'storyboard', storyboardId: s.id, type } });
    toast.info('请在「音频制作 › 分镜配音」选择语音模型后生成');
  }

  async function handleUnbindAudio(s: Storyboard, type: 'voiceover' | 'dialogue') {
    try {
      await bindStoryboardAudio(s.id, null, type);
      toast.success('已解绑音频');
      await loadStoryboards();
    } catch {
      toast.error('解绑失败');
    }
  }

  function handlePlayAudio(key: string, url: string) {
    const existing = audioRefs[key];
    if (playingKey === key && existing) {
      existing.pause();
      setPlayingKey(null);
      return;
    }
    if (playingKey && audioRefs[playingKey]) {
      audioRefs[playingKey]?.pause();
    }
    const audio = new Audio(url);
    audioRefs[key] = audio;
    audio.onended = () => setPlayingKey(null);
    audio.play().then(() => setPlayingKey(key)).catch(() => toast.error('播放失败'));
  }

  function handleExport(format: 'txt' | 'md' | 'csv') {
    let content = '';
    if (format === 'csv') {
      content = '序号,时长,景别,运镜,画面描述,台词,旁白,图片提示词,视频提示词\n';
      content += storyboards.map(s =>
        [s.shot_index, s.duration, s.shot_type, s.camera_movement,
          `"${s.visual_description}"`, `"${s.dialogue}"`, `"${s.voiceover}"`,
          `"${s.image_prompt}"`, `"${s.video_prompt}"`].join(','),
      ).join('\n');
    } else {
      content = storyboards.map(s =>
        format === 'md'
          ? `## 分镜 ${s.shot_index}\n- 时长：${s.duration}  景别：${s.shot_type}  运镜：${s.camera_movement}\n- 画面：${s.visual_description}\n- 动作：${s.character_action}  表情：${s.expression}\n- 台词：${s.dialogue}\n- 旁白：${s.voiceover}\n- 图片提示词：${s.image_prompt}\n- 视频提示词：${s.video_prompt}\n`
          : `分镜 ${s.shot_index}\n时长：${s.duration} / 景别：${s.shot_type} / 运镜：${s.camera_movement}\n画面：${s.visual_description}\n台词：${s.dialogue}\n旁白：${s.voiceover}\n图片提示词：${s.image_prompt}\n视频提示词：${s.video_prompt}\n\n`,
      ).join('\n---\n\n');
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `分镜脚本.${format}`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Film className="w-5 h-5 text-purple-400" />分镜脚本生成
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {['txt','md','csv'].map(f => (
              <Button key={f} variant="secondary" size="sm" onClick={() => handleExport(f as 'txt'|'md'|'csv')}>
                <Download className="w-3 h-3 mr-1" />{f.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* 参数面板 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">生成参数</h2></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><Label>所属项目</Label><ProjectSelector className="mt-1 w-full" /></div>
              <div><Label>使用模型</Label>
                <ModelSelector functionKey="storyboard_generation" requiredCapability="text_generation" value={modelId} onChange={(mid, acid) => { setModelId(mid); setApiConfigId(acid); }} className="mt-1 w-full" />
              </div>
              <div><Label>从剧本库选择</Label>
                <Select value={selectedScriptId} onValueChange={id => {
                  setSelectedScriptId(id);
                  const s = scripts.find(x => x.id === id);
                  if (s?.content) setScriptInput(s.content);
                }}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue placeholder="手动粘贴剧本" /></SelectTrigger>
                  <SelectContent>
                    {scripts.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>分镜数量：{shotCount}</Label>
                <Input type="number" className="mt-1" min={1} max={50} value={shotCount} onChange={e => setShotCount(Number(e.target.value))} />
              </div>
              <div><Label>视频比例</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASPECT_RATIO_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>画风</Label>
                <Select value={artStyle} onValueChange={setArtStyle}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ART_STYLES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>剧本内容（粘贴文本）</Label>
              <Textarea className="mt-1" rows={4} value={scriptInput} onChange={e => setScriptInput(e.target.value)} placeholder="粘贴剧本内容..." />
            </div>
            <Button className="w-full md:w-auto" onClick={handleGenerate} disabled={generating}>
              <Sparkles className="w-4 h-4 mr-2" />{generating ? '生成中…' : '生成分镜'}
            </Button>
          </CardContent>
        </Card>

        {/* 分镜列表 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{storyboards.length} 个分镜</h2>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {selectedShotIds.size > 0 && <>
                <span className="text-xs text-muted-foreground">已选 {selectedShotIds.size} 镜</span>
                <Button size="sm" variant="secondary" onClick={batchGoToImages}>批量生图</Button>
                <Button size="sm" variant="secondary" onClick={batchGoToVideos}>批量出片</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedShotIds(new Set())}>取消选择</Button>
              </>}
              <Button size="sm" variant="secondary" onClick={() => setSelectedShotIds(new Set(storyboards.map(s => s.id)))}>全选</Button>
              <Button size="sm" variant="secondary" onClick={handleAddShot}><Plus className="w-4 h-4 mr-1" />新增分镜</Button>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : storyboards.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Film className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>还没有分镜，填写参数后点击生成</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {storyboards.map(s => (
                <Card key={s.id} className={`bg-card border-border hover:border-primary/30 transition-colors ${selectedShotIds.has(s.id) ? 'ring-1 ring-primary border-primary/50' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" className="accent-primary" checked={selectedShotIds.has(s.id)} onChange={() => toggleShotSelection(s.id)} aria-label={`选择分镜 ${s.shot_index}`} />
                        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                          <span className="text-primary text-sm font-bold">{s.shot_index}</span>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          <ShotBadge label="时长" value={s.duration} />
                          <ShotBadge label="景别" value={s.shot_type} />
                          <ShotBadge label="运镜" value={s.camera_movement} />
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditShot(s); setEditOpen(true); }}>
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleCopyShot(s)}>
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(s.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    {s.visual_description && (
                      <p className="text-sm text-foreground mb-2 line-clamp-2">{s.visual_description}</p>
                    )}

                    <div className="space-y-1 text-xs text-muted-foreground">
                      {s.dialogue && <p><span className="text-foreground/60">台词：</span>{s.dialogue}</p>}
                      {s.voiceover && <p><span className="text-foreground/60">旁白：</span>{s.voiceover}</p>}
                      {s.image_prompt && (
                        <p className="line-clamp-1"><span className="text-green-400">图片提示词：</span>{s.image_prompt}</p>
                      )}
                      {s.video_prompt && (
                        <p className="line-clamp-1"><span className="text-blue-400">视频提示词：</span>{s.video_prompt}</p>
                      )}
                    </div>

                    {/* 音频区域 */}
                    <div className="mt-3 space-y-1.5">
                      {(['voiceover', 'dialogue'] as const).map(type => {
                        const hasText = type === 'voiceover' ? !!s.voiceover : !!s.dialogue;
                        if (!hasText) return null;
                        const label = type === 'voiceover' ? '旁白' : '对白';
                        const audioAsset = type === 'voiceover' ? s.voiceover_audio : s.dialogue_audio;
                        const key = `${s.id}_${type}`;
                        const genState = audioGenStates[key];
                        const isGenerating = genState === 'generating';
                        const isPlaying = playingKey === key;
                        return (
                          <div key={type} className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs text-muted-foreground w-8 shrink-0">{label}：</span>
                            {audioAsset?.file_url ? (
                              <>
                                <Button
                                  variant="secondary" size="sm" className="h-6 px-2 text-xs gap-1"
                                  onClick={() => handlePlayAudio(key, audioAsset.file_url!)}
                                >
                                  {isPlaying
                                    ? <><Pause className="w-3 h-3" />暂停</>
                                    : <><Play className="w-3 h-3" />播放</>}
                                </Button>
                                <Button
                                  variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-destructive hover:text-destructive"
                                  onClick={() => handleUnbindAudio(s, type)}
                                  title="解绑音频"
                                >
                                  <Unlink className="w-3 h-3" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="secondary" size="sm" className="h-6 px-2 text-xs gap-1"
                                onClick={() => handleGenerateAudio(s, type)}
                                disabled={isGenerating}
                              >
                                {isGenerating
                                  ? <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
                                  : <><Mic className="w-3 h-3" />生成{label}音频</>}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant={s.image_asset_id ? 'default' : 'outline'} className="text-xs">
                        <Image className="w-3 h-3 mr-1" />{s.image_asset_id ? '有图片' : '无图片'}
                      </Badge>
                      <Badge variant={s.video_asset_id ? 'default' : 'outline'} className="text-xs">
                        <Video className="w-3 h-3 mr-1" />{s.video_asset_id ? '有视频' : '无视频'}
                      </Badge>
                      <Button size="sm" variant="secondary" className="ml-auto h-6 text-xs" onClick={() => navigate('/images', { state: { storyboard: s } })}>
                        生图 <ChevronRight className="w-3 h-3 ml-0.5" />
                      </Button>
                      {s.image_asset_id ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-6 text-xs"
                          onClick={() => {
                            const params = new URLSearchParams({
                              mode: 'image_to_video',
                              reference_asset_id: s.image_asset_id!,
                              storyboard_id: s.id,
                              ...(s.video_prompt ? { prompt: encodeURIComponent(s.video_prompt) } : {}),
                            });
                            navigate(`/videos?${params.toString()}`);
                          }}
                        >
                          用图生视频 <ChevronRight className="w-3 h-3 ml-0.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" className="h-6 text-xs" onClick={() => navigate('/videos', { state: { storyboard: s } })}>
                          生视频 <ChevronRight className="w-3 h-3 ml-0.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
          <DialogHeader><DialogTitle>编辑分镜 {editShot?.shot_index}</DialogTitle></DialogHeader>
          {editShot && (
            <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                <div><Label>时长</Label><Input className="mt-1" value={editShot.duration || ''} onChange={e => setEditShot(s => s ? {...s, duration: e.target.value} : s)} /></div>
                <div><Label>景别</Label>
                  <Select value={editShot.shot_type || ''} onValueChange={v => setEditShot(s => s ? {...s, shot_type: v} : s)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="选择" /></SelectTrigger>
                    <SelectContent>{SHOT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>运镜</Label>
                  <Select value={editShot.camera_movement || ''} onValueChange={v => setEditShot(s => s ? {...s, camera_movement: v} : s)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="选择" /></SelectTrigger>
                    <SelectContent>{CAMERA_MOVEMENTS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>画面描述</Label><Textarea className="mt-1" rows={2} value={editShot.visual_description || ''} onChange={e => setEditShot(s => s ? {...s, visual_description: e.target.value} : s)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>人物动作</Label><Input className="mt-1" value={editShot.character_action || ''} onChange={e => setEditShot(s => s ? {...s, character_action: e.target.value} : s)} /></div>
                <div><Label>表情</Label><Input className="mt-1" value={editShot.expression || ''} onChange={e => setEditShot(s => s ? {...s, expression: e.target.value} : s)} /></div>
              </div>
              <div><Label>台词</Label><Input className="mt-1" value={editShot.dialogue || ''} onChange={e => setEditShot(s => s ? {...s, dialogue: e.target.value} : s)} /></div>
              <div><Label>旁白</Label><Input className="mt-1" value={editShot.voiceover || ''} onChange={e => setEditShot(s => s ? {...s, voiceover: e.target.value} : s)} /></div>
              <div><Label>音效</Label><Input className="mt-1" value={editShot.sound_effect || ''} onChange={e => setEditShot(s => s ? {...s, sound_effect: e.target.value} : s)} /></div>
              <div><Label>图片生成提示词</Label><Textarea className="mt-1" rows={2} value={editShot.image_prompt || ''} onChange={e => setEditShot(s => s ? {...s, image_prompt: e.target.value} : s)} /></div>
              <div><Label>视频生成提示词</Label><Textarea className="mt-1" rows={2} value={editShot.video_prompt || ''} onChange={e => setEditShot(s => s ? {...s, video_prompt: e.target.value} : s)} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSaveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除分镜？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteShot} className="bg-destructive text-destructive-foreground">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
