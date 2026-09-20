import MainLayout from '@/components/layouts/MainLayout';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  BookOpen, Plus, Trash2, Type, Image, MessageSquare, Minus, Square,
  AlignLeft, AlignCenter, AlignRight, Bold, Lock, Unlock,
  ChevronUp, ChevronDown, Download, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProject } from '@/contexts/ProjectContext';
import { getComicDrafts, createComicDraft, updateComicDraft } from '@/services/api';
import type { ComicDraft, CanvasConfig, CanvasElement } from '@/types/types';

type ElementType = 'image' | 'text' | 'bubble' | 'rect' | 'divider';
type BubbleShape = 'speech' | 'thought' | 'exclamation' | 'narration';

const BUBBLE_SHAPES: { value: BubbleShape; label: string }[] = [
  { value: 'speech', label: '对白气泡' },
  { value: 'thought', label: '心声气泡' },
  { value: 'exclamation', label: '惊讶气泡' },
  { value: 'narration', label: '旁白框' },
];

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36];
const DEFAULT_CANVAS_WIDTH = 750;

function BubbleSvg({ shape, text, color = '#fff', bg = '#222' }: { shape: BubbleShape; text: string; color?: string; bg?: string }) {
  const common = { fill: bg, stroke: '#555', strokeWidth: 1 };
  if (shape === 'speech') return (
    <svg viewBox="0 0 100 60" className="w-full h-full">
      <rect x="2" y="2" width="96" height="46" rx="10" {...common} />
      <polygon points="25,48 15,58 35,48" fill={bg} stroke="#555" strokeWidth="1" />
      <text x="50" y="28" textAnchor="middle" fontSize="11" fill={color} dominantBaseline="middle">{text}</text>
    </svg>
  );
  if (shape === 'thought') return (
    <svg viewBox="0 0 100 60" className="w-full h-full">
      <ellipse cx="50" cy="25" rx="46" ry="22" {...common} />
      <circle cx="28" cy="52" r="4" fill={bg} stroke="#555" strokeWidth="1" />
      <circle cx="20" cy="58" r="2.5" fill={bg} stroke="#555" strokeWidth="1" />
      <text x="50" y="26" textAnchor="middle" fontSize="11" fill={color} dominantBaseline="middle">{text}</text>
    </svg>
  );
  if (shape === 'exclamation') return (
    <svg viewBox="0 0 100 60" className="w-full h-full">
      <polygon points="50,2 98,58 2,58" {...common} />
      <polygon points="25,58 15,68 35,58" fill={bg} stroke="#555" strokeWidth="1" />
      <text x="50" y="40" textAnchor="middle" fontSize="11" fill={color} dominantBaseline="middle">{text}</text>
    </svg>
  );
  return (
    <svg viewBox="0 0 100 50" className="w-full h-full">
      <rect x="1" y="1" width="98" height="48" rx="2" {...common} />
      <text x="50" y="26" textAnchor="middle" fontSize="11" fill={color} dominantBaseline="middle">{text}</text>
    </svg>
  );
}

function ElementRenderer({ el, scale, onSelect, selected }: {
  el: CanvasElement; scale: number; onSelect: () => void; selected: boolean;
}) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onSelect(); }}
      className={`absolute cursor-pointer ${el.locked ? 'pointer-events-none' : ''}`}
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.width * scale,
        height: el.height * scale,
        transform: `rotate(${el.rotation || 0}deg)`,
        opacity: el.opacity,
        zIndex: el.z_index,
        outline: selected ? '2px solid hsl(var(--primary))' : undefined,
        boxSizing: 'border-box',
      }}
    >
      {el.type === 'image' && (
        el.content
          ? <img src={el.content} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-muted border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground"><Image className="w-5 h-5" /></div>
      )}
      {el.type === 'text' && (
        <div className="w-full h-full overflow-hidden" style={{
          fontSize: (el.font_size || 14) * scale,
          color: el.color || '#e5e7eb',
          fontWeight: el.bold ? 'bold' : 'normal',
          textAlign: (el.text_align as 'left' | 'center' | 'right') || 'left',
          backgroundColor: el.background_color || 'transparent',
          lineHeight: el.line_height || 1.5,
          letterSpacing: el.letter_spacing || 0,
          padding: 2,
        }}>
          {el.content}
        </div>
      )}
      {el.type === 'bubble' && (
        <BubbleSvg
          shape={(el.bubble_shape as BubbleShape) || 'speech'}
          text={el.content || ''}
          color={el.color || '#fff'}
          bg={el.background_color || '#222'}
        />
      )}
      {el.type === 'rect' && (
        <div className="w-full h-full" style={{ backgroundColor: el.background_color || '#333', border: `1px solid ${el.color || '#555'}`, opacity: el.opacity }} />
      )}
      {el.type === 'divider' && (
        <div className="w-full border-t" style={{ borderColor: el.color || '#555', borderWidth: (el.font_size || 1) * scale, marginTop: (el.height * scale) / 2 }} />
      )}
    </div>
  );
}

export default function ComicEditorPage() {
  const { selectedProjectId } = useProject();
  const [drafts, setDrafts] = useState<ComicDraft[]>([]);
  const [activeDraft, setActiveDraft] = useState<ComicDraft | null>(null);
  const [config, setConfig] = useState<CanvasConfig>({ width: DEFAULT_CANVAS_WIDTH, height: 2000, backgroundColor: '#0a0a0a', panels: [] });
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoSaveCount, setAutoSaveCount] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg'>('png');
  const [exportQuality, setExportQuality] = useState(90);
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const CANVAS_SCALE = 0.5;

  const selectedEl = elements.find(e => e.id === selectedId) || null;

  useEffect(() => {
    if (selectedProjectId) {
      getComicDrafts(selectedProjectId).then(setDrafts).catch(() => {});
    }
  }, [selectedProjectId]);

  // 自动保存
  useEffect(() => {
    if (!activeDraft) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await updateComicDraft(activeDraft.id, {
        canvas_config: config,
        elements,
        version: (activeDraft.version || 0) + 1,
      });
      setAutoSaveCount(c => c + 1);
    }, 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [elements, config, activeDraft]);

  async function handleCreateDraft() {
    if (!selectedProjectId) { toast.error('请先选择项目'); return; }
    if (!draftName.trim()) { toast.error('请输入草稿名称'); return; }
    const draft = await createComicDraft({
      project_id: selectedProjectId,
      name: draftName,
      canvas_config: config,
      elements: [],
      version: 1,
    });
    setDrafts(prev => [draft, ...prev]);
    setActiveDraft(draft);
    setElements([]);
    setNewDraftOpen(false);
    setDraftName('');
    toast.success('草稿已创建');
  }

  function openDraft(draft: ComicDraft) {
    setActiveDraft(draft);
    setConfig(draft.canvas_config || { width: DEFAULT_CANVAS_WIDTH, height: 2000, backgroundColor: '#0a0a0a', panels: [] });
    setElements(draft.elements || []);
    setSelectedId(null);
  }

  function addElement(type: ElementType) {
    const id = `el_${Date.now()}`;
    const base = { id, type, x: 50, y: 50, width: type === 'divider' ? config.width - 40 : 200, height: type === 'divider' ? 4 : (type === 'text' ? 60 : 150), rotation: 0, opacity: 1, z_index: elements.length + 1, locked: false };
    let extra: Partial<CanvasElement> = {};
    if (type === 'text') extra = { content: '点击编辑文字', font_size: 16, color: '#e5e7eb', text_align: 'left', bold: false, line_height: 1.5, letter_spacing: 0 };
    if (type === 'bubble') extra = { content: '对话内容', bubble_shape: 'speech', color: '#fff', background_color: '#222' };
    if (type === 'rect') extra = { background_color: '#333', color: '#555' };
    setElements(prev => [...prev, { ...base, ...extra } as CanvasElement]);
    setSelectedId(id);
  }

  function updateElement(id: string, updates: Partial<CanvasElement>) {
    setElements(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }

  function deleteElement(id: string) {
    setElements(prev => prev.filter(e => e.id !== id));
    setSelectedId(null);
  }

  function moveZ(id: string, dir: 'up' | 'down') {
    const el = elements.find(e => e.id === id);
    if (!el) return;
    updateElement(id, { z_index: el.z_index + (dir === 'up' ? 1 : -1) });
  }

  async function handleExport() {
    // 使用 html2canvas or simple screenshot approach
    toast.info('导出功能：将在完整版中接入 html2canvas 实现长图导出');
    setExportOpen(false);
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4 h-full flex flex-col">
        <div className="flex items-center justify-between gap-4 flex-wrap shrink-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-orange-400" />条漫编辑器
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {activeDraft && (
              <span className="text-xs text-muted-foreground">
                {autoSaveCount > 0 ? '✓ 已自动保存' : ''}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => setNewDraftOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />新建草稿
            </Button>
            {activeDraft && (
              <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
                <Download className="w-4 h-4 mr-1" />导出
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* 左侧：草稿列表 */}
          <div className="w-44 shrink-0 space-y-2 overflow-y-auto">
            <h3 className="text-xs font-semibold text-muted-foreground px-1">草稿</h3>
            {drafts.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1">暂无草稿</p>
            ) : (
              drafts.map(d => (
                <button key={d.id} onClick={() => openDraft(d)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${activeDraft?.id === d.id ? 'bg-primary/20 text-primary' : 'hover:bg-secondary text-muted-foreground'}`}>
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="opacity-60">v{d.version}</div>
                </button>
              ))
            )}
          </div>

          {/* 中间：工具栏 + 画布 */}
          <div className="flex flex-col flex-1 min-w-0 gap-3">
            {/* 工具栏 */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <span className="text-xs text-muted-foreground">添加元素：</span>
              {([
                { type: 'image', icon: Image, label: '图片' },
                { type: 'text', icon: Type, label: '文字' },
                { type: 'bubble', icon: MessageSquare, label: '气泡' },
                { type: 'rect', icon: Square, label: '矩形' },
                { type: 'divider', icon: Minus, label: '分割线' },
              ] as { type: ElementType; icon: React.ElementType; label: string }[]).map(({ type, icon: Icon, label }) => (
                <Button key={type} variant="secondary" size="sm" onClick={() => { if (!activeDraft) { toast.error('请先创建或选择草稿'); return; } addElement(type); }}>
                  <Icon className="w-3 h-3 mr-1" />{label}
                </Button>
              ))}
              {selectedEl && !selectedEl.locked && (
                <>
                  <Separator orientation="vertical" className="h-6" />
                  <Button variant="ghost" size="sm" onClick={() => moveZ(selectedEl.id, 'up')}><ChevronUp className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => moveZ(selectedEl.id, 'down')}><ChevronDown className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => updateElement(selectedEl.id, { locked: true })}><Lock className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteElement(selectedEl.id)}><Trash2 className="w-4 h-4" /></Button>
                </>
              )}
              {selectedEl?.locked && (
                <Button variant="ghost" size="sm" onClick={() => updateElement(selectedEl.id, { locked: false })}><Unlock className="w-4 h-4" /></Button>
              )}
            </div>

            {/* 画布 */}
            {activeDraft ? (
              <div className="flex-1 overflow-auto bg-muted/20 rounded-lg border border-border p-4">
                <div
                  ref={canvasRef}
                  className="relative mx-auto"
                  onClick={() => setSelectedId(null)}
                  style={{
                    width: config.width * CANVAS_SCALE,
                    height: config.height * CANVAS_SCALE,
                    backgroundColor: config.backgroundColor,
                    border: '1px solid hsl(var(--border))',
                  }}
                >
                  {[...elements].sort((a, b) => a.z_index - b.z_index).map(el => (
                    <ElementRenderer
                      key={el.id}
                      el={el}
                      scale={CANVAS_SCALE}
                      selected={el.id === selectedId}
                      onSelect={() => setSelectedId(el.id)}
                    />
                  ))}
                  {elements.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm opacity-40">
                      点击上方按钮添加元素
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>选择已有草稿或新建一个</p>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：属性面板 */}
          {selectedEl && !selectedEl.locked && (
            <div className="w-52 shrink-0 overflow-y-auto space-y-4">
              <Card className="bg-card border-border">
                <CardContent className="p-3 space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">位置与大小</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">X</Label><Input className="mt-0.5 h-7 text-xs" type="number" value={selectedEl.x} onChange={e => updateElement(selectedEl.id, { x: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">Y</Label><Input className="mt-0.5 h-7 text-xs" type="number" value={selectedEl.y} onChange={e => updateElement(selectedEl.id, { y: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">宽</Label><Input className="mt-0.5 h-7 text-xs" type="number" value={selectedEl.width} onChange={e => updateElement(selectedEl.id, { width: Number(e.target.value) })} /></div>
                    <div><Label className="text-xs">高</Label><Input className="mt-0.5 h-7 text-xs" type="number" value={selectedEl.height} onChange={e => updateElement(selectedEl.id, { height: Number(e.target.value) })} /></div>
                  </div>
                  <div>
                    <Label className="text-xs">透明度 {Math.round(selectedEl.opacity * 100)}%</Label>
                    <Slider className="mt-1" min={0} max={1} step={0.05} value={[selectedEl.opacity]} onValueChange={([v]) => updateElement(selectedEl.id, { opacity: v })} />
                  </div>
                  <div>
                    <Label className="text-xs">旋转 {selectedEl.rotation || 0}°</Label>
                    <Slider className="mt-1" min={-180} max={180} step={1} value={[selectedEl.rotation || 0]} onValueChange={([v]) => updateElement(selectedEl.id, { rotation: v })} />
                  </div>
                </CardContent>
              </Card>

              {/* 文字属性 */}
              {(selectedEl.type === 'text' || selectedEl.type === 'bubble') && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3 space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground">文字属性</h3>
                    <div>
                      <Label className="text-xs">内容</Label>
                      <textarea className="mt-0.5 w-full text-xs bg-muted rounded p-1 border border-border resize-none" rows={3}
                        value={selectedEl.content || ''}
                        onChange={e => updateElement(selectedEl.id, { content: e.target.value })}
                      />
                    </div>
                    <div><Label className="text-xs">字号</Label>
                      <Select value={String(selectedEl.font_size || 14)} onValueChange={v => updateElement(selectedEl.id, { font_size: Number(v) })}>
                        <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{FONT_SIZES.map(s => <SelectItem key={s} value={String(s)}>{s}px</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label className="text-xs">颜色</Label>
                      <Input className="mt-0.5 h-7" type="color" value={selectedEl.color || '#e5e7eb'} onChange={e => updateElement(selectedEl.id, { color: e.target.value })} />
                    </div>
                    {selectedEl.type === 'text' && (
                      <div className="flex gap-1">
                        {[
                          { align: 'left', Icon: AlignLeft },
                          { align: 'center', Icon: AlignCenter },
                          { align: 'right', Icon: AlignRight },
                        ].map(({ align, Icon }) => (
                          <Button key={align} variant={selectedEl.text_align === align ? 'default' : 'ghost'} size="sm" className="h-7 w-7 p-0"
                            onClick={() => updateElement(selectedEl.id, { text_align: align })}>
                            <Icon className="w-3 h-3" />
                          </Button>
                        ))}
                        <Button variant={selectedEl.bold ? 'default' : 'ghost'} size="sm" className="h-7 w-7 p-0"
                          onClick={() => updateElement(selectedEl.id, { bold: !selectedEl.bold })}>
                          <Bold className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    {selectedEl.type === 'bubble' && (
                      <div><Label className="text-xs">气泡样式</Label>
                        <Select value={selectedEl.bubble_shape || 'speech'} onValueChange={v => updateElement(selectedEl.id, { bubble_shape: v })}>
                          <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{BUBBLE_SHAPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 图片属性 */}
              {selectedEl.type === 'image' && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3 space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground">图片</h3>
                    <div>
                      <Label className="text-xs">图片URL</Label>
                      <Input className="mt-0.5 h-7 text-xs" value={selectedEl.content || ''} onChange={e => updateElement(selectedEl.id, { content: e.target.value })} placeholder="粘贴图片URL" />
                    </div>
                    <label>
                      <input type="file" accept="image/*" className="hidden" onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = ev => updateElement(selectedEl.id, { content: ev.target?.result as string });
                        reader.readAsDataURL(file);
                      }} />
                      <span className="cursor-pointer text-xs text-primary hover:underline">上传本地图片</span>
                    </label>
                  </CardContent>
                </Card>
              )}

              {/* 背景色 */}
              {(selectedEl.type === 'rect' || selectedEl.type === 'bubble') && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">填充色</h3>
                    <Input type="color" className="h-8" value={selectedEl.background_color || '#333'} onChange={e => updateElement(selectedEl.id, { background_color: e.target.value })} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* 画布设置（无选中时显示） */}
          {!selectedEl && activeDraft && (
            <div className="w-52 shrink-0 overflow-y-auto">
              <Card className="bg-card border-border">
                <CardContent className="p-3 space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">画布设置</h3>
                  <div><Label className="text-xs">宽度 (px)</Label><Input className="mt-0.5 h-7 text-xs" type="number" value={config.width} onChange={e => setConfig(c => ({ ...c, width: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">高度 (px)</Label><Input className="mt-0.5 h-7 text-xs" type="number" value={config.height} onChange={e => setConfig(c => ({ ...c, height: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">背景色</Label><Input className="mt-0.5 h-8" type="color" value={config.backgroundColor} onChange={e => setConfig(c => ({ ...c, backgroundColor: e.target.value }))} /></div>
                  <div className="pt-1">
                    <h4 className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Layers className="w-3 h-3" />元素列表</h4>
                    {elements.length === 0 ? <p className="text-xs text-muted-foreground">暂无元素</p> : (
                      <div className="space-y-1">
                        {[...elements].sort((a, b) => b.z_index - a.z_index).map(el => (
                          <div key={el.id} className="flex items-center gap-1 text-xs">
                            <button className="flex-1 text-left truncate hover:text-primary transition-colors py-0.5 px-1 rounded hover:bg-secondary"
                              onClick={() => setSelectedId(el.id)}>
                              {el.locked && <Lock className="w-2.5 h-2.5 inline mr-0.5" />}
                              {el.type} {el.content ? `"${String(el.content).slice(0, 12)}"` : ''}
                            </button>
                            <button className="text-destructive opacity-60 hover:opacity-100" onClick={() => deleteElement(el.id)}>
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* 新建草稿 */}
      <Dialog open={newDraftOpen} onOpenChange={setNewDraftOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <DialogHeader><DialogTitle>新建条漫草稿</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>草稿名称</Label><Input className="mt-1" value={draftName} onChange={e => setDraftName(e.target.value)} placeholder="条漫标题..." /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>宽度 (px)</Label><Input className="mt-1" type="number" value={config.width} onChange={e => setConfig(c => ({ ...c, width: Number(e.target.value) }))} /></div>
              <div><Label>高度 (px)</Label><Input className="mt-1" type="number" value={config.height} onChange={e => setConfig(c => ({ ...c, height: Number(e.target.value) }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewDraftOpen(false)}>取消</Button>
            <Button onClick={handleCreateDraft}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出设置 */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm bg-card border-border">
          <DialogHeader><DialogTitle>导出条漫</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>格式</Label>
              <Select value={exportFormat} onValueChange={v => setExportFormat(v as 'png' | 'jpg')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG（无损）</SelectItem>
                  <SelectItem value="jpg">JPG（有损压缩）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>图片质量：{exportQuality}%</Label>
              <Slider className="mt-2" min={60} max={100} step={5} value={[exportQuality]} onValueChange={([v]) => setExportQuality(v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>取消</Button>
            <Button onClick={handleExport}><Download className="w-4 h-4 mr-1" />导出</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
