import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  LayoutDashboard, Lightbulb, FileText, Film, Image, Video, Archive,
  BookOpen, Settings, Menu, Cpu, ChevronLeft, ChevronRight, BookMarked, Music,
  Scissors, HardDrive, ListChecks,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { path: '/', label: '工作台', icon: LayoutDashboard, group: 'main' },
  { path: '/topics', label: '爆款选题', icon: Lightbulb, group: 'create' },
  { path: '/scripts', label: '剧本生成', icon: FileText, group: 'create' },
  { path: '/storyboards', label: '分镜脚本', icon: Film, group: 'create' },
  { path: '/images', label: '图片生成', icon: Image, group: 'create' },
  { path: '/videos', label: '视频生成', icon: Video, group: 'create' },
  { path: '/audio', label: '音频制作', icon: Music, group: 'create' },
  { path: '/editor', label: '剪辑台', icon: Scissors, group: 'manage' },
  { path: '/tasks', label: '任务中心', icon: ListChecks, group: 'manage' },
  { path: '/assets', label: '素材库', icon: Archive, group: 'manage' },
  { path: '/comic-editor', label: '条漫编辑器', icon: BookOpen, group: 'manage' },
  { path: '/model-config/image', label: '图片模型配置', icon: Image, group: 'config' },
  { path: '/model-config/video', label: '视频模型配置', icon: Video, group: 'config' },
  { path: '/model-config', label: '通用模型配置', icon: Cpu, group: 'config' },
  { path: '/templates', label: '提示词模板', icon: BookMarked, group: 'config' },
  { path: '/settings', label: '应用设置', icon: Settings, group: 'config' },
];

const groupLabels: Record<string, string> = {
  main: '工作台',
  create: '内容创作',
  manage: '素材管理',
  config: '系统配置',
};

function SidebarContent({ collapsed, onNavClick }: { collapsed?: boolean; onNavClick?: () => void }) {
  const location = useLocation();

  const groups = ['main', 'create', 'manage', 'config'];

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn('flex items-center gap-3 px-4 py-5', collapsed && 'justify-center px-2')}>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-sm">动</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground truncate">动画大丸家</div>
            <div className="text-xs text-muted-foreground">3.0</div>
          </div>
        )}
      </div>
      <Separator className="bg-border" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {groups.map((group) => {
          const items = navItems.filter(i => i.group === group);
          return (
            <div key={group} className="mb-4">
              {!collapsed && (
                <div className="text-xs text-muted-foreground px-2 py-1.5 font-medium uppercase tracking-wider">
                  {groupLabels[group]}
                </div>
              )}
              {items.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                if (collapsed) {
                  return (
                    <TooltipProvider key={item.path} delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.path}
                            onClick={onNavClick}
                            className={cn(
                              'flex items-center justify-center w-full h-9 rounded-md mb-1 transition-colors',
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                            )}
                          >
                            <Icon className="w-4 h-4" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                }
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onNavClick}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm mb-0.5 transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* 本地版标识：没有账号体系，这里只标明数据存本机 */}
      <Separator className="bg-border" />
      <div className="p-2">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <HardDrive className="w-3.5 h-3.5 shrink-0" />
          {!collapsed && <span>本地版 · 数据存本机</span>}
        </div>
      </div>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 border-r border-border bg-sidebar transition-all duration-200',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        <SidebarContent collapsed={collapsed} />
        {/* Collapse toggle */}
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-56 p-0 bg-sidebar border-border">
          <SidebarContent onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-x-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-border bg-card shrink-0">
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-xs">动</span>
            </div>
            <span className="text-sm font-bold truncate">动画大丸家 3.0</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
