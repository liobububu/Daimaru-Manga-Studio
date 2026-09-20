import MainLayout from '@/components/layouts/MainLayout';
import ProjectSelector from '@/components/common/ProjectSelector';
import ModelSelector from '@/components/common/ModelSelector';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import {
  Lightbulb, Sparkles, Star, StarOff, Trash2, Edit, Copy,
  ChevronRight, MoreVertical, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { getTopics, createTopics, updateTopic, deleteTopic, callAiGenerate, buildPromptFromTemplate, parseJsonSafely, getPromptTemplates } from '@/services/api';
import type { Topic, PromptTemplate } from '@/types/types';
import { PLATFORM_OPTIONS } from '@/types/types';

const CONTENT_TYPES = ['AI漫剧','条漫','剧情短视频','教程内容','AI工具介绍','公众号图文','爆款拆解','脑洞设定','现实映射','悬疑反转','爽文剧情'];
const EMOTION_OPTIONS = ['治愈','励志','搞笑','感动','悬疑','惊讶','共情','爽感'];
const STYLE_OPTIONS = ['爆款标题风','情感共鸣风','反差感强','干货知识','脑洞开放'];

export default function TopicsPage() {
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // 生成参数
  const [platform, setPlatform] = useState('抖音');
  const [contentType, setContentType] = useState('AI漫剧');
  const [keyword, setKeyword] = useState('');
  const [audience, setAudience] = useState('');
  const [emotion, setEmotion] = useState('治愈');
  const [style, setStyle] = useState('爆款标题风');
  const [count, setCount] = useState(5);
  const [modelId, setModelId] = useState('');
  const [apiConfigId, setApiConfigId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);

  // 编辑
  const [editTopic, setEditTopic] = useState<Topic | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const loadTopics = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await getTopics(selectedProjectId);
      setTopics(data);
    } catch { toast.error('加载选题失败'); }
    finally { setLoading(false); }
  }, [selectedProjectId]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  useEffect(() => {
    getPromptTemplates('topic_generation').then(setTemplates).catch(() => {});
  }, []);

  async function handleGenerate() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!modelId) { toast.error('请先选择模型'); return; }
    if (!keyword.trim()) { toast.error('请填写关键词/主题方向'); return; }

    setGenerating(true);
    try {
      let prompt = '';
      const selectedTemplate = templates.find(t => t.id === templateId);
      if (selectedTemplate) {
        prompt = buildPromptFromTemplate(selectedTemplate.content, {
          platform, content_type: contentType, topic: keyword, audience, emotion, style,
          count: String(count),
        });
      } else {
        prompt = `你是一位资深内容策划专家，擅长为${platform}平台创作爆款内容。
请根据以下要求生成${count}条爆款选题：
- 内容类型：${contentType}
- 主题方向：${keyword}
- 目标用户：${audience || '年轻用户'}
- 情绪方向：${emotion}
- 风格：${style}

每条选题必须包含以下字段（JSON数组格式输出）：
[{"title":"选题标题","summary":"一句话卖点","content":"内容简介","audience":"目标受众","core_conflict":"核心冲突","selling_point":"爽点/看点","platform":"适合平台","duration_suggestion":"建议时长","creative_advice":"创作建议","extend_directions":"可延展方向"}]

请直接返回JSON数组，不要添加任何额外说明。`;
      }

      const result = await callAiGenerate(apiConfigId, modelId, prompt);
      const parsed = parseJsonSafely<Record<string, string>[]>(result);
      if (!parsed || !Array.isArray(parsed)) {
        // 截取前200字符辅助调试
        const preview = result ? result.slice(0, 200) : '（空响应）';
        toast.error(`解析失败，模型返回内容: ${preview}`);
        return;
      }

      const toSave = parsed.map(item => ({
        project_id: selectedProjectId,
        title: item.title || '未命名选题',
        summary: item.summary || '',
        content: item.content || '',
        audience: item.audience || audience,
        core_conflict: item.core_conflict || '',
        selling_point: item.selling_point || '',
        platform: item.platform || platform,
        duration_suggestion: item.duration_suggestion || '',
        creative_advice: item.creative_advice || '',
        extend_directions: item.extend_directions || '',
        favorite: false,
      }));

      await createTopics(toSave);
      toast.success(`成功生成 ${parsed.length} 条选题`);
      await loadTopics();
    } catch (e) {
      toast.error(`生成失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleFavorite(t: Topic) {
    await updateTopic(t.id, { favorite: !t.favorite });
    await loadTopics();
  }

  async function handleDelete(id: string) {
    await deleteTopic(id);
    setTopics(prev => prev.filter(t => t.id !== id));
    toast.success('已删除');
  }

  function handleCopy(t: Topic) {
    const text = `${t.title}\n\n卖点：${t.summary}\n\n简介：${t.content}\n\n核心冲突：${t.core_conflict}\n\n爽点：${t.selling_point}`;
    navigator.clipboard.writeText(text);
    toast.success('已复制到剪贴板');
  }

  function handleExport(format: 'md' | 'txt') {
    const content = topics.map(t =>
      format === 'md'
        ? `## ${t.title}\n- 卖点：${t.summary}\n- 简介：${t.content}\n- 目标受众：${t.audience}\n- 核心冲突：${t.core_conflict}\n- 爽点：${t.selling_point}\n- 平台：${t.platform}\n- 时长：${t.duration_suggestion}\n- 建议：${t.creative_advice}\n`
        : `${t.title}\n卖点：${t.summary}\n简介：${t.content}\n目标受众：${t.audience}\n核心冲突：${t.core_conflict}\n爽点：${t.selling_point}\n\n`,
    ).join('\n---\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `选题列表.${format === 'md' ? 'md' : 'txt'}`;
    a.click(); URL.revokeObjectURL(url);
  }

  function handleGoScript(t: Topic) {
    navigate('/scripts', { state: { topic: t } });
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-400" />爆款选题生成
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => handleExport('md')}>导出 MD</Button>
            <Button variant="secondary" size="sm" onClick={() => handleExport('txt')}>导出 TXT</Button>
          </div>
        </div>

        {/* 生成面板 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">生成参数</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <Label>所属项目 *</Label>
                <ProjectSelector className="mt-1 w-full" />
              </div>
              <div>
                <Label>使用模型 *</Label>
                <ModelSelector
                  functionKey="topic_generation"
                  requiredCapability="text_generation"
                  value={modelId}
                  onChange={(mid, acid) => { setModelId(mid); setApiConfigId(acid); }}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <Label>目标平台</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>内容类型</Label>
                <Select value={contentType} onValueChange={setContentType}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>情绪方向</Label>
                <Select value={emotion} onValueChange={setEmotion}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{EMOTION_OPTIONS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>选题风格</Label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{STYLE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>关键词 / 主题方向 *</Label>
                <Input className="mt-1" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="如：职场逆袭、AI创作、感情治愈..." />
              </div>
              <div>
                <Label>目标用户</Label>
                <Input className="mt-1" value={audience} onChange={e => setAudience(e.target.value)} placeholder="如：年轻女性、职场人..." />
              </div>
            </div>

            <div>
              <Label>生成数量：{count} 条</Label>
              <div className="mt-2 px-1">
                <Slider min={1} max={20} step={1} value={[count]} onValueChange={([v]) => setCount(v)} />
              </div>
            </div>

            {templates.length > 0 && (
              <div>
                <Label>提示词模板（可选）</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger className="mt-1 w-full md:w-80"><SelectValue placeholder="不使用模板" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-template">不使用模板</SelectItem>
                    {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button className="w-full md:w-auto" onClick={handleGenerate} disabled={generating}>
              <Sparkles className="w-4 h-4 mr-2" />
              {generating ? '生成中…' : '生成选题'}
            </Button>
          </CardContent>
        </Card>

        {/* 结果列表 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{topics.length} 条选题</h2>
          </div>
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}</div>
          ) : topics.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Lightbulb className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>还没有选题，填写参数后点击生成</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topics.map(t => (
                <Card key={t.id} className="bg-card border-border hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-foreground text-balance">{t.title}</h3>
                          {t.favorite && <Star className="w-4 h-4 text-yellow-400 shrink-0" fill="currentColor" />}
                        </div>
                        {t.summary && <p className="text-sm text-primary mb-2">{t.summary}</p>}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                          {t.core_conflict && <span><span className="text-foreground/60">核心冲突：</span>{t.core_conflict}</span>}
                          {t.selling_point && <span><span className="text-foreground/60">爽点：</span>{t.selling_point}</span>}
                          {t.audience && <span><span className="text-foreground/60">受众：</span>{t.audience}</span>}
                          {t.duration_suggestion && <span><span className="text-foreground/60">时长：</span>{t.duration_suggestion}</span>}
                        </div>
                        {t.content && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{t.content}</p>}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {t.platform && <Badge variant="outline" className="text-xs">{t.platform}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleFavorite(t)}>
                          {t.favorite ? <Star className="w-4 h-4 text-yellow-400" fill="currentColor" /> : <StarOff className="w-4 h-4" />}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-card border-border">
                            <DropdownMenuItem onClick={() => { setEditTopic(t); setEditDialogOpen(true); }}>
                              <Edit className="w-4 h-4 mr-2" />编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopy(t)}>
                              <Copy className="w-4 h-4 mr-2" />复制
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleGoScript(t)}>
                              <FileText className="w-4 h-4 mr-2" />生成剧本
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(t.id)}>
                              <Trash2 className="w-4 h-4 mr-2" />删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button size="sm" variant="secondary" onClick={() => handleGoScript(t)}>
                          生成剧本 <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 编辑对话框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
          <DialogHeader><DialogTitle>编辑选题</DialogTitle></DialogHeader>
          {editTopic && (
            <div className="space-y-3 py-2">
              <div><Label>标题</Label><Input className="mt-1" value={editTopic.title} onChange={e => setEditTopic(p => p ? {...p, title: e.target.value} : p)} /></div>
              <div><Label>一句话卖点</Label><Input className="mt-1" value={editTopic.summary || ''} onChange={e => setEditTopic(p => p ? {...p, summary: e.target.value} : p)} /></div>
              <div><Label>内容简介</Label><Textarea className="mt-1" rows={3} value={editTopic.content || ''} onChange={e => setEditTopic(p => p ? {...p, content: e.target.value} : p)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>核心冲突</Label><Input className="mt-1" value={editTopic.core_conflict || ''} onChange={e => setEditTopic(p => p ? {...p, core_conflict: e.target.value} : p)} /></div>
                <div><Label>爽点/看点</Label><Input className="mt-1" value={editTopic.selling_point || ''} onChange={e => setEditTopic(p => p ? {...p, selling_point: e.target.value} : p)} /></div>
              </div>
              <div><Label>创作建议</Label><Textarea className="mt-1" rows={2} value={editTopic.creative_advice || ''} onChange={e => setEditTopic(p => p ? {...p, creative_advice: e.target.value} : p)} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditDialogOpen(false)}>取消</Button>
            <Button onClick={async () => {
              if (!editTopic) return;
              await updateTopic(editTopic.id, editTopic);
              toast.success('已保存');
              setEditDialogOpen(false);
              await loadTopics();
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
