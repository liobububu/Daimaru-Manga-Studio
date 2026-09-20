// 素材库选择弹窗 — 供图片生成、视频生成等页面复用
import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Image, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAssets } from '@/services/api';
import type { Asset, AssetType } from '@/types/types';

interface AssetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认选择后回调；single 模式返回一个素材，multi 模式返回数组 */
  onSelect: (assets: Asset[]) => void;
  /** 是否支持多选（默认单选） */
  multiple?: boolean;
  /** 限制显示的素材类型（默认显示全部图片） */
  assetType?: AssetType;
  projectId?: string;
  title?: string;
}

const ALL_PROJECTS = '__all__';

export default function AssetPickerDialog({
  open,
  onOpenChange,
  onSelect,
  multiple = false,
  assetType = 'image',
  projectId,
  title = '从素材库选择',
}: AssetPickerDialogProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterProject, setFilterProject] = useState<string>(projectId || ALL_PROJECTS);

  // 重置选中状态
  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pid = filterProject === ALL_PROJECTS ? undefined : filterProject;
      // 如果没有 projectId 作为筛选条件，则 getAssets 需要一个有效的 projectId；
      // 此处通过传入 projectId 参数拉取，空时拉取当前用户所有图片
      const data = pid
        ? await getAssets(pid, assetType)
        : await getAssetsAllProjects(assetType);
      setAssets(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterProject, assetType]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const filtered = assets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  function toggleSelect(id: string) {
    if (!multiple) {
      setSelected(new Set([id]));
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const chosen = assets.filter(a => selected.has(a.id));
    if (chosen.length === 0) return;
    onSelect(chosen);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl bg-card border-border flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* 过滤栏 */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="搜索素材名称…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {!projectId && (
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="w-36 shrink-0"><SelectValue placeholder="全部项目" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS}>全部项目</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* 素材网格 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {[1,2,3,4,5,6].map(i => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Image className="w-10 h-10 opacity-40" />
              <p className="text-sm">{assets.length === 0 ? '当前项目暂无图片素材' : '没有匹配的素材'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map(a => {
                const isSelected = selected.has(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleSelect(a.id)}
                    className={cn(
                      'relative aspect-square rounded-lg overflow-hidden border-2 transition-all focus:outline-none',
                      isSelected
                        ? 'border-primary ring-2 ring-primary/40'
                        : 'border-border/50 hover:border-primary/50',
                    )}
                  >
                    {a.thumbnail_url || a.file_url ? (
                      <img
                        src={a.thumbnail_url || a.file_url}
                        alt={a.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <Image className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    {/* 选中标记 */}
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-3 h-3 text-primary-foreground" />
                      </div>
                    )}
                    {/* 名称 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                      <p className="text-xs text-white truncate">{a.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {multiple && selected.size > 0 && (
            <Badge variant="secondary" className="mr-auto">
              已选 {selected.size} 张
            </Badge>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            确认选择{selected.size > 0 ? `（${selected.size}）` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 获取当前用户所有项目的图片素材（跨项目浏览） */
async function getAssetsAllProjects(assetType?: AssetType): Promise<Asset[]> {
  const { db } = await import('@/db/client');
  let q = db.from('assets').select('*').order('created_at', { ascending: false }).limit(200);
  if (assetType) q = q.eq('asset_type', assetType);
  const { data } = await q;
  return (data || []) as Asset[];
}
