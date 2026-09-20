import MainLayout from '@/components/layouts/MainLayout';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { BookMarked, Plus, Pencil, Trash2, Copy, Search, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { getPromptTemplates, createPromptTemplate, updatePromptTemplate, deletePromptTemplate } from '@/services/api';
import type { PromptTemplate, TemplateVariable } from '@/types/types';
import { TEMPLATE_CATEGORIES } from '@/types/types';

interface TemplateFormData {
  name: string;
  category: string;
  sub_type: string;
  description: string;
  platforms: string[];
  scenarios: string[];
  tags: string[];
  content: string;
  variables: TemplateVariable[];
  usage_guide: string;
}

const DEFAULT_FORM: TemplateFormData = {
  name: '', category: 'topic_generation', sub_type: '', description: '',
  platforms: [], scenarios: [], tags: [], content: '', variables: [], usage_guide: '',
};

function TemplateFormDialog({
  open, onOpenChange, template, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  template?: PromptTemplate; onSaved: () => void;
}) {
  const [form, setForm] = useState<TemplateFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (template) {
      setForm({
        name: template.name,
        category: template.category,
        sub_type: template.sub_type || '',
        description: template.description || '',
        platforms: template.platforms || [],
        scenarios: template.scenarios || [],
        tags: template.tags || [],
        content: template.content,
        variables: template.variables || [],
        usage_guide: template.usage_guide || '',
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    setTagInput('');
  }, [template, open]);

  function addVariable() {
    setForm(f => ({
      ...f,
      variables: [...f.variables, { name: '', type: 'text', default: '', required: false, description: '' }],
    }));
  }

  function removeVariable(i: number) {
    setForm(f => ({ ...f, variables: f.variables.filter((_, idx) => idx !== i) }));
  }

  function updateVariable(i: number, field: keyof TemplateVariable, value: string | boolean) {
    setForm(f => ({
      ...f,
      variables: f.variables.map((v, idx) => idx === i ? { ...v, [field]: value } : v),
    }));
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) {
      setForm(f => ({ ...f, tags: [...f.tags, t] }));
      setTagInput('');
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.content.trim()) { toast.error('请填写模板名称和内容'); return; }
    setSaving(true);
    try {
      if (template) {
        await updatePromptTemplate(template.id, form);
        toast.success('模板已更新');
      } else {
        await createPromptTemplate(form);
        toast.success('模板已创建');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
        <DialogHeader><DialogTitle>{template ? '编辑模板' : '新增模板'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>模板名称 *</Label><Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="模板名称" /></div>
            <div><Label>分类</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>描述</Label><Input className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="模板简要描述" /></div>

          <div><Label>模板正文 * <span className="text-muted-foreground text-xs">（使用 {'{{'+'变量名'+'}}'} 插入变量）</span></Label>
            <Textarea className="mt-1 font-mono text-sm" rows={8} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="在此输入提示词模板内容..." />
          </div>

          {/* 标签 */}
          <div>
            <Label>标签</Label>
            <div className="flex gap-2 mt-1">
              <Input value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="输入标签" onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} />
              <Button type="button" variant="secondary" size="sm" onClick={addTag}>添加</Button>
            </div>
            <div className="flex gap-1 flex-wrap mt-2">
              {form.tags.map(t => (
                <Badge key={t} variant="secondary" className="cursor-pointer" onClick={() => setForm(f => ({ ...f, tags: f.tags.filter(x => x !== t) }))}>
                  {t} ×
                </Badge>
              ))}
            </div>
          </div>

          {/* 变量列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>变量列表</Label>
              <Button type="button" variant="secondary" size="sm" onClick={addVariable}><Plus className="w-3 h-3 mr-1" />添加变量</Button>
            </div>
            {form.variables.map((v, i) => (
              <div key={i} className="border border-border rounded p-2 mb-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="变量名" value={v.name} onChange={e => updateVariable(i, 'name', e.target.value)} />
                  <Input placeholder="默认值" value={v.default} onChange={e => updateVariable(i, 'default', e.target.value)} />
                </div>
                <Input placeholder="变量说明" value={v.description} onChange={e => updateVariable(i, 'description', e.target.value)} />
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeVariable(i)}>
                  <Trash2 className="w-3 h-3 mr-1" />删除变量
                </Button>
              </div>
            ))}
          </div>

          <div><Label>使用说明</Label><Textarea className="mt-1" rows={2} value={form.usage_guide} onChange={e => setForm(f => ({ ...f, usage_guide: e.target.value }))} placeholder="如何使用此模板..." /></div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<PromptTemplate | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPromptTemplates(categoryFilter === 'all' ? undefined : categoryFilter, search || undefined);
      setTemplates(data);
    } catch { toast.error('加载失败'); }
    finally { setLoading(false); }
  }, [categoryFilter, search]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!deleteId) return;
    await deletePromptTemplate(deleteId);
    toast.success('已删除');
    setDeleteId(null);
    await load();
  }

  function handleCopy(t: PromptTemplate) {
    navigator.clipboard.writeText(t.content);
    toast.success('已复制模板内容');
  }

  const getCategoryLabel = (cat: string) => TEMPLATE_CATEGORIES.find(c => c.value === cat)?.label || cat;

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookMarked className="w-5 h-5 text-indigo-400" />提示词模板
          </h1>
          <Button onClick={() => { setEditTemplate(undefined); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" />新增模板
          </Button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-0 md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索模板…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44 shrink-0"><SelectValue placeholder="全部分类" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {TEMPLATE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-36" />)}
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookMarked className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>暂无模板，点击「新增模板」创建</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map(t => (
              <Card key={t.id} className="bg-card border-border hover:border-primary/30 transition-colors h-full flex flex-col">
                <CardContent className="p-4 flex flex-col flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate">{t.name}</h3>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs">{getCategoryLabel(t.category)}</Badge>
                        {t.tags?.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setPreviewTemplate(t)}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleCopy(t)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditTemplate(t); setFormOpen(true); }}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(t.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{t.description}</p>}
                  <div className="text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 line-clamp-3 flex-1 mt-auto">
                    {t.content}
                  </div>
                  {t.variables && t.variables.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      变量：{t.variables.map(v => `{{${v.name}}}`).join(', ')}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <TemplateFormDialog open={formOpen} onOpenChange={setFormOpen} template={editTemplate} onSaved={load} />

      {/* 预览 */}
      <Dialog open={!!previewTemplate} onOpenChange={open => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline">{getCategoryLabel(previewTemplate.category)}</Badge>
                {previewTemplate.tags?.map(t => <Badge key={t} variant="secondary">{t}</Badge>)}
              </div>
              {previewTemplate.description && <p className="text-sm text-muted-foreground">{previewTemplate.description}</p>}
              <div className="bg-muted/50 rounded p-3 text-sm font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
                {previewTemplate.content}
              </div>
              {previewTemplate.variables && previewTemplate.variables.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-1">变量说明</h4>
                  <div className="space-y-1">
                    {previewTemplate.variables.map(v => (
                      <div key={v.name} className="text-xs flex gap-2 text-muted-foreground">
                        <code className="text-primary">{`{{${v.name}}}`}</code>
                        <span>{v.description}</span>
                        {v.required && <Badge variant="outline" className="text-xs">必填</Badge>}
                        {v.default && <span>默认：{v.default}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {previewTemplate.usage_guide && (
                <div>
                  <h4 className="text-sm font-semibold mb-1">使用说明</h4>
                  <p className="text-xs text-muted-foreground">{previewTemplate.usage_guide}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除模板？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
