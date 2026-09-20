import WorkbenchPage from './pages/WorkbenchPage';
import TopicsPage from './pages/TopicsPage';
import ScriptsPage from './pages/ScriptsPage';
import StoryboardsPage from './pages/StoryboardsPage';
import ImagesPage from './pages/ImagesPage';
import VideosPage from './pages/VideosPage';
import AssetsPage from './pages/AssetsPage';
import ComicEditorPage from './pages/ComicEditorPage';
import ModelConfigPage from './pages/ModelConfigPage';
import TemplatesPage from './pages/TemplatesPage';
import SettingsPage from './pages/SettingsPage';
import AudioProductionPage from './pages/AudioProductionPage';
import EditorPage from './pages/EditorPage';
import type { ReactNode } from 'react';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  public?: boolean;
}

/**
 * 本地版没有登录，也没有管理员 —— 所有路由直接可达。
 * public 字段保留是为了兼容读取该字段的导航组件，恒为 true。
 */
export const routes: RouteConfig[] = [
  { name: '工作台',     path: '/',             element: <WorkbenchPage /> },
  { name: '爆款选题',   path: '/topics',       element: <TopicsPage /> },
  { name: '剧本生成',   path: '/scripts',      element: <ScriptsPage /> },
  { name: '分镜脚本',   path: '/storyboards',  element: <StoryboardsPage /> },
  { name: '图片生成',   path: '/images',       element: <ImagesPage /> },
  { name: '视频生成',   path: '/videos',       element: <VideosPage /> },
  { name: '音频制作',   path: '/audio',        element: <AudioProductionPage /> },
  { name: '素材库',     path: '/assets',       element: <AssetsPage /> },
  { name: '条漫编辑器', path: '/comic-editor', element: <ComicEditorPage /> },
  { name: '剪辑台',     path: '/editor',       element: <EditorPage /> },
  { name: '模型配置',   path: '/model-config', element: <ModelConfigPage /> },
  { name: '提示词模板', path: '/templates',    element: <TemplatesPage /> },
  { name: '应用设置',   path: '/settings',     element: <SettingsPage /> },
];
