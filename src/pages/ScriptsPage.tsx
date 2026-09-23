import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import ModelSelector from '@/components/common/ModelSelector';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Sparkles, Save, ChevronRight, Clock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { getScripts, createScript, updateScript, getScriptVersions, saveScriptVersion, callAiGenerate, buildPromptFromTemplate, getPromptTemplates, getTopics } from '@/services/api';
import type { Script, ScriptVersion, Topic, PromptTemplate } from '@/types/types';
import { PLATFORM_OPTIONS } from '@/types/types';

const SCRIPT_DURATIONS = ['15秒', '30秒', '60秒', '90秒', '自定义'];
const SCRIPT_TYPES = ['漫剧', '条漫', '口播', '教程', '图文'];
const NARRATIVE_STYLES = ['悬疑', '爽文', '现实映射', '荒诞', '教程', '情绪共鸣'];

export default function ScriptsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [activeScript, setActiveScript] = useState<Script | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);

  // Form
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('60秒');
  const [scriptType, setScriptType] = useState('漫剧');
  const [style, setStyle] = useState('悬疑');
  const [platform, setPlatform] = useState('抖音');
  const [topicInput, setTopicInput] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiConfigId, setApiConfigId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 从上游携带选题，或从“继续创作”恢复到只有分集大纲/未完成正文的单集
  const routeState = location.state as { topic?: Topic; script?: Script } | null;
  const passedTopic = routeState?.topic;
  const passedScript = routeState?.script;

  useEffect(() => {
    if (passedTopic) {
      setTitle(passedTopic.title);
      setTopicInput(passedTopic.summary || passedTopic.content || '');
      setSelectedTopicId(passedTopic.id);
    }
  }, [passedTopic]);

  useEffect(() => {
    if (!passedScript) return;
    if (selectedProjectId && passedScript.project_id !== selectedProjectId) {
      toast.error('传入剧本不属于当前项目，已阻止跨项目续作');
      return;
    }
    setActiveScript(passedScript);
    setTitle(passedScript.title || '');
    setContent(passedScript.content || '');
    setTopicInput(passedScript.episode_outline || '');
    setSelectedTopicId(passedScript.topic_id || '');
  }, [passedScript, selectedProjectId]);

  const loadScripts = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await getScripts(selectedProjectId);
      setScripts(data);
    } catch { toast.error('加载剧本失败'); }
    finally { setLoading(false); }
  }, [selectedProjectId]);

  useEffect(() => { loadScripts(); }, [loadScripts]);

  useEffect(() => {
    if (selectedProjectId) {
      getTopics(selectedProjectId).then(setTopics).catch(() => {});
    }
    getPromptTemplates('script_generation').then(setTemplates).catch(() => {});
  }, [selectedProjectId]);

  // 自动保存
  useEffect(() => {
    if (!activeScript || !content) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await updateScript(activeScript.id, { content });
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [content, activeScript]);

  async function handleGenerate() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!modelId) { toast.error('请先选择模型'); return; }
    if (!topicInput.trim() && !title.trim()) { toast.error('请填写选题内容或剧本标题'); return; }

    setGenerating(true);
    try {
      let prompt = '';
      const selectedTemplate = templates.find(t => t.id === templateId);
      if (selectedTemplate) {
        prompt = buildPromptFromTemplate(selectedTemplate.content, {
          duration, title, summary: activeScript?.episode_outline || topicInput, style, platform,
        });
      } else {
        prompt = `你是一位专业的短视频编剧。请根据以下信息创作一个${duration}的短视频剧本：

选题/方向：${title || topicInput}
内容描述：${activeScript?.episode_outline || topicInput}
剧本类型：${scriptType}
叙事风格：${style}
目标平台：${platform}

剧本要求：
1. 开头3秒必须有强力钩子抓住观众
2. 结构：钩子 → 铺垫 → 冲突 → 反转 → 结尾留钩
3. 每段内容标注角色标签（旁白/对白/画面说明）
4. 台词简洁有力，符合${platform}平台调性

请直接输出剧本内容，用分段形式展示：`;
      }

      const result = await callAiGenerate(apiConfigId, modelId, prompt);

      // 创建或更新剧本
      let script: Script;
      if (activeScript) {
        await updateScript(activeScript.id, { content: result, episode_outline: activeScript.episode_outline || topicInput || undefined, title: title || activeScript.title, version: activeScript.version + 1 });
        await saveScriptVersion(activeScript.id, activeScript.version, activeScript.content || '');
        script = { ...activeScript, content: result, version: activeScript.version + 1 };
        setActiveScript(script);
      } else {
        script = await createScript({
          project_id: selectedProjectId,
          topic_id: selectedTopicId || undefined,
          episode_outline: topicInput || undefined,
          title: title || '未命名剧本',
          content: result,
          duration,
          style,
          script_type: scriptType,
          version: 1,
        });
        setActiveScript(script);
      }
      setContent(result);
      await loadScripts();
      toast.success('剧本生成成功');
    } catch (e) {
      toast.error(`生成失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!activeScript) {
      // 新建保存
      if (!selectedProjectId) { toast.error('请先选择项目'); return; }
      if (!title.trim()) { toast.error('请填写剧本标题'); return; }
      setSaving(true);
      try {
        const script = await createScript({
          project_id: selectedProjectId,
          topic_id: selectedTopicId || undefined,
          episode_outline: topicInput || undefined,
          title,
          content,
          duration,
          style,
          script_type: scriptType,
          version: 1,
        });
        setActiveScript(script);
        await loadScripts();
        toast.success('剧本已保存');
      } catch { toast.error('保存失败'); }
      finally { setSaving(false); }
    } else {
      setSaving(true);
      try {
        await saveScriptVersion(activeScript.id, activeScript.version, activeScript.content || '');
        await updateScript(activeScript.id, { content, title });
        setActiveScript(s => s ? { ...s, content } : s);
        await loadScripts();
        toast.success('剧本已保存');
      } catch { toast.error('保存失败'); }
      finally { setSaving(false); }
    }
  }

  async function loadVersions(scriptId: string) {
    const v = await getScriptVersions(scriptId);
    setVersions(v);
    setVersionsOpen(true);
  }

  function handleExport(format: 'txt' | 'md') {
    const text = format === 'md' ? `# ${title || '剧本'}\n\n${content}` : content;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `剧本_${title || '未命名'}.${format}`;
    a.click(); URL.revokeObjectURL(url);
  }

  function handleGoStoryboard() {
    if (!content) { toast.error('请先生成或编写剧本内容'); return; }
    navigate('/storyboards', { state: { script: activeScript, content } });
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />剧本生成
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => handleExport('txt')}>导出 TXT</Button>
            <Button variant="secondary" size="sm" onClick={() => handleExport('md')}>导出 MD</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：参数 */}
          <div className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3"><h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">创作参数</h2></CardHeader>
              <CardContent className="space-y-3">
                <div><Label>所属项目</Label><ProjectSelector className="mt-1 w-full" /></div>
                <div><Label>使用模型</Label>
                  <ModelSelector functionKey="script_generation" requiredCapability="text_generation" value={modelId} onChange={(mid, acid) => { setModelId(mid); setApiConfigId(acid); }} className="mt-1 w-full" />
                </div>
                <div><Label>剧本标题</Label><Input className="mt-1" value={title} onChange={e => setTitle(e.target.value)} placeholder="剧本标题" /></div>

                <div><Label>从选题库选择</Label>
                  <Select value={selectedTopicId} onValueChange={id => {
                    setSelectedTopicId(id);
                    const t = topics.find(x => x.id === id);
                    if (t) { setTitle(t.title); setTopicInput(t.summary || t.content || ''); }
                  }}>
                    <SelectTrigger className="mt-1 w-full"><SelectValue placeholder="选择已有选题" /></SelectTrigger>
                    <SelectContent>
                      {topics.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div><Label>选题/故事方向</Label><Textarea className="mt-1" rows={3} value={topicInput} onChange={e => setTopicInput(e.target.value)} placeholder="粘贴选题内容或描述故事方向..." /></div>

                <div className="grid grid-cols-2 gap-2">
                  <div><Label>时长</Label>
                    <Select value={duration} onValueChange={setDuration}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SCRIPT_DURATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>类型</Label>
                    <Select value={scriptType} onValueChange={setScriptType}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SCRIPT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>叙事风格</Label>
                    <Select value={style} onValueChange={setStyle}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{NARRATIVE_STYLES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>平台</Label>
                    <Select value={platform} onValueChange={setPlatform}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {templates.length > 0 && (
                  <div><Label>提示词模板</Label>
                    <Select value={templateId} onValueChange={setTemplateId}>
                      <SelectTrigger className="mt-1 w-full"><SelectValue placeholder="不使用模板" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="no-template">不使用模板</SelectItem>
                        {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button className="w-full" onClick={handleGenerate} disabled={generating}>
                  <Sparkles className="w-4 h-4 mr-2" />{generating ? '生成中…' : '生成剧本'}
                </Button>
              </CardContent>
            </Card>

            {/* 历史剧本 */}
            {scripts.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3"><h2 className="text-sm font-semibold text-muted-foreground">历史剧本</h2></CardHeader>
                <CardContent className="space-y-1">
                  {loading ? <Skeleton className="h-8" /> : scripts.slice(0, 8).map(s => (
                    <button key={s.id} onClick={() => { setActiveScript(s); setContent(s.content || ''); setTitle(s.title); }}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${activeScript?.id === s.id ? 'bg-primary/20 text-primary' : 'hover:bg-secondary text-muted-foreground'}`}>
                      <div className="truncate font-medium">{s.title}</div>
                      <div className="text-xs opacity-60 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />{new Date(s.updated_at).toLocaleDateString('zh-CN')}
                        <Badge variant="outline" className="text-xs ml-1">v{s.version}</Badge>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* 右侧：编辑器 */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {activeScript && (
                  <>
                    <Badge variant="outline">v{activeScript.version}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => loadVersions(activeScript.id)}>
                      <Clock className="w-4 h-4 mr-1" />历史版本
                    </Button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={!content} onClick={() => { setContent(''); setActiveScript(null); }}>
                  <RotateCcw className="w-4 h-4 mr-1" />清空
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="w-4 h-4 mr-1" />{saving ? '保存中…' : '保存'}
                </Button>
                <Button size="sm" variant="default" onClick={handleGoStoryboard} disabled={!content}>
                  生成分镜 <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>

            <Card className="bg-card border-border">
              <CardContent className="p-0">
                <Textarea
                  className="min-h-[60vh] border-0 rounded-lg bg-transparent resize-none text-sm focus-visible:ring-0 p-4"
                  placeholder="剧本内容将显示在这里，也可以直接在此输入或粘贴剧本文案..."
                  value={content}
                  onChange={e => setContent(e.target.value)}
                />
              </CardContent>
            </Card>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{content.length} 字</span>
              {activeScript && <span>自动保存中</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 版本历史 */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader><DialogTitle>历史版本</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-96">
            {versions.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">暂无历史版本</p>
            ) : (
              <div className="space-y-3">
                {versions.map(v => (
                  <div key={v.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline">v{v.version}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString('zh-CN')}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3">{v.content}</p>
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setContent(v.content || ''); setVersionsOpen(false); toast.success('已恢复到该版本'); }}>
                      恢复此版本
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
