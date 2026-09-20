import MainLayout from '@/components/layouts/MainLayout';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus, Search, MoreVertical, FolderOpen, Pencil, Trash2, Copy,
  Lightbulb, FileText, Film, Image, Video, BookOpen, Clock,
  LayoutDashboard, Layers, Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getProjectsWithStats, createProject, updateProject, deleteProject } from '@/services/api';
import { useProject } from '@/contexts/ProjectContext';
import type { Project } from '@/types/types';
import { PROJECT_TYPE_OPTIONS, PLATFORM_OPTIONS, ASPECT_RATIO_OPTIONS } from '@/types/types';

const quickActions = [
  { label: '爆款选题', icon: Lightbulb, path: '/topics', color: 'text-yellow-400' },
  { label: '剧本生成', icon: FileText, path: '/scripts', color: 'text-blue-400' },
  { label: '分镜脚本', icon: Film, path: '/storyboards', color: 'text-purple-400' },
  { label: '图片生成', icon: Image, path: '/images', color: 'text-green-400' },
  { label: '视频生成', icon: Video, path: '/videos', color: 'text-red-400' },
  { label: '条漫编辑器', icon: BookOpen, path: '/comic-editor', color: 'text-orange-400' },
];

const typeColors: Record<string, string> = {
  'AI漫剧': 'bg-purple-500/20 text-purple-300',
  '条漫': 'bg-blue-500/20 text-blue-300',
  '教程短视频': 'bg-green-500/20 text-green-300',
  '图文内容': 'bg-yellow-500/20 text-yellow-300',
  '其他': 'bg-muted text-muted-foreground',
};

function ProjectFormDialog({
  open, onOpenChange, project, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project?: Project;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    type: 'AI漫剧',
    target_platform: '抖音',
    aspect_ratio: '9:16',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({ name: project.name, type: project.type, target_platform: project.target_platform, aspect_ratio: project.aspect_ratio, description: project.description || '' });
    } else {
      setForm({ name: '', type: 'AI漫剧', target_platform: '抖音', aspect_ratio: '9:16', description: '' });
    }
  }, [project, open]);

  async function handleSave() {
    if (!form.name.trim()) { toast.error('请输入项目名称'); return; }
    setSaving(true);
    try {
      if (project) {
        await updateProject(project.id, form);
        toast.success('项目已更新');
      } else {
        await createProject({ ...form, status: 'active' });
        toast.success('项目已创建');
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
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle>{project ? '编辑项目' : '新建项目'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>项目名称 *</Label>
            <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="输入项目名称" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>内容类型</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PROJECT_TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>目标平台</Label>
              <Select value={form.target_platform} onValueChange={v => setForm(f => ({ ...f, target_platform: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>默认画面比例</Label>
            <Select value={form.aspect_ratio} onValueChange={v => setForm(f => ({ ...f, aspect_ratio: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{ASPECT_RATIO_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>项目备注</Label>
            <Textarea className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="可选备注" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const { setSelectedProjectId, refreshProjects } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProjectsWithStats();
      setProjects(data);
    } catch {
      toast.error('加载项目失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = projects.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || p.type === typeFilter;
    return matchSearch && matchType;
  });

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteProject(deleteId);
      toast.success('项目已删除');
      await load();
      await refreshProjects();
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleteId(null);
    }
  }

  async function handleCopy(p: Project) {
    try {
      await createProject({ name: `${p.name} 副本`, type: p.type, target_platform: p.target_platform, aspect_ratio: p.aspect_ratio, description: p.description, status: 'active' });
      toast.success('项目已复制');
      await load();
      await refreshProjects();
    } catch {
      toast.error('复制失败');
    }
  }

  function handleOpen(p: Project) {
    setSelectedProjectId(p.id);
    navigate('/topics');
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* 页头 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-primary" />
              工作台
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">管理你的所有创作项目</p>
          </div>
          <Button onClick={() => { setEditProject(undefined); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" />新建项目
          </Button>
        </div>

        {/* 快捷入口 */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {quickActions.map(a => {
            const Icon = a.icon;
            return (
              <button
                key={a.path}
                onClick={() => navigate(a.path)}
                className="flex flex-col items-center gap-2 p-3 rounded-lg bg-card border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors"
              >
                <Icon className={`w-5 h-5 ${a.color}`} />
                <span className="text-xs text-muted-foreground text-center">{a.label}</span>
              </button>
            );
          })}
        </div>

        {/* 筛选 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-0 md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索项目…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36 shrink-0"><SelectValue placeholder="全部类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {PROJECT_TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* 项目列表 */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => <Skeleton key={i} className="h-44 rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {projects.length === 0 ? '还没有项目，点击上方「新建项目」开始创作' : '没有匹配的项目'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(p => (
              <Card key={p.id} className="bg-card border-border hover:border-primary/40 transition-colors group h-full flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{p.name}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge className={`text-xs px-2 ${typeColors[p.type] || typeColors['其他']}`} variant="outline">
                          {p.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{p.target_platform}</span>
                        <span className="text-xs text-muted-foreground">{p.aspect_ratio}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="shrink-0 h-8 w-8 p-0">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-card border-border">
                        <DropdownMenuItem onClick={() => handleOpen(p)}>
                          <FolderOpen className="w-4 h-4 mr-2" />打开
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setEditProject(p); setFormOpen(true); }}>
                          <Pencil className="w-4 h-4 mr-2" />重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCopy(p)}>
                          <Copy className="w-4 h-4 mr-2" />复制
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(p.id)}>
                          <Trash2 className="w-4 h-4 mr-2" />删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-between">
                  {p.description && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{p.description}</p>
                  )}
                  {/* 统计 */}
                  <div className="grid grid-cols-4 gap-1 mb-3">
                    {[
                      { icon: Lightbulb, label: '选题', count: p.topics_count || 0 },
                      { icon: FileText, label: '剧本', count: p.scripts_count || 0 },
                      { icon: Layers, label: '分镜', count: p.storyboards_count || 0 },
                      { icon: ImageIcon, label: '素材', count: p.assets_count || 0 },
                    ].map(s => {
                      const Icon = s.icon;
                      return (
                        <div key={s.label} className="flex flex-col items-center gap-0.5 p-1.5 rounded bg-muted/50">
                          <Icon className="w-3 h-3 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">{s.count}</span>
                          <span className="text-xs text-muted-foreground">{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(p.updated_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                    <Button size="sm" onClick={() => handleOpen(p)}>
                      <FolderOpen className="w-3 h-3 mr-1" />打开
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        project={editProject}
        onSaved={async () => { await load(); await refreshProjects(); }}
      />

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除该项目及其所有关联内容（选题、剧本、分镜、素材等），无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
