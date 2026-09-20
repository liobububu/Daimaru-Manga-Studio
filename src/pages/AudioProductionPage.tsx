import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '@/components/layouts/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Mic, Volume2, Play, Pause, Download, Trash2, Plus, Star, StarOff,
  Clock, CheckCircle, XCircle, Loader2, Music, User, RefreshCw, Wifi, WifiOff,
  AlertTriangle, Copy, Zap, Upload, SlidersHorizontal, Film, Unlink,
  Users, Sparkles, MessageSquare, Wand2, ArrowLeftRight, Cpu,
} from 'lucide-react';
// Subtitles not in lucide-react — use a fallback
const Subtitles = MessageSquare;
import { toast } from 'sonner';
import {
  getApiConfigs, getModelCatalog, getStoryboards,
  getVoiceProfiles, createVoiceProfile, updateVoiceProfile, deleteVoiceProfile,
  getAudioGenerationRecords, generateTts, testAudioProvider,
  syncFishVoices, createFishVoice, bindStoryboardAudio, transcribeAudio, convertVoice,
} from '@/services/api';
import type { AsrSegment, AsrResult } from '@/services/api';
import type { ApiConfig, ModelCatalog, VoiceProfile, AudioGenerationRecord, TtsParamDef, Storyboard } from '@/types/types';
import type { AudioProviderTestResult } from '@/services/api';
import { useProject } from '@/contexts/ProjectContext';

// ─── 通用 TTS 参数（基础集）──────────────────────────────────────────────────
interface TtsParams {
  format: string;
  speed: number;
  volume: number;
  temperature: number;
  top_p: number;
  sample_rate: number;
  chunk_length: number;
  [key: string]: unknown;
}

const DEFAULT_PARAMS: TtsParams = {
  format: 'mp3',
  speed: 1,
  volume: 0,
  temperature: 0.7,
  top_p: 0.7,
  sample_rate: 44100,
  chunk_length: 300,
};

// ─── 来源标签 ─────────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    manual:  { label: '手动添加', cls: 'bg-secondary text-secondary-foreground' },
    synced:  { label: '已同步',   cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    created: { label: '已创建',   cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  };
  const s = map[source || 'manual'] || map.manual;
  return <Badge variant="outline" className={`text-xs shrink-0 ${s.cls}`}>{s.label}</Badge>;
}

// ─── 声音配置弹窗（手动添加 / 编辑） ─────────────────────────────────────────
function VoiceProfileDialog({
  open, onOpenChange, profile, apiConfigs, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile?: VoiceProfile;
  apiConfigs: ApiConfig[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '', voice_id: '', gender: '', language: '',
    description: '', is_default: false,
    api_config_id: '' as string,
    style_tags_str: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (profile) {
        setForm({
          name: profile.name,
          voice_id: profile.voice_id,
          gender: profile.gender || '',
          language: profile.language || '',
          description: profile.description || '',
          is_default: profile.is_default,
          api_config_id: profile.api_config_id || '',
          style_tags_str: (profile.style_tags || []).join('，'),
        });
      } else {
        setForm({ name: '', voice_id: '', gender: '', language: '', description: '', is_default: false, api_config_id: '', style_tags_str: '' });
      }
    }
  }, [open, profile]);

  async function handleSave() {
    if (!form.name.trim() || !form.voice_id.trim()) {
      toast.error('请填写声音名称和 Voice ID / reference_id');
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        voice_id: form.voice_id.trim(),
        gender: form.gender || undefined,
        language: form.language || undefined,
        description: form.description || undefined,
        is_default: form.is_default,
        api_config_id: form.api_config_id || undefined,
        style_tags: form.style_tags_str ? form.style_tags_str.split(/[，,]/).map(s => s.trim()).filter(Boolean) : [],
        source: (profile?.source || 'manual') as VoiceProfile['source'],
      };
      if (profile) {
        await updateVoiceProfile(profile.id, data);
        toast.success('声音配置已更新');
      } else {
        await createVoiceProfile({ ...data, source: 'manual' });
        toast.success('声音已添加到声音库');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? '编辑声音配置' : '手动添加声音'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>声音名称 *</Label>
            <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：旁白-沉稳男声" />
          </div>
          <div>
            <Label>Voice ID *</Label>
            <Input className="mt-1 font-mono text-sm" value={form.voice_id} onChange={e => setForm(f => ({ ...f, voice_id: e.target.value }))} placeholder="TTS 服务对应的声音 ID（voice / speaker / reference_id 等）" />
            <p className="text-xs text-muted-foreground mt-1">不同供应商字段名不同，统一填入该声音在 TTS 服务中的唯一标识</p>
          </div>
          <div>
            <Label>关联 API 配置</Label>
            <Select value={form.api_config_id || 'none'} onValueChange={v => setForm(f => ({ ...f, api_config_id: v === 'none' ? '' : v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="不限（通用）" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不限（通用）</SelectItem>
                {apiConfigs.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>性别</Label>
              <Select value={form.gender || 'unset'} onValueChange={v => setForm(f => ({ ...f, gender: v === 'unset' ? '' : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="未设置" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">未设置</SelectItem>
                  <SelectItem value="male">男</SelectItem>
                  <SelectItem value="female">女</SelectItem>
                  <SelectItem value="neutral">中性</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>语言</Label>
              <Input className="mt-1" value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} placeholder="zh / en / ja" />
            </div>
          </div>
          <div>
            <Label>风格标签（逗号分隔）</Label>
            <Input className="mt-1" value={form.style_tags_str} onChange={e => setForm(f => ({ ...f, style_tags_str: e.target.value }))} placeholder="新闻，解说，活泼" />
          </div>
          <div>
            <Label>描述</Label>
            <Textarea className="mt-1 resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="简短描述该声音的特点" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="vp-default" checked={form.is_default} onCheckedChange={v => setForm(f => ({ ...f, is_default: v }))} />
            <Label htmlFor="vp-default">设为默认声音</Label>
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

// ─── 创建声音模型弹窗 ─────────────────────────────────────────────────────────
function CreateVoiceDialog({
  open, onOpenChange, apiConfigs, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  apiConfigs: ApiConfig[];
  onCreated: () => void;
}) {
  const [name, setName]         = useState('');
  const [apiConfigId, setApiConfigId] = useState('');
  const [audioFile, setAudioFile]     = useState<File | null>(null);
  const [refText, setRefText]   = useState('');
  const [language, setLanguage] = useState('');
  const [tags, setTags]         = useState('');
  const [visibility, setVisibility] = useState('private');
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(''); setApiConfigId(''); setAudioFile(null);
      setRefText(''); setLanguage(''); setTags(''); setVisibility('private');
    }
  }, [open]);

  async function handleCreate() {
    if (!name.trim()) { toast.error('请填写声音名称'); return; }
    if (!audioFile)   { toast.error('请上传参考音频'); return; }
    if (!apiConfigId) { toast.error('请选择 API 配置'); return; }

    setCreating(true);
    try {
      await createFishVoice({
        api_config_id: apiConfigId,
        name: name.trim(),
        audio: audioFile,
        reference_text: refText || undefined,
        language: language || undefined,
        tags: tags || undefined,
        visibility,
      });
      toast.success('声音模型创建成功，已加入声音库');
      onCreated();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.error(`创建失败：${msg}`, { duration: 8000 });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            上传参考音频创建声音模型
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>声音名称 *</Label>
            <Input className="mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="如：我的旁白声" />
          </div>
          <div>
            <Label>关联 API 配置 *</Label>
            <Select value={apiConfigId || 'none'} onValueChange={v => setApiConfigId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="选择 API 配置" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">请选择…</SelectItem>
                {apiConfigs.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>参考音频 *</Label>
            <div
              className="mt-1 border-2 border-dashed border-border rounded-lg px-4 py-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {audioFile ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <Music className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-foreground truncate max-w-[200px]">{audioFile.name}</span>
                  <span className="text-muted-foreground shrink-0">({(audioFile.size / 1024).toFixed(0)} KB)</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">点击选择音频文件</p>
                  <p className="text-xs text-muted-foreground">支持 MP3 / WAV / M4A · 建议 10-30 秒清晰人声</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,.m4a,.flac,audio/*"
              className="hidden"
              onChange={e => setAudioFile(e.target.files?.[0] || null)}
            />
          </div>
          <div>
            <Label>参考文本（可选，建议填写）</Label>
            <Textarea
              className="mt-1 resize-none text-sm"
              rows={2}
              value={refText}
              onChange={e => setRefText(e.target.value)}
              placeholder="音频对应的台词内容，可提升声音模型质量"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>语言（可选）</Label>
              <Input className="mt-1" value={language} onChange={e => setLanguage(e.target.value)} placeholder="zh / en / ja" />
            </div>
            <div>
              <Label>可见性</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私有（推荐）</SelectItem>
                  <SelectItem value="unlist">不公开</SelectItem>
                  <SelectItem value="public">公开</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>标签（逗号分隔，可选）</Label>
            <Input className="mt-1" value={tags} onChange={e => setTags(e.target.value)} placeholder="旁白，男声，沉稳" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={creating}>取消</Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim() || !audioFile || !apiConfigId}>
            {creating ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />创建中…</> : '创建声音模型'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 同步声音弹窗 ─────────────────────────────────────────────────────────────
function SyncVoicesDialog({
  open, onOpenChange, apiConfigs, onSynced, onManualAdd, onCreateVoice,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  apiConfigs: ApiConfig[];
  onSynced: () => void;
  onManualAdd?: () => void;
  onCreateVoice?: () => void;
}) {
  const [apiConfigId, setApiConfigId] = useState('');
  const [syncing, setSyncing]         = useState(false);
  const [result, setResult]           = useState<{ added: number; updated: number } | null>(null);
  const [syncErr, setSyncErr]         = useState<{ msg: string; type?: string } | null>(null);

  useEffect(() => { if (open) { setApiConfigId(''); setResult(null); setSyncErr(null); } }, [open]);

  async function handleSync() {
    if (!apiConfigId) { toast.error('请选择 API 配置'); return; }
    setSyncing(true);
    setResult(null);
    setSyncErr(null);
    try {
      const r = await syncFishVoices(apiConfigId);
      setResult({ added: r.added, updated: r.updated });
      if (r.synced === 0) {
        toast.info('没有同步到 Fish Audio 声音模型。你可以手动添加 Voice ID，或上传参考音频创建声音模型。');
      } else {
        toast.success(`同步成功：新增 ${r.added} 个，更新 ${r.updated} 个声音`);
        onSynced();
      }
    } catch (e) {
      const err = e as Error & { errorType?: string };
      setSyncErr({ msg: err.message, type: err.errorType });
    } finally {
      setSyncing(false);
    }
  }

  const isNetworkTimeout = syncErr?.type === 'network_timeout' || syncErr?.type === 'network';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            同步声音到声音库
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            从 TTS 服务账号同步「我的声音」到本地声音库，已存在的声音会自动更新。
          </p>
          <div>
            <Label>选择 API 配置 *</Label>
            <Select value={apiConfigId || 'none'} onValueChange={v => setApiConfigId(v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="选择配置…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">请选择…</SelectItem>
                {apiConfigs.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 错误提示 */}
          {syncErr && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 space-y-2">
              <p className="text-sm text-destructive font-medium flex items-start gap-1.5">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {isNetworkTimeout
                  ? '服务端无法连接到该 TTS 服务（网络超时）'
                  : '同步失败'}
              </p>
              {isNetworkTimeout ? (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    这是服务器侧的网络限制，与您的 API Key 无关。您可以：
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {onManualAdd && (
                      <Button size="sm" variant="secondary" onClick={() => { onOpenChange(false); onManualAdd(); }}>
                        手动添加 Voice ID
                      </Button>
                    )}
                    {onCreateVoice && (
                      <Button size="sm" variant="secondary" onClick={() => { onOpenChange(false); onCreateVoice(); }}>
                        上传参考音频创建
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">{syncErr.msg}</p>
              )}
            </div>
          )}

          {/* 成功结果 */}
          {result && !syncErr && (
            <div className={`rounded-md px-3 py-2.5 text-sm ${
              result.added + result.updated === 0
                ? 'bg-muted text-muted-foreground'
                : 'bg-green-500/10 border border-green-500/30 text-green-400'
            }`}>
              {result.added + result.updated === 0
                ? '未同步到任何声音，请检查 API 配置及账号下是否有声音。'
                : `✓ 新增 ${result.added} 个声音，更新 ${result.updated} 个声音`
              }
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={syncing}>关闭</Button>
          <Button onClick={handleSync} disabled={syncing || !apiConfigId}>
            {syncing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />同步中…</> : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />开始同步</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 音频播放器 ───────────────────────────────────────────────────────────────
function AudioPlayer({ url, small }: { url: string; small?: boolean }) {
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setProgress(el.currentTime);
    const onLoad = () => setDuration(el.duration);
    const onEnd  = () => { setPlaying(false); setProgress(0); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onLoad);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onLoad);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().then(() => setPlaying(true)).catch(() => toast.error('播放失败')); }
  }

  function fmt(s: number) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <audio ref={audioRef} src={url} preload="metadata" />
      <Button variant="secondary" size="icon" className={small ? 'h-7 w-7' : 'h-8 w-8'} onClick={toggle}>
        {playing
          ? <Pause className={small ? 'w-3 h-3' : 'w-4 h-4'} />
          : <Play  className={small ? 'w-3 h-3' : 'w-4 h-4'} />}
      </Button>
      {!small && (
        <>
          <div className="flex-1 min-w-0 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all"
              style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : '0%' }} />
          </div>
          <span className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">
            {fmt(progress)}/{fmt(duration)}
          </span>
        </>
      )}
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function AudioProductionPage() {
  const navigate = useNavigate();
  // 数据
  const [apiConfigs, setApiConfigs]   = useState<ApiConfig[]>([]);
  const [models, setModels]           = useState<ModelCatalog[]>([]);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [records, setRecords]         = useState<AudioGenerationRecord[]>([]);
  const [loading, setLoading]         = useState(true);

  // TTS 表单
  const [text, setText]               = useState('');
  const [selectedModelId, setSelectedModelId]             = useState('');
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState('');
  const [manualVoiceId, setManualVoiceId]   = useState('');
  const [voiceMode, setVoiceMode]           = useState<'library' | 'manual' | 'none'>('library');
  const [params, setParams]                 = useState<TtsParams>(DEFAULT_PARAMS);
  const [generating, setGenerating]         = useState(false);
  const [lastResult, setLastResult]         = useState<{ url: string; text: string } | null>(null);

  // 声音库 UI 状态
  const [vpDialogOpen, setVpDialogOpen]     = useState(false);
  const [editingVp, setEditingVp]           = useState<VoiceProfile | undefined>();
  const [deleteVpId, setDeleteVpId]         = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [createVoiceOpen, setCreateVoiceOpen] = useState(false);

  // 连通性测试
  const [netTesting, setNetTesting] = useState(false);
  const [netResult, setNetResult]   = useState<AudioProviderTestResult | null>(null);

  // tab 控制（空状态跳转用）
  const [activeTab, setActiveTab] = useState('tts');

  // ── 分镜配音状态 ──────────────────────────────────────────────────────────────
  const { selectedProjectId } = useProject();
  const [sbStoryboards, setSbStoryboards] = useState<Storyboard[]>([]);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbScope, setSbScope] = useState<'all' | 'voiceover' | 'dialogue' | 'unvoiced'>('all');
  const [sbApiConfigId, setSbApiConfigId] = useState('');
  const [sbVoiceProfile, setSbVoiceProfile] = useState('');
  const [sbGenStates, setSbGenStates] = useState<Record<string, 'pending' | 'generating' | 'done' | 'error'>>({});
  const [sbBatchRunning, setSbBatchRunning] = useState(false);
  const [sbPlayingKey, setSbPlayingKey] = useState<string | null>(null);
  const sbAudioRefs = useRef<Record<string, HTMLAudioElement>>({});

  async function loadSbStoryboards() {
    if (!selectedProjectId) return;
    setSbLoading(true);
    try {
      const data = await getStoryboards(selectedProjectId);
      setSbStoryboards(data);
    } catch { toast.error('加载分镜失败'); }
    finally { setSbLoading(false); }
  }

  // 计算配音范围内的行
  function getSbRows() {
    const rows: { storyboard: Storyboard; type: 'voiceover' | 'dialogue'; text: string }[] = [];
    for (const s of sbStoryboards) {
      if ((sbScope === 'all' || sbScope === 'voiceover' || sbScope === 'unvoiced') && s.voiceover?.trim()) {
        if (sbScope !== 'unvoiced' || !s.voiceover_audio?.file_url) {
          rows.push({ storyboard: s, type: 'voiceover', text: s.voiceover });
        }
      }
      if ((sbScope === 'all' || sbScope === 'dialogue' || sbScope === 'unvoiced') && s.dialogue?.trim()) {
        if (sbScope !== 'unvoiced' || !s.dialogue_audio?.file_url) {
          rows.push({ storyboard: s, type: 'dialogue', text: s.dialogue });
        }
      }
    }
    return rows;
  }

  async function handleSbGenOne(storyboardId: string, type: 'voiceover' | 'dialogue', text: string) {
    if (!sbApiConfigId) throw new Error('请先选择语音模型');
    const modelEntry = ttsModels.find(m => m.api_config_id === sbApiConfigId);
    if (!modelEntry) throw new Error('未找到对应语音模型配置');
    const key = `${storyboardId}_${type}`;
    setSbGenStates(prev => ({ ...prev, [key]: 'generating' }));
    try {
      const result = await generateTts({
        model_catalog_id: modelEntry.id,
        text: text.trim(),
        voice_profile_id: (sbVoiceProfile && sbVoiceProfile !== 'default') ? sbVoiceProfile : undefined,
        project_id: selectedProjectId || undefined,
      });
      // 将生成的音频资产绑定到分镜
      if (result?.asset?.id) {
        await bindStoryboardAudio(storyboardId, result.asset.id, type);
      }
      setSbGenStates(prev => ({ ...prev, [key]: 'done' }));
    } catch (e) {
      setSbGenStates(prev => ({ ...prev, [key]: 'error' }));
      toast.error(`生成失败：${e instanceof Error ? e.message : '未知错误'}`);
      throw e;
    }
  }

  async function handleSbBatch() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!sbApiConfigId) { toast.error('请先选择语音模型'); return; }
    const rows = getSbRows();
    if (rows.length === 0) { toast.error('没有符合范围的分镜文本'); return; }
    setSbBatchRunning(true);
    let success = 0;
    let fail = 0;
    for (const row of rows) {
      try {
        await handleSbGenOne(row.storyboard.id, row.type, row.text);
        success++;
      } catch { fail++; }
    }
    await loadSbStoryboards();
    setSbBatchRunning(false);
    toast.success(`批量配音完成：成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`);
  }

  function handleSbPlay(key: string, url: string) {
    const prev = sbAudioRefs.current[sbPlayingKey ?? ''];
    if (sbPlayingKey === key && prev) { prev.pause(); setSbPlayingKey(null); return; }
    if (prev) prev.pause();
    const audio = new Audio(url);
    sbAudioRefs.current[key] = audio;
    audio.onended = () => setSbPlayingKey(null);
    audio.play().then(() => setSbPlayingKey(key)).catch(() => toast.error('播放失败'));
  }

  const sbStatusBadge = (key: string, hasAudio: boolean) => {
    const state = sbGenStates[key];
    if (state === 'generating') return <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30"><Loader2 className="w-3 h-3 mr-1 animate-spin" />生成中</Badge>;
    if (state === 'error') return <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />失败</Badge>;
    if (state === 'done' || hasAudio) return <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />已生成</Badge>;
    return <Badge variant="outline" className="text-xs text-muted-foreground">未生成</Badge>;
  };

  // ── 多角色对话状态 ──────────────────────────────────────────────────────────
  interface DialogueLine {
    id: string;
    character: string;
    text: string;
    voice_profile_id: string;
    emotion: string;
    pause_ms: number;
    status: 'idle' | 'generating' | 'done' | 'error';
    audio_url?: string;
    asset_id?: string;
    error?: string;
  }
  const newLine = (): DialogueLine => ({
    id: crypto.randomUUID(), character: '', text: '', voice_profile_id: '',
    emotion: '', pause_ms: 300, status: 'idle',
  });
  const [msLines, setMsLines] = useState<DialogueLine[]>([newLine(), newLine()]);
  const [msModelId, setMsModelId] = useState('');
  const [msRunning, setMsRunning] = useState(false);
  const [msPlayingId, setMsPlayingId] = useState<string | null>(null);
  const msAudioRefs = useRef<Record<string, HTMLAudioElement>>({});

  function msUpdateLine(id: string, patch: Partial<DialogueLine>) {
    setMsLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }
  function msRemoveLine(id: string) {
    setMsLines(prev => prev.filter(l => l.id !== id));
  }
  function msInsertLineAfter(id: string) {
    setMsLines(prev => {
      const idx = prev.findIndex(l => l.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, newLine());
      return next;
    });
  }

  async function handleMsGenerate() {
    if (!msModelId) { toast.error('请先选择语音模型'); return; }
    const modelEntry = ttsModels.find(m => m.id === msModelId);
    if (!modelEntry) { toast.error('模型配置异常'); return; }
    const linesToGen = msLines.filter(l => l.text.trim());
    if (linesToGen.length === 0) { toast.error('请输入至少一行台词'); return; }

    setMsRunning(true);
    let success = 0;
    for (const line of linesToGen) {
      msUpdateLine(line.id, { status: 'generating', error: undefined });
      try {
        const result = await generateTts({
          model_catalog_id: msModelId,
          text: line.text.trim(),
          voice_profile_id: line.voice_profile_id || undefined,
          project_id: selectedProjectId || undefined,
        });
        msUpdateLine(line.id, {
          status: 'done',
          audio_url: result.asset?.file_url,
          asset_id: result.asset?.id,
        });
        success++;
      } catch (e) {
        msUpdateLine(line.id, { status: 'error', error: e instanceof Error ? e.message : '未知错误' });
      }
    }
    setMsRunning(false);
    toast.success(`多角色配音完成：成功 ${success}/${linesToGen.length} 条`);
  }

  function handleMsPlay(id: string, url: string) {
    const prev = msAudioRefs.current[msPlayingId ?? ''];
    if (msPlayingId === id && prev) { prev.pause(); setMsPlayingId(null); return; }
    if (prev) prev.pause();
    const audio = new Audio(url);
    msAudioRefs.current[id] = audio;
    audio.onended = () => setMsPlayingId(null);
    audio.play().then(() => setMsPlayingId(id)).catch(() => toast.error('播放失败'));
  }

  // ── 多段音频拼接 ──────────────────────────────────────────────────────────────
  const [msMerging, setMsMerging] = useState(false);
  // 角色→声音库映射：character → voice_profile_id
  const [msCharMap, setMsCharMap] = useState<Record<string, string>>({});

  /** 修改角色声音映射，同步更新相同角色的所有行 */
  function msSetCharVoice(character: string, vpId: string) {
    setMsCharMap(prev => ({ ...prev, [character]: vpId }));
    setMsLines(prev => prev.map(l =>
      l.character === character ? { ...l, voice_profile_id: vpId } : l
    ));
  }

  /** Web Audio API 编码 WAV：Float32 PCM → Uint8Array */
  function encodeWav(buffer: AudioBuffer): Uint8Array {
    const numCh      = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numFrames  = buffer.length;
    const byteDepth  = 2; // 16-bit PCM
    const dataLen    = numFrames * numCh * byteDepth;
    const wavLen     = 44 + dataLen;
    const out        = new DataView(new ArrayBuffer(wavLen));
    let o = 0;
    const writeStr  = (s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o++, s.charCodeAt(i)); };
    const writeU32  = (v: number) => { out.setUint32(o, v, true); o += 4; };
    const writeU16  = (v: number) => { out.setUint16(o, v, true); o += 2; };
    // RIFF header
    writeStr('RIFF'); writeU32(wavLen - 8); writeStr('WAVE');
    // fmt  chunk
    writeStr('fmt '); writeU32(16); writeU16(1 /* PCM */); writeU16(numCh);
    writeU32(sampleRate); writeU32(sampleRate * numCh * byteDepth); writeU16(numCh * byteDepth); writeU16(16);
    // data chunk
    writeStr('data'); writeU32(dataLen);
    // interleave channels
    const channels = Array.from({ length: numCh }, (_, ch) => buffer.getChannelData(ch));
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, channels[ch][i]));
        out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
      }
    }
    return new Uint8Array(out.buffer);
  }

  /** 合并所有已生成行的音频为一条 WAV，行间插入 pause_ms 静音 */
  async function handleMsMerge() {
    const ready = msLines.filter(l => l.status === 'done' && l.audio_url);
    if (ready.length === 0) { toast.error('没有已生成的音频可合并，请先逐条生成'); return; }
    setMsMerging(true);
    try {
      const ctx = new AudioContext();
      const decoded: AudioBuffer[] = [];
      for (const line of ready) {
        const resp = await fetch(line.audio_url!);
        const ab   = await resp.arrayBuffer();
        decoded.push(await ctx.decodeAudioData(ab));
      }
      // 统一 sampleRate 用第一个的
      const sampleRate = decoded[0].sampleRate;
      const numCh      = Math.max(...decoded.map(d => d.numberOfChannels));
      // 计算总帧数（含停顿）
      let totalFrames = 0;
      const pauseFrames = msLines
        .filter(l => l.status === 'done' && l.audio_url)
        .map(l => Math.floor(((l.pause_ms ?? 0) / 1000) * sampleRate));
      decoded.forEach((d, i) => { totalFrames += d.length + pauseFrames[i]; });

      const merged = ctx.createBuffer(numCh, totalFrames, sampleRate);
      let offset = 0;
      decoded.forEach((d, i) => {
        for (let ch = 0; ch < numCh; ch++) {
          const src  = ch < d.numberOfChannels ? d.getChannelData(ch) : new Float32Array(d.length);
          merged.getChannelData(ch).set(src, offset);
        }
        offset += d.length + pauseFrames[i];
      });
      await ctx.close();
      const wav  = encodeWav(merged);
      const blob = new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a'); a.href = url; a.download = '多角色对话.wav'; a.click();
      URL.revokeObjectURL(url);
      toast.success(`合并完成，已导出 ${ready.length} 段音频`);
    } catch (e) {
      toast.error(`合并失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setMsMerging(false);
    }
  }

  // ── 声音克隆状态 ──────────────────────────────────────────────────────────────
  const [vcApiConfigId, setVcApiConfigId] = useState('');
  const [vcName, setVcName] = useState('');
  const [vcAudioFile, setVcAudioFile] = useState<File | null>(null);
  const [vcRefText, setVcRefText] = useState('');
  const [vcLanguage, setVcLanguage] = useState('');
  const [vcLoading, setVcLoading] = useState(false);
  const vcFileRef = useRef<HTMLInputElement>(null);

  async function handleVoiceClone() {
    if (!vcApiConfigId) { toast.error('请选择 API 配置（Fish Audio）'); return; }
    if (!vcName.trim()) { toast.error('请填写声音名称'); return; }
    if (!vcAudioFile)   { toast.error('请上传参考音频'); return; }
    setVcLoading(true);
    try {
      const vp = await createFishVoice({
        api_config_id: vcApiConfigId,
        name: vcName.trim(),
        audio: vcAudioFile,
        reference_text: vcRefText || undefined,
        language: vcLanguage || undefined,
      });
      toast.success(`声音「${vp.name}」克隆成功，已保存到声音库`);
      setVcName(''); setVcAudioFile(null); setVcRefText(''); setVcLanguage('');
      if (vcFileRef.current) vcFileRef.current.value = '';
      await loadData();   // 刷新声音库
    } catch (e) {
      toast.error(`克隆失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setVcLoading(false);
    }
  }

  // ── 音频转文字（ASR）状态 ──────────────────────────────────────────────────
  const [asrApiConfigId, setAsrApiConfigId] = useState('');
  const [asrAudioFile, setAsrAudioFile] = useState<File | null>(null);
  const [asrLanguage, setAsrLanguage] = useState('');
  const [asrLoading, setAsrLoading] = useState(false);
  const [asrResult, setAsrResult] = useState<AsrResult | null>(null);
  const asrFileRef = useRef<HTMLInputElement>(null);

  // ASR 可用 API 配置：有 audio_asr_path 字段的配置
  const asrApiConfigs = apiConfigs.filter(c => c.enabled && c.audio_asr_path);

  async function handleAsrTranscribe() {
    if (!asrApiConfigId) { toast.error('请选择 ASR 配置'); return; }
    if (!asrAudioFile)   { toast.error('请上传音频文件'); return; }
    setAsrLoading(true); setAsrResult(null);
    try {
      const result = await transcribeAudio({
        api_config_id: asrApiConfigId,
        audio: asrAudioFile,
        language: asrLanguage || undefined,
        project_id: selectedProjectId || undefined,
      });
      setAsrResult(result);
      toast.success('识别完成');
    } catch (e) {
      toast.error(`识别失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setAsrLoading(false);
    }
  }

  function asrExportTxt() {
    if (!asrResult) return;
    const blob = new Blob([asrResult.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'transcript.txt'; a.click();
    URL.revokeObjectURL(url);
  }

  function asrExportSrt() {
    if (!asrResult?.segments?.length) return;
    const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
    const toSrtTime = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.round((s % 1) * 1000);
      return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, '0')}`;
    };
    const lines = asrResult.segments.map((seg, i) =>
      `${i + 1}\n${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n${seg.text}\n`
    ).join('\n');
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'subtitles.srt'; a.click();
    URL.revokeObjectURL(url);
  }

  function asrExportVtt() {
    if (!asrResult?.segments?.length) return;
    const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
    const toVttTime = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.round((s % 1) * 1000);
      return `${pad(h)}:${pad(m)}:${pad(sec)}.${String(ms).padStart(3, '0')}`;
    };
    const header = 'WEBVTT\n\n';
    const lines = asrResult.segments.map((seg, i) =>
      `${i + 1}\n${toVttTime(seg.start)} --> ${toVttTime(seg.end)}\n${seg.text}\n`
    ).join('\n');
    const blob = new Blob([header + lines], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'subtitles.vtt'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── 字幕生成状态（从分镜台词导出）──────────────────────────────────────────
  const [subStoryboards, setSubStoryboards] = useState<Storyboard[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subScope, setSubScope] = useState<'all' | 'voiceover' | 'dialogue'>('all');

  async function loadSubStoryboards() {
    if (!selectedProjectId) return;
    setSubLoading(true);
    try {
      const data = await getStoryboards(selectedProjectId);
      setSubStoryboards(data);
    } catch { /* ignore */ } finally {
      setSubLoading(false);
    }
  }

  function buildSubLines(): { index: number; type: string; character: string; text: string }[] {
    const lines: { index: number; type: string; character: string; text: string }[] = [];
    subStoryboards.forEach((sb, i) => {
      if ((subScope === 'all' || subScope === 'voiceover') && sb.voiceover?.trim()) {
        lines.push({ index: i + 1, type: '旁白', character: '旁白', text: sb.voiceover.trim() });
      }
      if ((subScope === 'all' || subScope === 'dialogue') && sb.dialogue?.trim()) {
        const character = sb.character_action || '角色';
        lines.push({ index: i + 1, type: '对白', character, text: sb.dialogue.trim() });
      }
    });
    return lines;
  }

  function subExport(format: 'txt' | 'srt' | 'vtt' | 'csv') {
    const lines = buildSubLines();
    if (lines.length === 0) { toast.error('当前分镜没有可导出的台词'); return; }
    let content = '';
    let mime = 'text/plain;charset=utf-8';
    let ext = format;
    if (format === 'txt') {
      content = lines.map(l => `[${l.character}] ${l.text}`).join('\n');
    } else if (format === 'srt') {
      content = lines.map((l, i) =>
        `${i + 1}\n00:00:00,000 --> 00:00:05,000\n[${l.character}] ${l.text}\n`
      ).join('\n');
    } else if (format === 'vtt') {
      content = 'WEBVTT\n\n' + lines.map((l, i) =>
        `${i + 1}\n00:00:00.000 --> 00:00:05.000\n[${l.character}] ${l.text}\n`
      ).join('\n');
      mime = 'text/vtt;charset=utf-8';
    } else if (format === 'csv') {
      const header = '序号,分镜,类型,角色,台词\n';
      content = header + lines.map((l, i) =>
        `${i + 1},${l.index},${l.type},${l.character},"${l.text.replace(/"/g, '""')}"`
      ).join('\n');
      mime = 'text/csv;charset=utf-8'; ext = 'csv';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `subtitles.${ext}`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${format.toUpperCase()} 字幕文件`);
  }

  // ── P2：声音设计状态 ──────────────────────────────────────────────────────
  interface VoiceDesignSample {
    id: string;
    voiceProfileId: string;
    voiceName: string;
    audioUrl?: string;
    status: 'idle' | 'generating' | 'done' | 'error';
    error?: string;
  }
  const [vdSampleText, setVdSampleText] = useState('这是一段声音设计试听样本，请仔细聆听音色特点。');
  const [vdSelectedProfiles, setVdSelectedProfiles] = useState<string[]>([]);
  const [vdModelId, setVdModelId] = useState('');
  const [vdSamples, setVdSamples] = useState<VoiceDesignSample[]>([]);
  const [vdRunning, setVdRunning] = useState(false);
  const [vdPlayingId, setVdPlayingId] = useState<string | null>(null);
  const vdAudioRefs = useRef<Record<string, HTMLAudioElement>>({});

  function vdToggleProfile(id: string) {
    setVdSelectedProfiles(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function handleVdGenerate() {
    if (!vdModelId) { toast.error('请先选择语音模型'); return; }
    if (!vdSampleText.trim()) { toast.error('请输入试听文本'); return; }
    const profiles = vdSelectedProfiles.length > 0
      ? voiceProfiles.filter(vp => vdSelectedProfiles.includes(vp.id))
      : voiceProfiles.slice(0, 5);  // 最多取前5个
    if (profiles.length === 0) { toast.error('声音库为空，请先添加声音'); return; }

    const initial: VoiceDesignSample[] = profiles.map(vp => ({
      id: vp.id, voiceProfileId: vp.id, voiceName: vp.name,
      status: 'idle',
    }));
    setVdSamples(initial);
    setVdRunning(true);

    for (const vp of profiles) {
      setVdSamples(prev => prev.map(s =>
        s.voiceProfileId === vp.id ? { ...s, status: 'generating' } : s
      ));
      try {
        const result = await generateTts({
          model_catalog_id: vdModelId,
          text: vdSampleText.trim(),
          voice_profile_id: vp.id,
          project_id: selectedProjectId || undefined,
        });
        setVdSamples(prev => prev.map(s =>
          s.voiceProfileId === vp.id
            ? { ...s, status: 'done', audioUrl: result.asset?.file_url }
            : s
        ));
      } catch (e) {
        setVdSamples(prev => prev.map(s =>
          s.voiceProfileId === vp.id
            ? { ...s, status: 'error', error: e instanceof Error ? e.message : '生成失败' }
            : s
        ));
      }
    }
    setVdRunning(false);
    toast.success('声音采样完成');
  }

  function vdPlay(sampleId: string, url: string) {
    const prev = vdAudioRefs.current[sampleId];
    if (vdPlayingId === sampleId && prev) { prev.pause(); setVdPlayingId(null); return; }
    Object.values(vdAudioRefs.current).forEach(a => a.pause());
    setVdPlayingId(null);
    const audio = new Audio(url);
    vdAudioRefs.current[sampleId] = audio;
    audio.onended = () => setVdPlayingId(null);
    audio.play().then(() => setVdPlayingId(sampleId)).catch(() => toast.error('播放失败'));
  }

  // ── P2：声音转换状态 ──────────────────────────────────────────────────────
  // API 配置：有 voice_conversion_path 字段
  const vcvApiConfigs = apiConfigs.filter(c => c.enabled && c.voice_conversion_path);
  const [vcvApiConfigId, setVcvApiConfigId] = useState('');
  const [vcvSourceFile, setVcvSourceFile] = useState<File | null>(null);
  const [vcvTargetVpId, setVcvTargetVpId] = useState('');
  const [vcvLoading, setVcvLoading] = useState(false);
  const [vcvResultUrl, setVcvResultUrl] = useState<string | null>(null);
  const vcvFileRef = useRef<HTMLInputElement>(null);

  async function handleVcvConvert() {
    if (!vcvApiConfigId) { toast.error('请选择声音转换配置'); return; }
    if (!vcvSourceFile)  { toast.error('请上传源音频文件'); return; }
    if (!vcvTargetVpId)  { toast.error('请选择目标声音'); return; }
    setVcvLoading(true); setVcvResultUrl(null);
    try {
      const result = await convertVoice({
        api_config_id: vcvApiConfigId,
        audio: vcvSourceFile,
        voice_profile_id: vcvTargetVpId,
        project_id: selectedProjectId || undefined,
      });
      const url = result.audio_url || result.asset?.file_url;
      if (url) {
        setVcvResultUrl(url);
        toast.success('声音转换完成');
      } else {
        toast.error('转换完成但未返回音频地址');
      }
    } catch (e) {
      toast.error(`转换失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setVcvLoading(false);
    }
  }

  // ── P2：音频增强状态（浏览器端 Web Audio API）──────────────────────────────
  const [enhFile, setEnhFile] = useState<File | null>(null);
  const [enhProcessing, setEnhProcessing] = useState(false);
  const [enhResultUrl, setEnhResultUrl] = useState<string | null>(null);
  const [enhResultName, setEnhResultName] = useState('');
  const [enhNormalize, setEnhNormalize] = useState(true);
  const [enhTrimSilence, setEnhTrimSilence] = useState(false);
  const [enhSilenceThreshold, setEnhSilenceThreshold] = useState(-40); // dB
  const enhFileRef = useRef<HTMLInputElement>(null);

  async function handleEnhProcess() {
    if (!enhFile) { toast.error('请上传音频文件'); return; }
    setEnhProcessing(true); setEnhResultUrl(null);
    try {
      const ctx = new AudioContext();
      const ab  = await enhFile.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab.slice(0));

      const numCh = buf.numberOfChannels;
      const sr    = buf.sampleRate;
      let   data  = Array.from({ length: numCh }, (_, ch) =>
        new Float32Array(buf.getChannelData(ch))
      );

      // ① 响度归一化
      if (enhNormalize) {
        let peak = 0;
        data.forEach(ch => ch.forEach(s => { if (Math.abs(s) > peak) peak = Math.abs(s); }));
        if (peak > 0 && peak < 1) {
          const gain = 0.98 / peak;
          data = data.map(ch => ch.map(s => Math.max(-1, Math.min(1, s * gain))));
        }
      }

      // ② 静音裁剪（首尾）
      if (enhTrimSilence) {
        const linThreshold = Math.pow(10, enhSilenceThreshold / 20);
        const allSamples = data[0];
        let start = 0;
        while (start < allSamples.length && Math.abs(allSamples[start]) < linThreshold) start++;
        let end = allSamples.length - 1;
        while (end > start && Math.abs(allSamples[end]) < linThreshold) end--;
        if (start < end) {
          data = data.map(ch => ch.slice(start, end + 1));
        }
      }

      const totalFrames = data[0].length;
      const outBuf = ctx.createBuffer(numCh, totalFrames, sr);
      data.forEach((ch, i) => outBuf.getChannelData(i).set(ch));
      await ctx.close();

      const wav  = encodeWav(outBuf);
      const blob = new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url  = URL.createObjectURL(blob);
      setEnhResultUrl(url);
      setEnhResultName(enhFile.name.replace(/\.[^.]+$/, '') + '_enhanced.wav');
      toast.success('音频处理完成');
    } catch (e) {
      toast.error(`处理失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setEnhProcessing(false);
    }
  }

  function enhDownload() {
    if (!enhResultUrl) return;
    const a = document.createElement('a'); a.href = enhResultUrl;
    a.download = enhResultName; a.click();
  }

  const ttsModels = models.filter(m =>
    m.enabled && (m.capabilities.includes('tts') || m.capabilities.includes('audio_generation'))
  );

  /** TTS 模型空状态引导组件 */
  function NoTtsGuide({ compact = false }: { compact?: boolean }) {
    if (compact) {
      return (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 space-y-2">
          <p className="text-xs text-muted-foreground">
            尚未添加 TTS 模型。请先前往「模型配置」添加 TTS 服务，再回到此页面。
          </p>
          <Button size="sm" variant="secondary" className="h-7 text-xs"
            onClick={() => navigate('/model-config')}>
            前往模型配置
          </Button>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Cpu className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">还没有可用的 TTS 模型</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              需要先在「模型配置」中添加一个 TTS 服务配置，并添加或启用具备 <code className="bg-muted px-1 rounded">tts</code> 能力的模型，才能在此生成语音。
            </p>
          </div>
        </div>
        <div className="space-y-2 pl-12">
          {[
            '前往「模型配置」→ 点击「添加配置」',
            '接口类型选择「自定义 TTS 接口」，展开「通用 TTS 接口配置」填写 Base URL、API Key 和供应商预设',
            '保存配置后点击「同步模型」，或手动添加模型并勾选 tts 能力标签',
            '回到此页面，即可在模型下拉框看到可用 TTS 模型',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-xs text-muted-foreground leading-relaxed">{step}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pl-12">
          <Button size="sm" onClick={() => navigate('/model-config')}>
            前往模型配置
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/model-config', { state: { openAdd: true, apiType: 'audio_api' } })}>
            添加 TTS 服务
          </Button>
        </div>
      </div>
    );
  }

  // 当前选中模型
  const selectedModel = ttsModels.find(m => m.id === selectedModelId);
  // 是否必须填 voice
  const requiresVoice = selectedModel?.requires_voice ?? false;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgs, mods, vps, recs] = await Promise.all([
        getApiConfigs(),
        getModelCatalog(),
        getVoiceProfiles(),
        getAudioGenerationRecords(undefined, 30),
      ]);
      setApiConfigs(cfgs);
      setModels(mods);
      setVoiceProfiles(vps);
      setRecords(recs);
      const ttsMods = mods.filter(m => m.enabled && (m.capabilities.includes('tts') || m.capabilities.includes('audio_generation')));
      if (ttsMods.length > 0 && !selectedModelId) setSelectedModelId(ttsMods[0].id);
      const defVp = vps.find(v => v.is_default);
      if (defVp && !selectedVoiceProfileId) {
        setSelectedVoiceProfileId(defVp.id);
        setVoiceMode('library');
      }    } catch {
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── 生成校验逻辑 ────────────────────────────────────────────────────────────
  const hasApiConfig  = ttsModels.length > 0 && !!selectedModel?.api_config_id;
  // voice 只在 requiresVoice=true 时强制要求
  const effectiveVoiceId = voiceMode === 'library'
    ? (voiceProfiles.find(v => v.id === selectedVoiceProfileId)?.voice_id || '').trim()
    : voiceMode === 'manual' ? manualVoiceId.trim()
    : '';

  const disableReason = !text.trim()          ? '请输入文本内容'
    : !selectedModelId                         ? '请选择 TTS 模型'
    : !hasApiConfig                            ? '请先配置音频生成 API'
    : (requiresVoice && !effectiveVoiceId)     ? `请选择声音或填写 ${selectedModel?.voice_field_label || 'Voice ID'}`
    : '';
  const canGenerate = !disableReason && !generating;

  async function handleGenerate() {
    if (disableReason) { toast.error(disableReason); return; }
    setGenerating(true);
    setLastResult(null);
    try {
      const result = await generateTts({
        model_catalog_id: selectedModelId,
        voice_profile_id: voiceMode === 'library' ? selectedVoiceProfileId || undefined : undefined,
        voice_id: effectiveVoiceId || undefined,
        text: text.trim(),
        params: { ...params, ...(selectedModel?.default_params || {}) } as unknown as Record<string, unknown>,
        save_to_assets: true,
      });
      if (result.asset?.file_url) {
        setLastResult({ url: result.asset.file_url, text: text.trim() });
        toast.success('语音生成成功，已保存到素材库');
      }
      const recs = await getAudioGenerationRecords(undefined, 30);
      setRecords(recs);
    } catch (e) {
      const raw = e instanceof Error ? e.message : '未知错误';
      let displayMsg = raw;
      try {
        const parsed = JSON.parse(raw) as { error_type?: string; error?: string };
        if (parsed.error) displayMsg = parsed.error;
      } catch { /* use raw */ }
      toast.error(displayMsg, { duration: 8000 });
    } finally {
      setGenerating(false);
    }
  }

  async function handleNetTest() {
    setNetTesting(true);
    setNetResult(null);
    const configId = selectedModel?.api_config_id;
    try {
      const result = await testAudioProvider('tts', configId || undefined);
      setNetResult(result);
    } catch (e) {
      setNetResult({ ok: false, provider: 'tts', network: 'error', message: e instanceof Error ? e.message : '测试失败' });
    } finally {
      setNetTesting(false);
    }
  }

  function handleDownload(url: string, filename = 'audio.mp3') {
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
  }

  function copyToClipboard(text: string, label = '已复制') {
    navigator.clipboard.writeText(text).then(() => toast.success(label));
  }

  async function handleDeleteVp(id: string) {
    try {
      await deleteVoiceProfile(id);
      toast.success('已删除');
      setVoiceProfiles(prev => prev.filter(v => v.id !== id));
      if (selectedVoiceProfileId === id) setSelectedVoiceProfileId('');
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleteVpId(null);
    }
  }

  const charCount = text.length;
  const charLimit = 5000;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
      completed:  { label: '完成',  cls: 'bg-green-500/20 text-green-400 border-green-500/30',   icon: <CheckCircle className="w-3 h-3" /> },
      processing: { label: '处理中',cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30',     icon: <Loader2 className="w-3 h-3 animate-spin" /> },
      pending:    { label: '等待',  cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',icon: <Clock className="w-3 h-3" /> },
      failed:     { label: '失败',  cls: 'bg-red-500/20 text-red-400 border-red-500/30',         icon: <XCircle className="w-3 h-3" /> },
    };
    const s = map[status] || map.pending;
    return (
      <Badge variant="outline" className={`text-xs flex items-center gap-1 ${s.cls}`}>
        {s.icon}{s.label}
      </Badge>
    );
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-full min-h-0">
        {/* 页头 */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Music className="w-5 h-5 text-primary" />
                音频制作
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">文本转语音 · 声音库管理 · 生成历史</p>
            </div>
            <Button variant="secondary" size="sm" onClick={loadData} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 主内容 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); if (v === 'storyboard') loadSbStoryboards(); }} className="space-y-6">
            {/* 可横向滚动 Tab 栏 */}
            <div className="overflow-x-auto whitespace-nowrap pb-1 -mb-1">
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="tts"><Mic className="w-4 h-4 mr-1.5" />文本转语音</TabsTrigger>
                <TabsTrigger value="storyboard"><Film className="w-4 h-4 mr-1.5" />分镜配音</TabsTrigger>
                <TabsTrigger value="multi_speaker"><Users className="w-4 h-4 mr-1.5" />多角色对话</TabsTrigger>
                <TabsTrigger value="voices">
                  <Volume2 className="w-4 h-4 mr-1.5" />声音库
                  {voiceProfiles.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">{voiceProfiles.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="voice_clone"><Sparkles className="w-4 h-4 mr-1.5" />声音克隆</TabsTrigger>
                <TabsTrigger value="asr"><MessageSquare className="w-4 h-4 mr-1.5" />音频转文字</TabsTrigger>
                <TabsTrigger value="subtitle"><Subtitles className="w-4 h-4 mr-1.5" />字幕生成</TabsTrigger>
                <TabsTrigger value="voice_design"><Wand2 className="w-4 h-4 mr-1.5" />声音设计</TabsTrigger>
                <TabsTrigger value="voice_conversion"><ArrowLeftRight className="w-4 h-4 mr-1.5" />声音转换</TabsTrigger>
                <TabsTrigger value="enhancement"><SlidersHorizontal className="w-4 h-4 mr-1.5" />音频增强</TabsTrigger>
                <TabsTrigger value="history"><Clock className="w-4 h-4 mr-1.5" />生成历史</TabsTrigger>
              </TabsList>
            </div>

            {/* ── TTS 标签页 ── */}
            <TabsContent value="tts">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左：输入区 */}
                <div className="space-y-4">
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">输入文本</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="relative">
                        <Textarea
                          className="resize-none min-h-[160px] text-sm"
                          placeholder="在此输入要转换为语音的文本内容…"
                          value={text}
                          onChange={e => setText(e.target.value.slice(0, charLimit))}
                        />
                        <span className={`absolute bottom-2 right-3 text-xs ${charCount > charLimit * 0.9 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {charCount}/{charLimit}
                        </span>
                      </div>

                      {/* 模型选择 */}
                      <div>
                        <Label className="text-xs">TTS 模型</Label>
                        {loading ? (
                          <Skeleton className="mt-1 h-9 w-full" />
                        ) : ttsModels.length === 0 ? (
                          <div className="mt-1"><NoTtsGuide compact /></div>
                        ) : (
                          <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="选择 TTS 模型" /></SelectTrigger>
                            <SelectContent>
                              {ttsModels.map(m => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.display_name || m.model_id}
                                  {m.api_config && <span className="text-muted-foreground ml-1">({m.api_config.name})</span>}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {/* 声音选择 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">
                            声音 / Voice ID
                            {!requiresVoice && <span className="text-muted-foreground ml-1">（可选）</span>}
                            {requiresVoice && <span className="text-destructive ml-1">*</span>}
                          </Label>
                          <div className="flex gap-1">
                            <button
                              className={`text-xs px-2 py-0.5 rounded-md transition-colors ${voiceMode === 'library' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                              onClick={() => setVoiceMode('library')}
                            >声音库</button>
                            <button
                              className={`text-xs px-2 py-0.5 rounded-md transition-colors ${voiceMode === 'manual' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                              onClick={() => setVoiceMode('manual')}
                            >手动输入</button>
                            {!requiresVoice && (
                              <button
                                className={`text-xs px-2 py-0.5 rounded-md transition-colors ${voiceMode === 'none' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                                onClick={() => setVoiceMode('none')}
                              >不指定</button>
                            )}
                          </div>
                        </div>

                        {voiceMode === 'none' ? (
                          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                            不指定声音，将使用模型默认声音（适用于不需要 Voice ID 的 TTS 服务）
                          </p>
                        ) : voiceMode === 'library' ? (
                          voiceProfiles.length === 0 ? (
                            <div className="bg-muted/60 rounded-lg p-4 space-y-3">
                              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                                声音库为空，请先添加声音
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="secondary" onClick={() => { setActiveTab('voices'); setSyncDialogOpen(true); }}>
                                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />同步声音
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => { setEditingVp(undefined); setVpDialogOpen(true); }}>
                                  <Plus className="w-3.5 h-3.5 mr-1.5" />手动添加
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setVoiceMode('manual')}>
                                  直接输入 Voice ID
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Select value={selectedVoiceProfileId || 'none'} onValueChange={v => setSelectedVoiceProfileId(v === 'none' ? '' : v)}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="从声音库选择…" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{requiresVoice ? '请选择声音…' : '不指定（使用默认）'}</SelectItem>
                                {voiceProfiles.map(vp => (
                                  <SelectItem key={vp.id} value={vp.id}>
                                    <span className="flex items-center gap-1.5">
                                      {vp.is_default && <Star className="w-3 h-3 text-primary shrink-0" />}
                                      {vp.name}
                                      <span className="text-muted-foreground font-mono text-xs ml-1">{vp.voice_id.slice(0, 8)}…</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )
                        ) : (
                          <div className="space-y-1">
                            <Input
                              className="text-xs h-9 px-3 font-mono"
                              value={manualVoiceId}
                              onChange={e => setManualVoiceId(e.target.value)}
                              placeholder={selectedModel?.voice_field_placeholder || '输入 Voice ID'}
                            />
                            {requiresVoice && !manualVoiceId.trim() && (
                              <p className="text-xs text-destructive flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                {selectedModel?.voice_field_label || 'Voice ID'} 不能为空
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 生成按钮 + 禁用原因提示 */}
                      <div className="space-y-1.5">
                        <Button
                          className="w-full"
                          onClick={handleGenerate}
                          disabled={!canGenerate}
                        >
                          {generating
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />生成中（最长 120s）…</>
                            : <><Mic className="w-4 h-4 mr-2" />生成语音</>
                          }
                        </Button>
                        {disableReason && !generating && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
                            <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
                            {disableReason}
                          </p>
                        )}
                      </div>

                      {/* 结果播放 */}
                      {lastResult && (
                        <div className="bg-muted/60 rounded-lg p-3 space-y-2">
                          <p className="text-xs text-muted-foreground font-medium">最新生成结果</p>
                          <AudioPlayer url={lastResult.url} />
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="secondary" className="flex-1" onClick={() => handleDownload(lastResult.url)}>
                              <Download className="w-3.5 h-3.5 mr-1.5" />下载
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* 后端连通性测试卡片 */}
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Wifi className="w-4 h-4 text-muted-foreground" />
                        API 连通性检测
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        测试后端能否访问当前 TTS 服务，验证 API Key 有效性及接口连通。
                      </p>
                      <Button variant="secondary" size="sm" onClick={handleNetTest} disabled={netTesting || !selectedModelId}>
                        {netTesting
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />测试中…</>
                          : <><Wifi className="w-3.5 h-3.5 mr-1.5" />{selectedModelId ? '测试连通 + 验证 Key' : '请先选择 TTS 模型'}</>
                        }
                      </Button>
                      {netResult && (
                        <div className={`rounded-md px-3 py-2 text-xs space-y-1.5 ${
                          netResult.ok ? 'bg-green-500/10 border border-green-500/30'
                            : netResult.error_type === 'connect_timeout' || netResult.network === 'timeout' ? 'bg-red-500/10 border border-red-500/30'
                            : 'bg-yellow-500/10 border border-yellow-500/30'
                        }`}>
                          <div className="flex items-center gap-2 font-medium">
                            {netResult.ok ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                              : netResult.error_type === 'connect_timeout' || netResult.network === 'timeout' ? <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
                              : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
                            <span>
                              {netResult.ok ? '连通正常'
                                : netResult.error_type === 'connect_timeout' ? '服务端网络限制（连接超时）'
                                : netResult.error_type === 'upstream_401' ? 'API Key 无效'
                                : netResult.network === 'timeout' ? '连接超时'
                                : '连接异常'}
                            </span>
                            {netResult.latency_ms !== undefined && (
                              <span className="text-muted-foreground ml-auto font-mono">{netResult.latency_ms}ms</span>
                            )}
                          </div>
                          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{netResult.message}</p>
                          {netResult.test_url && (
                            <p className="text-muted-foreground font-mono text-[10px] break-all">测试地址：{netResult.test_url}</p>
                          )}
                          {(netResult.error_type === 'connect_timeout' || netResult.network === 'timeout') && (
                            <div className="pt-1 border-t border-red-500/20 space-y-1">
                              <p className="font-medium text-red-300">连接超时，可能原因：</p>
                              <p className="text-muted-foreground">① 服务端出口网络限制，无法访问该 TTS 服务</p>
                              <p className="text-muted-foreground">② 检查 Base URL 是否正确</p>
                              <p className="text-muted-foreground">③ 联系管理员确认服务端出口策略</p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>{/* end left column */}

                {/* 右：动态参数面板 */}
                <div className="space-y-4">
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                        语音参数
                        {selectedModel && (
                          <span className="text-xs font-normal text-muted-foreground ml-auto">
                            {selectedModel.display_name || selectedModel.model_id}
                          </span>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* 若模型有 tts_param_schema，动态渲染 */}
                      {selectedModel?.tts_param_schema && Object.keys(selectedModel.tts_param_schema).length > 0 ? (
                        <>
                          {Object.entries(selectedModel.tts_param_schema as Record<string, TtsParamDef>).map(([key, def]) => {
                            const val = params[key] ?? def.default ?? '';
                            if (def.type === 'select') return (
                              <div key={key}>
                                <Label className="text-xs">{def.label || key}</Label>
                                <Select value={String(val)} onValueChange={v => setParams(p => ({ ...p, [key]: v }))}>
                                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {(def.options || []).map(opt => (
                                      <SelectItem key={String(opt)} value={String(opt)}>{String(opt)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            );
                            if (def.type === 'number') {
                              const numVal = typeof val === 'number' ? val : Number(val);
                              return (
                                <div key={key} className="space-y-2">
                                  <div className="flex justify-between items-center">
                                    <Label className="text-xs">{def.label || key}</Label>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {Number.isInteger(def.step ?? 1) || (def.step ?? 0.1) >= 1 ? numVal : numVal.toFixed(2)}
                                    </span>
                                  </div>
                                  <Slider
                                    min={def.min ?? 0} max={def.max ?? 10} step={def.step ?? 0.1}
                                    value={[numVal]}
                                    onValueChange={([v]) => setParams(p => ({ ...p, [key]: v }))}
                                  />
                                </div>
                              );
                            }
                            // boolean
                            return (
                              <div key={key} className="flex items-center justify-between">
                                <Label className="text-xs">{def.label || key}</Label>
                                <Switch checked={!!val} onCheckedChange={v => setParams(p => ({ ...p, [key]: v }))} />
                              </div>
                            );
                          })}
                          <Button variant="secondary" size="sm" className="w-full" onClick={() => {
                            const schemaDefaults: Record<string, unknown> = {};
                            Object.entries(selectedModel.tts_param_schema as Record<string, TtsParamDef>).forEach(([k, d]) => {
                              if (d.default !== undefined) schemaDefaults[k] = d.default;
                            });
                            setParams({ ...DEFAULT_PARAMS, ...schemaDefaults });
                          }}>
                            重置为默认参数
                          </Button>
                        </>
                      ) : (
                        /* 无 schema → 显示通用基础参数 */
                        <>
                          <div>
                            <Label className="text-xs">输出格式</Label>
                            <Select value={params.format as string} onValueChange={v => setParams(p => ({ ...p, format: v }))}>
                              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mp3">MP3</SelectItem>
                                <SelectItem value="wav">WAV</SelectItem>
                                <SelectItem value="opus">Opus</SelectItem>
                                <SelectItem value="pcm">PCM</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <Label className="text-xs">语速</Label>
                              <span className="text-xs text-muted-foreground font-mono">{(params.speed as number).toFixed(1)}x</span>
                            </div>
                            <Slider min={0.5} max={2} step={0.1} value={[params.speed as number]}
                              onValueChange={([v]) => setParams(p => ({ ...p, speed: v }))} />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>0.5x</span><span>1.0x</span><span>2.0x</span>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <Label className="text-xs">采样率</Label>
                            </div>
                            <Select value={String(params.sample_rate)} onValueChange={v => setParams(p => ({ ...p, sample_rate: Number(v) }))}>
                              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="22050">22050 Hz</SelectItem>
                                <SelectItem value="44100">44100 Hz</SelectItem>
                                <SelectItem value="48000">48000 Hz</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <Label className="text-xs">温度</Label>
                              <span className="text-xs text-muted-foreground font-mono">{(params.temperature as number).toFixed(2)}</span>
                            </div>
                            <Slider min={0} max={1} step={0.05} value={[params.temperature as number]}
                              onValueChange={([v]) => setParams(p => ({ ...p, temperature: v }))} />
                          </div>
                          <Button variant="secondary" size="sm" className="w-full" onClick={() => setParams(DEFAULT_PARAMS)}>
                            重置为默认参数
                          </Button>
                        </>
                      )}

                      {/* 无模型提示 */}
                      {!selectedModel && (
                        <p className="text-xs text-muted-foreground text-center py-4">选择 TTS 模型后显示参数</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* ── 分镜配音标签页 ── */}
            <TabsContent value="storyboard">
              <div className="space-y-4">
                {/* 配置栏 */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Film className="w-4 h-4 text-primary" />分镜配音设置
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">语音模型（需先配置 API Key）</Label>
                        {ttsModels.length === 0 ? (
                          <div className="mt-1.5"><NoTtsGuide compact /></div>
                        ) : (
                          <Select value={sbApiConfigId} onValueChange={setSbApiConfigId}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="选择语音模型" /></SelectTrigger>
                            <SelectContent>
                              {ttsModels.map(m => (
                                <SelectItem key={m.id} value={m.api_config_id}>{m.display_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">声音配置（可选）</Label>
                        <Select value={sbVoiceProfile} onValueChange={setSbVoiceProfile}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="使用模型默认声音" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">使用模型默认声音</SelectItem>
                            {voiceProfiles.map(vp => (
                              <SelectItem key={vp.id} value={vp.id}>{vp.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">配音范围</Label>
                        <Select value={sbScope} onValueChange={v => setSbScope(v as typeof sbScope)}>
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部（旁白 + 对白）</SelectItem>
                            <SelectItem value="voiceover">只生成旁白</SelectItem>
                            <SelectItem value="dialogue">只生成对白</SelectItem>
                            <SelectItem value="unvoiced">只生成未配音分镜</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-4">
                      <Button size="sm" variant="secondary" onClick={loadSbStoryboards} disabled={sbLoading}>
                        <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${sbLoading ? 'animate-spin' : ''}`} />
                        刷新分镜
                      </Button>
                      <Button size="sm" onClick={handleSbBatch} disabled={sbBatchRunning || sbLoading || !selectedProjectId}>
                        {sbBatchRunning
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />批量配音中…</>
                          : <><Zap className="w-3.5 h-3.5 mr-1.5" />批量生成音频</>}
                      </Button>
                      {!selectedProjectId && (
                        <p className="text-xs text-muted-foreground">请先在顶部选择项目</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* 分镜列表 */}
                {sbLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : getSbRows().length === 0 ? (
                  <Card className="bg-card border-border border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <Film className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
                      <p className="text-sm text-muted-foreground">
                        {!selectedProjectId
                          ? '请先选择项目，然后刷新分镜'
                          : sbStoryboards.length === 0
                            ? '该项目暂无分镜，请先生成分镜脚本'
                            : '当前范围内没有需要配音的分镜'}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {getSbRows().map(({ storyboard: s, type, text }) => {
                      const key = `${s.id}_${type}`;
                      const audioAsset = type === 'voiceover' ? s.voiceover_audio : s.dialogue_audio;
                      const hasAudio = !!audioAsset?.file_url;
                      const genState = sbGenStates[key];
                      const isGenerating = genState === 'generating';
                      const isPlaying = sbPlayingKey === key;
                      return (
                        <Card key={key} className="bg-card border-border">
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-primary text-xs font-bold">{s.shot_index}</span>
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="text-xs">
                                    {type === 'voiceover' ? '旁白' : '对白'}
                                  </Badge>
                                  {sbStatusBadge(key, hasAudio)}
                                </div>
                                <p className="text-sm text-foreground line-clamp-2">{text}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {hasAudio && (
                                  <Button
                                    variant="secondary" size="sm" className="h-7 px-2 text-xs"
                                    onClick={() => handleSbPlay(key, audioAsset!.file_url!)}
                                  >
                                    {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                  </Button>
                                )}
                                {hasAudio && (
                                  <Button
                                    variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                    title="解绑音频"
                                    onClick={async () => {
                                      await bindStoryboardAudio(s.id, null, type);
                                      await loadSbStoryboards();
                                      toast.success('已解绑');
                                    }}
                                  >
                                    <Unlink className="w-3 h-3" />
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant={hasAudio ? 'secondary' : 'default'}
                                  className="h-7 px-2 text-xs"
                                  disabled={isGenerating}
                                  onClick={() => handleSbGenOne(s.id, type, text).then(loadSbStoryboards).catch(() => {})}
                                >
                                  {isGenerating
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : hasAudio ? <RefreshCw className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── 声音库标签页 ── */}
            <TabsContent value="voices">
              <div className="space-y-4">
                {/* 操作栏 */}
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <p className="text-sm text-muted-foreground flex-1">
                    {voiceProfiles.length > 0
                      ? `共 ${voiceProfiles.length} 个声音配置`
                      : '管理常用声音，生成时可快速选择'
                    }
                  </p>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => setSyncDialogOpen(true)}>
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />同步声音
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setCreateVoiceOpen(true)}>
                      <Upload className="w-3.5 h-3.5 mr-1.5" />上传参考音频创建
                    </Button>
                    <Button size="sm" onClick={() => { setEditingVp(undefined); setVpDialogOpen(true); }}>
                      <Plus className="w-3.5 h-3.5 mr-1.5" />手动添加声音
                    </Button>
                  </div>
                </div>

                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
                  </div>
                ) : voiceProfiles.length === 0 ? (
                  /* 空状态引导 */
                  <Card className="bg-card border-border border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-14 text-center space-y-4">
                      <Volume2 className="w-12 h-12 text-muted-foreground" />
                      <div>
                        <p className="text-base font-medium text-foreground">声音库还是空的</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                          声音库还没有声音。你可以同步声音、手动添加 Voice ID，或上传参考音频创建声音模型。
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2 pt-1">
                        <Button variant="secondary" size="sm" onClick={() => setSyncDialogOpen(true)}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />同步声音
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => { setEditingVp(undefined); setVpDialogOpen(true); }}>
                          <Plus className="w-3.5 h-3.5 mr-1.5" />手动添加 Voice ID
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setCreateVoiceOpen(true)}>
                          <Upload className="w-3.5 h-3.5 mr-1.5" />创建声音模型
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {voiceProfiles.map(vp => (
                      <Card key={vp.id} className={`bg-card border-border ${vp.is_default ? 'ring-1 ring-primary' : ''}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="flex-1 min-w-0 space-y-1.5">
                              {/* 名称行 */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-sm text-foreground">{vp.name}</span>
                                {vp.is_default && (
                                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30 shrink-0">默认</Badge>
                                )}
                                <SourceBadge source={vp.source} />
                              </div>
                              {/* reference_id */}
                              <div className="flex items-center gap-1.5 min-w-0">
                                <p className="text-xs text-muted-foreground font-mono truncate flex-1 min-w-0">{vp.voice_id}</p>
                                <button
                                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                  onClick={() => copyToClipboard(vp.voice_id, '已复制 Voice ID')}
                                  title="复制 Voice ID"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              {/* 标签行 */}
                              <div className="flex flex-wrap gap-1">
                                {vp.gender && <Badge variant="secondary" className="text-xs">{vp.gender === 'male' ? '男' : vp.gender === 'female' ? '女' : '中性'}</Badge>}
                                {vp.language && <Badge variant="secondary" className="text-xs">{vp.language}</Badge>}
                                {(vp.style_tags || []).map(t => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                              </div>
                              {vp.description && <p className="text-xs text-muted-foreground line-clamp-1">{vp.description}</p>}
                            </div>
                            {/* 操作按钮 */}
                            <div className="flex flex-col items-center gap-1 shrink-0">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="设为默认"
                                onClick={() => updateVoiceProfile(vp.id, { is_default: !vp.is_default }).then(loadData)}>
                                {vp.is_default
                                  ? <Star className="w-3.5 h-3.5 text-primary" />
                                  : <StarOff className="w-3.5 h-3.5" />}
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="用于 TTS"
                                onClick={() => {
                                  setSelectedVoiceProfileId(vp.id);
                                  setVoiceMode('library');
                                  setActiveTab('tts');
                                  toast.success(`已选择「${vp.name}」，切换到文本转语音`);
                                }}>
                                <Zap className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑"
                                onClick={() => { setEditingVp(vp); setVpDialogOpen(true); }}>
                                <User className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="删除"
                                onClick={() => setDeleteVpId(vp.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── 历史记录标签页 ── */}
            <TabsContent value="history">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">最近 30 条生成记录</p>
                  <Button variant="secondary" size="sm" onClick={async () => {
                    const recs = await getAudioGenerationRecords(undefined, 30);
                    setRecords(recs);
                  }}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />刷新
                  </Button>
                </div>

                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                  </div>
                ) : records.length === 0 ? (
                  <Card className="bg-card border-border border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <Clock className="w-10 h-10 text-muted-foreground mb-3" />
                      <p className="text-sm text-muted-foreground">暂无生成记录</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {records.map(rec => (
                      <Card key={rec.id} className="bg-card border-border">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {statusBadge(rec.status)}
                                <span className="text-xs text-muted-foreground">
                                  {new Date(rec.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {rec.voice_profile && (
                                  <Badge variant="secondary" className="text-xs">{rec.voice_profile.name}</Badge>
                                )}
                              </div>
                              {rec.input_text && (
                                <p className="text-sm text-foreground line-clamp-2">{rec.input_text}</p>
                              )}
                              {rec.result_asset?.file_url && (
                                <div className="flex items-center gap-2 pt-1">
                                  <div className="flex-1 min-w-0">
                                    <AudioPlayer url={rec.result_asset.file_url} small />
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                                    onClick={() => handleDownload(rec.result_asset!.file_url!, `tts_${rec.id.slice(-6)}.mp3`)}>
                                    <Download className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                              {rec.error_message && (
                                <p className="text-xs text-destructive">{rec.error_message}</p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── 多角色对话 ── */}
            <TabsContent value="multi_speaker">
              <div className="space-y-4">
                {/* 配置栏 */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />多角色对话配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">语音模型（需先配置 API Key）</Label>
                        {ttsModels.length === 0 ? (
                          <div className="mt-1.5"><NoTtsGuide compact /></div>
                        ) : (
                          <Select value={msModelId} onValueChange={setMsModelId}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="选择语音模型" /></SelectTrigger>
                            <SelectContent>
                              {ttsModels.map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="flex items-end flex-wrap gap-2">
                        <Button size="sm" onClick={handleMsGenerate} disabled={msRunning || ttsModels.length === 0}>
                          {msRunning
                            ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />逐条生成中…</>
                            : <><Zap className="w-3.5 h-3.5 mr-1.5" />逐条生成音频</>}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setMsLines(prev => [...prev, newLine()])}>
                          <Plus className="w-3.5 h-3.5 mr-1.5" />添加行
                        </Button>
                        <Button size="sm" variant="secondary"
                          disabled={msMerging || msLines.filter(l => l.status === 'done' && l.audio_url).length === 0}
                          onClick={handleMsMerge}>
                          {msMerging
                            ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />合并中…</>
                            : <><Download className="w-3.5 h-3.5 mr-1.5" />合并下载 WAV</>}
                        </Button>
                      </div>
                    </div>

                    {/* 角色声音映射 */}
                    {(() => {
                      const chars = Array.from(new Set(msLines.map(l => l.character.trim()).filter(Boolean)));
                      if (chars.length === 0 || voiceProfiles.length === 0) return null;
                      return (
                        <div className="mt-4 pt-4 border-t border-border">
                          <p className="text-xs text-muted-foreground mb-2 font-medium">角色声音映射（按角色批量指定声音）</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {chars.map(char => (
                              <div key={char} className="flex items-center gap-2 min-w-0">
                                <span className="text-xs text-foreground shrink-0 w-16 truncate" title={char}>{char}</span>
                                <Select
                                  value={msCharMap[char] || 'default'}
                                  onValueChange={v => msSetCharVoice(char, v === 'default' ? '' : v)}
                                >
                                  <SelectTrigger className="h-7 text-xs flex-1 min-w-0"><SelectValue placeholder="默认声音" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="default">默认声音</SelectItem>
                                    {voiceProfiles.map(vp => (
                                      <SelectItem key={vp.id} value={vp.id}>{vp.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* 对话行列表 */}
                <div className="space-y-2">
                  {msLines.map((line, idx) => (
                    <Card key={line.id} className="bg-card border-border">
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <div className="w-6 h-6 rounded bg-muted flex items-center justify-center shrink-0 mt-1 text-xs text-muted-foreground">
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-5 gap-2">
                            {/* 角色名 */}
                            <Input
                              className="h-8 text-xs px-2"
                              placeholder="角色名"
                              value={line.character}
                              onChange={e => msUpdateLine(line.id, { character: e.target.value })}
                            />
                            {/* 台词 */}
                            <div className="md:col-span-2">
                              <Input
                                className="h-8 text-xs px-2"
                                placeholder="台词内容"
                                value={line.text}
                                onChange={e => msUpdateLine(line.id, { text: e.target.value })}
                              />
                            </div>
                            {/* 声音 */}
                            <Select value={line.voice_profile_id || 'default'} onValueChange={v => msUpdateLine(line.id, { voice_profile_id: v === 'default' ? '' : v })}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="声音（可选）" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">默认声音</SelectItem>
                                {voiceProfiles.map(vp => (
                                  <SelectItem key={vp.id} value={vp.id}>{vp.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {/* 停顿 ms */}
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                className="h-8 text-xs px-2 w-full"
                                placeholder="停顿 ms"
                                min={0} max={5000} step={100}
                                value={line.pause_ms ?? 0}
                                onChange={e => msUpdateLine(line.id, { pause_ms: Math.max(0, Number(e.target.value)) })}
                                title="段后停顿时长（毫秒），合并时插入静音"
                              />
                              <span className="text-xs text-muted-foreground shrink-0">ms</span>
                            </div>
                          </div>
                          {/* 状态 + 操作 */}
                          <div className="flex items-center gap-1 shrink-0 mt-0.5">
                            {line.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
                            {line.status === 'done' && line.audio_url && (
                              <Button variant="secondary" size="sm" className="h-7 w-7 p-0"
                                onClick={() => handleMsPlay(line.id, line.audio_url!)}>
                                {msPlayingId === line.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              </Button>
                            )}
                            {line.status === 'error' && (
                              <span title={line.error}>
                                <XCircle className="w-4 h-4 text-destructive" />
                              </span>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                              onClick={() => msInsertLineAfter(line.id)} title="在此后插入行">
                              <Plus className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => msRemoveLine(line.id)} disabled={msLines.length <= 1}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        {line.status === 'error' && line.error && (
                          <p className="text-xs text-destructive mt-1.5 pl-8">{line.error}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* 合并提示 */}
                {msLines.filter(l => l.status === 'done' && l.audio_url).length > 0 && (
                  <div className="flex items-center gap-3 px-1">
                    <p className="text-xs text-muted-foreground flex-1">
                      已生成 {msLines.filter(l => l.status === 'done' && l.audio_url).length} / {msLines.length} 条，
                      点击「合并下载 WAV」将所有已生成段落按顺序拼接（含停顿）导出为一条完整音频。
                    </p>
                    <Button size="sm" variant="secondary" disabled={msMerging} onClick={handleMsMerge}>
                      {msMerging
                        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />合并中…</>
                        : <><Download className="w-3.5 h-3.5 mr-1.5" />合并下载 WAV</>}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── 声音克隆（P1）── */}
            <TabsContent value="voice_clone">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />上传参考音频克隆声音
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* API 配置 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">API 配置（Fish Audio）</Label>
                      {apiConfigs.filter(c => c.enabled).length === 0 ? (
                        <p className="text-xs text-muted-foreground mt-1.5 border border-border rounded-md px-3 py-2">
                          请先在「模型配置」中添加 Fish Audio API 配置
                        </p>
                      ) : (
                        <Select value={vcApiConfigId || 'none'} onValueChange={v => setVcApiConfigId(v === 'none' ? '' : v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="选择 API 配置" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">请选择</SelectItem>
                            {apiConfigs.filter(c => c.enabled).map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {/* 声音名称 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">声音名称 *</Label>
                      <Input className="mt-1" placeholder="给这个声音起个名字" value={vcName} onChange={e => setVcName(e.target.value)} />
                    </div>
                    {/* 参考音频 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">参考音频 *（mp3 / wav / m4a / flac，建议 10-30 秒清晰人声）</Label>
                      <div
                        className="mt-1 border border-dashed border-border rounded-md px-4 py-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => vcFileRef.current?.click()}
                      >
                        {vcAudioFile
                          ? <p className="text-sm text-foreground font-medium">{vcAudioFile.name}</p>
                          : <p className="text-sm text-muted-foreground"><Upload className="w-4 h-4 inline mr-1.5" />点击选择音频文件</p>
                        }
                      </div>
                      <input ref={vcFileRef} type="file" accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/flac"
                        className="hidden" onChange={e => setVcAudioFile(e.target.files?.[0] || null)} />
                    </div>
                    {/* 参考文本 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">参考文本（可选，提升克隆效果）</Label>
                      <Textarea className="mt-1 resize-none min-h-[72px] text-sm"
                        placeholder="输入参考音频对应的文字内容"
                        value={vcRefText} onChange={e => setVcRefText(e.target.value)} />
                    </div>
                    {/* 语言 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">语言（可选）</Label>
                      <Select value={vcLanguage || 'auto'} onValueChange={v => setVcLanguage(v === 'auto' ? '' : v)}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">自动检测</SelectItem>
                          <SelectItem value="zh">中文</SelectItem>
                          <SelectItem value="en">英文</SelectItem>
                          <SelectItem value="ja">日文</SelectItem>
                          <SelectItem value="ko">韩文</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full" onClick={handleVoiceClone} disabled={vcLoading}>
                      {vcLoading
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />克隆中…</>
                        : <><Sparkles className="w-4 h-4 mr-2" />创建声音模型</>}
                    </Button>
                  </CardContent>
                </Card>
                {/* 右侧说明 */}
                <div className="space-y-3">
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">使用说明</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      <p>当前支持通过 Fish Audio 进行声音克隆。克隆成功后，声音将自动保存到「声音库」，可用于文本转语音和分镜配音。</p>
                      <p className="font-medium text-foreground/80">参考音频建议：</p>
                      <ul className="space-y-1 list-disc list-inside">
                        <li>时长 10–30 秒，音质清晰</li>
                        <li>无背景噪音或音乐</li>
                        <li>语速适中，发音清楚</li>
                        <li>与目标用途语言一致</li>
                      </ul>
                      <p className="pt-1 text-muted-foreground/70">更多服务商（ElevenLabs、MiniMax）声音克隆能力将在后续版本中逐步支持。</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* ── 音频转文字（P1）── */}
            <TabsContent value="asr">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左：上传 + 配置 */}
                <div className="space-y-4">
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-primary" />语音识别配置
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">ASR 配置（需在「模型配置」中填写 ASR 路径）</Label>
                        {asrApiConfigs.length === 0 ? (
                          <p className="text-xs text-muted-foreground mt-1.5 border border-border rounded-md px-3 py-2">
                            暂无可用 ASR 配置，请在「模型配置」→ ASR 设置中填写接口路径（如 /v1/audio/transcriptions）
                          </p>
                        ) : (
                          <Select value={asrApiConfigId || 'none'} onValueChange={v => setAsrApiConfigId(v === 'none' ? '' : v)}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="选择 ASR 配置" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">请选择</SelectItem>
                              {asrApiConfigs.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">上传音频 *（mp3 / wav / m4a / flac，最大 25MB）</Label>
                        <div
                          className="mt-1 border border-dashed border-border rounded-md px-4 py-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
                          onClick={() => asrFileRef.current?.click()}
                        >
                          {asrAudioFile
                            ? <p className="text-sm text-foreground font-medium">{asrAudioFile.name}</p>
                            : <p className="text-sm text-muted-foreground"><Upload className="w-4 h-4 inline mr-1.5" />点击选择音频文件</p>
                          }
                        </div>
                        <input ref={asrFileRef} type="file"
                          accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/flac,audio/ogg"
                          className="hidden" onChange={e => setAsrAudioFile(e.target.files?.[0] || null)} />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">识别语言（可选）</Label>
                        <Select value={asrLanguage || 'auto'} onValueChange={v => setAsrLanguage(v === 'auto' ? '' : v)}>
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">自动检测</SelectItem>
                            <SelectItem value="zh">中文</SelectItem>
                            <SelectItem value="en">英文</SelectItem>
                            <SelectItem value="ja">日文</SelectItem>
                            <SelectItem value="ko">韩文</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button className="w-full" onClick={handleAsrTranscribe}
                        disabled={asrLoading || !asrAudioFile || asrApiConfigs.length === 0}>
                        {asrLoading
                          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />识别中…</>
                          : <><Zap className="w-4 h-4 mr-2" />开始识别</>}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
                {/* 右：识别结果 */}
                <div className="space-y-3">
                  {asrResult ? (
                    <Card className="bg-card border-border h-full flex flex-col">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm font-semibold">识别结果</CardTitle>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={asrExportTxt}>
                              <Download className="w-3 h-3 mr-1" />TXT
                            </Button>
                            {asrResult.segments.length > 0 && <>
                              <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={asrExportSrt}>
                                <Download className="w-3 h-3 mr-1" />SRT
                              </Button>
                              <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={asrExportVtt}>
                                <Download className="w-3 h-3 mr-1" />VTT
                              </Button>
                            </>}
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2"
                              onClick={() => { navigator.clipboard.writeText(asrResult.text); toast.success('已复制'); }}>
                              <Copy className="w-3 h-3 mr-1" />复制
                            </Button>
                          </div>
                        </div>
                        {asrResult.duration > 0 && (
                          <p className="text-xs text-muted-foreground">时长：{asrResult.duration.toFixed(1)}s · {asrResult.segments.length} 段</p>
                        )}
                      </CardHeader>
                      <CardContent className="flex-1 overflow-y-auto space-y-3">
                        {/* 全文 */}
                        <Textarea readOnly className="resize-none min-h-[120px] text-sm bg-muted/30" value={asrResult.text} />
                        {/* 分段时间轴 */}
                        {asrResult.segments.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">分段时间轴</p>
                            <div className="max-h-[280px] overflow-y-auto space-y-1">
                              {asrResult.segments.map((seg: AsrSegment, i: number) => (
                                <div key={i} className="flex gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
                                  <span className="text-muted-foreground shrink-0 tabular-nums">
                                    {seg.start.toFixed(1)}s
                                  </span>
                                  <span className="flex-1 min-w-0">{seg.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="bg-card border-border border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-2">
                        <MessageSquare className="w-8 h-8 text-muted-foreground opacity-40" />
                        <p className="text-sm text-muted-foreground">识别结果将在此显示</p>
                        <p className="text-xs text-muted-foreground/70">支持导出 TXT / SRT / VTT 格式</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── 字幕生成（P1）── */}
            <TabsContent value="subtitle">
              <div className="space-y-4">
                {/* 配置卡 */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />从分镜台词生成字幕
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div className="md:col-span-1">
                        <Label className="text-xs text-muted-foreground">导出范围</Label>
                        <Select value={subScope} onValueChange={v => setSubScope(v as typeof subScope)}>
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">旁白 + 对白</SelectItem>
                            <SelectItem value="voiceover">只导出旁白</SelectItem>
                            <SelectItem value="dialogue">只导出对白</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={loadSubStoryboards} disabled={subLoading || !selectedProjectId}>
                          {subLoading
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                          加载分镜
                        </Button>
                      </div>
                      {!selectedProjectId && (
                        <p className="text-xs text-muted-foreground md:col-span-3">请先在顶部选择项目</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* 预览 + 导出 */}
                {subStoryboards.length > 0 && (() => {
                  const lines = buildSubLines();
                  return (
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm">预览 · {lines.length} 条台词</CardTitle>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {(['txt', 'srt', 'vtt', 'csv'] as const).map(fmt => (
                              <Button key={fmt} size="sm" variant="secondary" className="h-7 text-xs px-2"
                                onClick={() => subExport(fmt)} disabled={lines.length === 0}>
                                <Download className="w-3 h-3 mr-1" />{fmt.toUpperCase()}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {lines.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-8">当前分镜没有匹配的台词内容</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="text-left py-2 pr-3 whitespace-nowrap text-muted-foreground font-medium w-10">序号</th>
                                  <th className="text-left py-2 pr-3 whitespace-nowrap text-muted-foreground font-medium w-12">分镜</th>
                                  <th className="text-left py-2 pr-3 whitespace-nowrap text-muted-foreground font-medium w-16">类型</th>
                                  <th className="text-left py-2 pr-3 whitespace-nowrap text-muted-foreground font-medium w-20">角色</th>
                                  <th className="text-left py-2 text-muted-foreground font-medium">台词</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l, i) => (
                                  <tr key={i} className="border-b border-border/50 last:border-0">
                                    <td className="py-2 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                                    <td className="py-2 pr-3 text-muted-foreground tabular-nums">{l.index}</td>
                                    <td className="py-2 pr-3">
                                      <Badge variant="outline" className="text-xs">{l.type}</Badge>
                                    </td>
                                    <td className="py-2 pr-3 text-muted-foreground">{l.character}</td>
                                    <td className="py-2">{l.text}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {subStoryboards.length === 0 && selectedProjectId && (
                  <Card className="bg-card border-border border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                      <MessageSquare className="w-8 h-8 text-muted-foreground opacity-40" />
                      <p className="text-sm text-muted-foreground">点击「加载分镜」后，此处将显示台词预览</p>
                      <p className="text-xs text-muted-foreground/70">支持导出 TXT / SRT / VTT / CSV 格式</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* ── 声音设计（P2）── */}
            <TabsContent value="voice_design">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左：配置 */}
                <div className="space-y-4">
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Wand2 className="w-4 h-4 text-primary" />声音候选采样
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* 模型 */}
                      <div>
                        <Label className="text-xs text-muted-foreground">语音模型</Label>
                        {ttsModels.length === 0 ? (
                          <div className="mt-1.5"><NoTtsGuide compact /></div>
                        ) : (
                          <Select value={vdModelId || 'none'} onValueChange={v => setVdModelId(v === 'none' ? '' : v)}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="选择模型" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">请选择</SelectItem>
                              {ttsModels.map(m => (
                                <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      {/* 试听文本 */}
                      <div>
                        <Label className="text-xs text-muted-foreground">试听文本</Label>
                        <Textarea
                          className="mt-1 resize-none min-h-[80px] text-sm"
                          placeholder="输入用于对比各声音的试听文本"
                          value={vdSampleText}
                          onChange={e => setVdSampleText(e.target.value)}
                        />
                      </div>
                      {/* 声音候选选择 */}
                      {voiceProfiles.length > 0 && (
                        <div>
                          <Label className="text-xs text-muted-foreground">选择候选声音（不选则取前5个）</Label>
                          <div className="mt-1.5 max-h-40 overflow-y-auto space-y-1 border border-border rounded-md p-2">
                            {voiceProfiles.map(vp => (
                              <label key={vp.id} className="flex items-center gap-2 cursor-pointer min-h-8 px-1">
                                <input
                                  type="checkbox"
                                  checked={vdSelectedProfiles.includes(vp.id)}
                                  onChange={() => vdToggleProfile(vp.id)}
                                  className="accent-primary"
                                />
                                <span className="text-xs">{vp.name}</span>
                                {vp.language && <Badge variant="outline" className="text-xs ml-auto">{vp.language}</Badge>}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      <Button className="w-full" onClick={handleVdGenerate} disabled={vdRunning || ttsModels.length === 0}>
                        {vdRunning
                          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />采样中…</>
                          : <><Wand2 className="w-4 h-4 mr-2" />生成声音样本</>}
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* 右：结果 */}
                <div className="space-y-3">
                  {vdSamples.length > 0 ? (
                    vdSamples.map(s => (
                      <Card key={s.id} className="bg-card border-border">
                        <CardContent className="p-3 flex items-center gap-3 min-w-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{s.voiceName}</p>
                            {s.status === 'error' && (
                              <p className="text-xs text-destructive truncate">{s.error}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {s.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                            {s.status === 'done' && s.audioUrl && (
                              <Button size="sm" variant="secondary" className="h-7 w-7 p-0"
                                onClick={() => vdPlay(s.id, s.audioUrl!)}>
                                {vdPlayingId === s.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              </Button>
                            )}
                            {s.status === 'done' && s.audioUrl && (
                              <Button size="sm" variant="secondary" className="h-7 text-xs px-2"
                                onClick={async () => {
                                  const a = document.createElement('a');
                                  a.href = s.audioUrl!;
                                  a.download = `${s.voiceName}_sample.mp3`; a.click();
                                }}>
                                <Download className="w-3 h-3 mr-1" />下载
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <Card className="bg-card border-border border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                        <Wand2 className="w-8 h-8 text-muted-foreground opacity-40" />
                        <p className="text-sm text-muted-foreground">生成后，各声音的试听样本将在此对比显示</p>
                        <p className="text-xs text-muted-foreground/70">选择多个声音配置，用同一段文本对比音色效果</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── 声音转换（P2）── */}
            <TabsContent value="voice_conversion">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左：配置 */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ArrowLeftRight className="w-4 h-4 text-primary" />声音转换配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* API 配置 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">转换服务配置（需设置声音转换接口路径）</Label>
                      {vcvApiConfigs.length === 0 ? (
                        <p className="text-xs text-muted-foreground mt-1.5 border border-border rounded-md px-3 py-2">
                          暂无可用配置，请在「模型配置」中填写 voice_conversion_path（如 /v1/speech/convert）
                        </p>
                      ) : (
                        <Select value={vcvApiConfigId || 'none'} onValueChange={v => setVcvApiConfigId(v === 'none' ? '' : v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="选择配置" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">请选择</SelectItem>
                            {vcvApiConfigs.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {/* 源音频 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">源音频 *</Label>
                      <div
                        className="mt-1 border border-dashed border-border rounded-md px-4 py-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => vcvFileRef.current?.click()}
                      >
                        {vcvSourceFile
                          ? <p className="text-sm font-medium text-foreground">{vcvSourceFile.name}</p>
                          : <p className="text-sm text-muted-foreground"><Upload className="w-4 h-4 inline mr-1.5" />点击选择要转换的音频</p>
                        }
                      </div>
                      <input ref={vcvFileRef} type="file" accept="audio/*" className="hidden"
                        onChange={e => setVcvSourceFile(e.target.files?.[0] || null)} />
                    </div>
                    {/* 目标声音 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">目标声音 *（从声音库选择）</Label>
                      {voiceProfiles.length === 0 ? (
                        <p className="text-xs text-muted-foreground mt-1.5 border border-border rounded-md px-3 py-2">
                          声音库为空，请先添加声音
                        </p>
                      ) : (
                        <Select value={vcvTargetVpId || 'none'} onValueChange={v => setVcvTargetVpId(v === 'none' ? '' : v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="选择目标声音" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">请选择</SelectItem>
                            {voiceProfiles.map(vp => (
                              <SelectItem key={vp.id} value={vp.id}>{vp.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <Button className="w-full" onClick={handleVcvConvert}
                      disabled={vcvLoading || vcvApiConfigs.length === 0 || !vcvSourceFile || !vcvTargetVpId}>
                      {vcvLoading
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />转换中…</>
                        : <><ArrowLeftRight className="w-4 h-4 mr-2" />开始转换</>}
                    </Button>
                  </CardContent>
                </Card>

                {/* 右：结果 */}
                <div className="space-y-3">
                  {vcvResultUrl ? (
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">转换结果</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <audio controls src={vcvResultUrl} className="w-full" />
                        <Button size="sm" variant="secondary" className="w-full"
                          onClick={() => {
                            const a = document.createElement('a');
                            a.href = vcvResultUrl; a.download = 'voice_converted.mp3'; a.click();
                          }}>
                          <Download className="w-3.5 h-3.5 mr-1.5" />下载音频
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="bg-card border-border border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                        <ArrowLeftRight className="w-8 h-8 text-muted-foreground opacity-40" />
                        <p className="text-sm text-muted-foreground">转换结果将在此显示</p>
                        <p className="text-xs text-muted-foreground/70">保留原有语气和节奏，替换为目标音色</p>
                      </CardContent>
                    </Card>
                  )}
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">使用说明</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground space-y-1.5">
                      <p>声音转换需要服务商支持相应接口（如 ElevenLabs Speech to Speech）。</p>
                      <p>请在「模型配置」中为对应 API 填写 <code className="bg-muted px-1 rounded">voice_conversion_path</code> 字段后方可使用。</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* ── 音频增强（P2）── */}
            <TabsContent value="enhancement">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 左：配置 */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <SlidersHorizontal className="w-4 h-4 text-primary" />音频处理配置
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 上传音频 */}
                    <div>
                      <Label className="text-xs text-muted-foreground">上传音频文件 *</Label>
                      <div
                        className="mt-1 border border-dashed border-border rounded-md px-4 py-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => enhFileRef.current?.click()}
                      >
                        {enhFile
                          ? <p className="text-sm font-medium text-foreground">{enhFile.name}</p>
                          : <p className="text-sm text-muted-foreground"><Upload className="w-4 h-4 inline mr-1.5" />点击选择音频文件</p>
                        }
                      </div>
                      <input ref={enhFileRef} type="file" accept="audio/*" className="hidden"
                        onChange={e => { setEnhFile(e.target.files?.[0] || null); setEnhResultUrl(null); }} />
                    </div>

                    {/* 处理选项 */}
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">处理选项</p>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">响度归一化</p>
                          <p className="text-xs text-muted-foreground">将音频峰值提升到 -0.2dB，统一响度</p>
                        </div>
                        <Switch checked={enhNormalize} onCheckedChange={setEnhNormalize} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm">首尾静音裁剪</p>
                          <p className="text-xs text-muted-foreground">去掉头尾的安静段落</p>
                        </div>
                        <Switch checked={enhTrimSilence} onCheckedChange={setEnhTrimSilence} />
                      </div>
                      {enhTrimSilence && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            静音阈值：{enhSilenceThreshold} dB
                          </Label>
                          <Slider
                            className="mt-2"
                            min={-80} max={-10} step={5}
                            value={[enhSilenceThreshold]}
                            onValueChange={([v]) => setEnhSilenceThreshold(v)}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>-80dB（宽松）</span><span>-10dB（严格）</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <Button className="w-full" onClick={handleEnhProcess} disabled={enhProcessing || !enhFile}>
                      {enhProcessing
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />处理中…</>
                        : <><SlidersHorizontal className="w-4 h-4 mr-2" />开始处理</>}
                    </Button>
                  </CardContent>
                </Card>

                {/* 右：结果 */}
                <div className="space-y-3">
                  {enhResultUrl ? (
                    <Card className="bg-card border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">处理结果</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <audio controls src={enhResultUrl} className="w-full" />
                        <Button size="sm" variant="secondary" className="w-full" onClick={enhDownload}>
                          <Download className="w-3.5 h-3.5 mr-1.5" />下载 WAV
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="bg-card border-border border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                        <SlidersHorizontal className="w-8 h-8 text-muted-foreground opacity-40" />
                        <p className="text-sm text-muted-foreground">处理结果将在此预览</p>
                        <p className="text-xs text-muted-foreground/70">在浏览器端完成，无需上传到服务器</p>
                      </CardContent>
                    </Card>
                  )}
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">功能说明</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground space-y-1">
                      <p>当前使用浏览器内 Web Audio API 进行本地处理，支持：</p>
                      <ul className="list-disc list-inside space-y-0.5 mt-1">
                        <li>响度归一化（峰值对齐）</li>
                        <li>首尾静音裁剪</li>
                        <li>导出为标准 WAV 格式</li>
                      </ul>
                      <p className="pt-1 text-muted-foreground/70">降噪、去混响、格式转换等高级功能将在后续版本中通过 AI 增强服务提供。</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

          </Tabs>
        </div>
      </div>

      {/* 手动添加 / 编辑声音弹窗 */}
      <VoiceProfileDialog
        open={vpDialogOpen}
        onOpenChange={setVpDialogOpen}
        profile={editingVp}
        apiConfigs={apiConfigs}
        onSaved={loadData}
      />

      {/* 同步声音弹窗 */}
      <SyncVoicesDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        apiConfigs={apiConfigs}
        onSynced={loadData}
        onManualAdd={() => setVpDialogOpen(true)}
        onCreateVoice={() => setCreateVoiceOpen(true)}
      />

      {/* 创建声音模型弹窗 */}
      <CreateVoiceDialog
        open={createVoiceOpen}
        onOpenChange={setCreateVoiceOpen}
        apiConfigs={apiConfigs}
        onCreated={loadData}
      />

      {/* 删除确认 */}
      <AlertDialog open={!!deleteVpId} onOpenChange={open => !open && setDeleteVpId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复，确认要删除该声音配置吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteVpId && handleDeleteVp(deleteVpId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
