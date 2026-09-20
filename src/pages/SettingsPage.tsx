import MainLayout from '@/components/layouts/MainLayout';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Settings as SettingsIcon, Trash2, HardDrive, Download, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { getAppSettings, updateAppSetting } from '@/services/api';
import { ASPECT_RATIO_OPTIONS, PLATFORM_OPTIONS } from '@/types/types';

const LANGUAGES = [{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }];
const IMAGE_FORMATS = [{ value: 'png', label: 'PNG（无损）' }, { value: 'jpg', label: 'JPG（压缩）' }, { value: 'webp', label: 'WebP' }];
const PDF_SIZES = [{ value: 'A4', label: 'A4' }, { value: 'A3', label: 'A3' }, { value: 'custom', label: '自定义' }];

interface AppSettingsState {
  default_image_ratio: string;
  default_video_ratio: string;
  default_platform: string;
  language: string;
  auto_save: boolean;
  image_export_format: string;
  image_export_quality: number;
  pdf_page_size: string;
}

const DEFAULT_SETTINGS: AppSettingsState = {
  default_image_ratio: '1:1',
  default_video_ratio: '9:16',
  default_platform: '抖音',
  language: 'zh-CN',
  auto_save: true,
  image_export_format: 'png',
  image_export_quality: 90,
  pdf_page_size: 'A4',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettingsState>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [clearType, setClearType] = useState<'cache' | 'failed' | 'temp'>('cache');

  useEffect(() => {
    getAppSettings().then(rows => {
      const map: Record<string, string> = {};
      rows.forEach(r => { map[r.key] = r.value; });
      setSettings({
        default_image_ratio: map.default_image_ratio || DEFAULT_SETTINGS.default_image_ratio,
        default_video_ratio: map.default_video_ratio || DEFAULT_SETTINGS.default_video_ratio,
        default_platform: map.default_platform || DEFAULT_SETTINGS.default_platform,
        language: map.language || DEFAULT_SETTINGS.language,
        auto_save: map.auto_save !== 'false',
        image_export_format: map.image_export_format || DEFAULT_SETTINGS.image_export_format,
        image_export_quality: Number(map.image_export_quality || DEFAULT_SETTINGS.image_export_quality),
        pdf_page_size: map.pdf_page_size || DEFAULT_SETTINGS.pdf_page_size,
      });
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(settings).map(([key, value]) =>
          updateAppSetting(key, String(value)),
        ),
      );
      toast.success('设置已保存');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  }

  function updateSettings(key: keyof AppSettingsState, value: string | boolean | number) {
    setSettings(s => ({ ...s, [key]: value }));
  }

  async function handleClear() {
    try {
      const { db } = await import('@/db/client');
      if (clearType === 'failed') {
        await db.from('video_tasks').delete().in('status', ['failed', 'expired', 'timeout']);
        toast.success('已清理失败任务');
      } else {
        toast.success('已清理完成');
      }
    } catch {
      toast.error('清理失败');
    } finally {
      setClearCacheOpen(false);
    }
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-2xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-muted-foreground" />应用设置
          </h1>
          <Button onClick={handleSave} disabled={saving}>{saving ? '保存中…' : '保存设置'}</Button>
        </div>

        {/* 基础设置 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />基础设置
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>默认目标平台</Label>
                <Select value={settings.default_platform} onValueChange={v => updateSettings('default_platform', v)}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>默认语言</Label>
                <Select value={settings.language} onValueChange={v => updateSettings('language', v)}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>默认图片比例</Label>
                <Select value={settings.default_image_ratio} onValueChange={v => updateSettings('default_image_ratio', v)}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASPECT_RATIO_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>默认视频比例</Label>
                <Select value={settings.default_video_ratio} onValueChange={v => updateSettings('default_video_ratio', v)}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASPECT_RATIO_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={settings.auto_save} onCheckedChange={v => updateSettings('auto_save', v)} id="auto-save" />
              <Label htmlFor="auto-save">自动保存（剧本、分镜、条漫草稿每 3 秒自动保存）</Label>
            </div>
          </CardContent>
        </Card>

        {/* 导出设置 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Download className="w-4 h-4 text-green-400" />导出设置
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>图片导出格式</Label>
                <Select value={settings.image_export_format} onValueChange={v => updateSettings('image_export_format', v)}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{IMAGE_FORMATS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>图片质量：{settings.image_export_quality}%</Label>
                <input type="range" min={60} max={100} step={5}
                  value={settings.image_export_quality}
                  onChange={e => updateSettings('image_export_quality', Number(e.target.value))}
                  className="mt-2 w-full accent-primary" />
              </div>
              <div><Label>PDF 页面尺寸</Label>
                <Select value={settings.pdf_page_size} onValueChange={v => updateSettings('pdf_page_size', v)}>
                  <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{PDF_SIZES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">视频导出参数（预留，待接入合成工具后开放）</p>
          </CardContent>
        </Card>

        {/* 存储设置 */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-yellow-400" />存储与清理
            </h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3">
              {[
                { type: 'failed' as const, label: '清理失败 / 超时视频任务', desc: '删除状态为 failed / expired / timeout 的视频任务记录' },
                { type: 'cache' as const, label: '清理临时文件', desc: '清理本地缓存的临时数据' },
                { type: 'temp' as const, label: '清理空草稿', desc: '删除没有任何元素的条漫草稿' },
              ].map(({ type, label, desc }) => (
                <div key={type} className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => { setClearType(type); setClearCacheOpen(true); }}>
                    <Trash2 className="w-4 h-4 mr-1" />清理
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 关于 */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">动画大丸家 3.0</div>
                <div className="text-xs text-muted-foreground">AI 创作平台 · 单用户工具版</div>
              </div>
              <Badge variant="outline">v3.0.0</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={clearCacheOpen} onOpenChange={open => !open && setClearCacheOpen(false)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>确认清理？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销，确定要执行清理吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleClear} className="bg-destructive text-destructive-foreground">确认清理</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
