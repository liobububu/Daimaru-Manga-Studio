import MainLayout from '@/components/layouts/MainLayout';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Cpu, Plus, Pencil, Trash2, RefreshCw, XCircle, WifiOff, ChevronDown, ChevronUp, Check, RotateCcw, UserPlus, Wand2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getApiConfigs, createApiConfig, updateApiConfig, deleteApiConfig,
  getModelCatalog, upsertModels, updateModelCatalog, cleanInvalidBindings,
  getFunctionModelBindings, updateFunctionModelBinding, createManualModel,
} from '@/services/api';
import type { ApiConfig, ModelCatalog, FunctionModelBinding, ModelCapability } from '@/types/types';
import { FUNCTION_KEY_LABELS, CAPABILITY_LABELS, FUNCTION_CAPABILITY_MAP } from '@/types/types';
import { db } from '@/db/client';
import { useLocation } from 'react-router-dom';

const IMAGE_CAPABILITIES = new Set<ModelCapability>(['image_generation', 'image_edit']);
const VIDEO_CAPABILITIES = new Set<ModelCapability>(FUNCTION_CAPABILITY_MAP.video_generation);

const API_TYPES = [
  { value: 'openai_compatible', label: 'OpenAI 兼容' },
  { value: 'audio_api',        label: '自定义 TTS 接口' },
  { value: 'custom',           label: '自定义' },
  { value: 'comfyui',          label: 'ComfyUI 本地' },
];

// ─── TTS 供应商预设 ────────────────────────────────────────────────────────────
interface TtsPreset {
  label: string;
  provider: string;
  base_url: string;
  audio_tts_path: string;
  audio_tts_method: string;
  audio_tts_auth_type: string;
  audio_tts_response_type: string;
  tts_content_type: string;
  tts_accept: string;
  tts_timeout_seconds: number;
  audio_tts_request_template: string;
  audio_url_path: string;
  audio_base64_path: string;
  audio_tts_error_path: string;
  test_method: string;
  test_path: string;
  note?: string;
}

const TTS_PRESETS: TtsPreset[] = [
  {
    label: 'OpenAI TTS',
    provider: 'OpenAI',
    base_url: 'https://api.openai.com',
    audio_tts_path: '/v1/audio/speech',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'bearer',
    audio_tts_response_type: 'binary_audio',
    tts_content_type: 'application/json',
    tts_accept: 'audio/mpeg',
    tts_timeout_seconds: 120,
    audio_tts_request_template: JSON.stringify({ model: '{{model_id}}', input: '{{text}}', voice: '{{voice_id}}', response_format: '{{format}}', speed: '{{speed}}' }, null, 2),
    audio_url_path: '',
    audio_base64_path: '',
    audio_tts_error_path: 'error.message',
    test_method: 'GET',
    test_path: '/v1/models',
  },
  {
    label: 'MiniMax TTS',
    provider: 'MiniMax',
    base_url: 'https://api.minimax.chat',
    audio_tts_path: '/v1/t2a_v2',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'bearer',
    audio_tts_response_type: 'json_audio_base64',
    tts_content_type: 'application/json',
    tts_accept: 'application/json',
    tts_timeout_seconds: 120,
    audio_tts_request_template: JSON.stringify({ model: '{{model_id}}', text: '{{text}}', voice_setting: { voice_id: '{{voice_id}}', speed: '{{speed}}', vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 } }, null, 2),
    audio_url_path: '',
    audio_base64_path: 'data.audio',
    audio_tts_error_path: 'base_resp.status_msg',
    test_method: 'GET',
    test_path: '/v1/models',
  },
  {
    label: 'ElevenLabs',
    provider: 'ElevenLabs',
    base_url: 'https://api.elevenlabs.io',
    audio_tts_path: '/v1/text-to-speech/{{voice_id}}',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'header_key',
    audio_tts_response_type: 'binary_audio',
    tts_content_type: 'application/json',
    tts_accept: 'audio/mpeg',
    tts_timeout_seconds: 120,
    audio_tts_request_template: JSON.stringify({ text: '{{text}}', model_id: '{{model_id}}', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }, null, 2),
    audio_url_path: '',
    audio_base64_path: '',
    audio_tts_error_path: 'detail.message',
    test_method: 'GET',
    test_path: '/v1/models',
    note: '鉴权 Header 名设为 xi-api-key',
  },
  {
    label: '火山引擎 TTS',
    provider: '字节跳动',
    base_url: 'https://openspeech.bytedance.com',
    audio_tts_path: '/api/v1/tts',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'bearer',
    audio_tts_response_type: 'json_audio_base64',
    tts_content_type: 'application/json',
    tts_accept: 'application/json',
    tts_timeout_seconds: 60,
    audio_tts_request_template: JSON.stringify({ app: { appid: '{{project_id}}', token: 'access_token', cluster: 'volcano_tts' }, user: { uid: '{{storyboard_id}}' }, audio: { voice_type: '{{voice_id}}', encoding: 'mp3', speed_ratio: '{{speed}}' }, request: { reqid: '', text: '{{text}}', text_type: 'plain', operation: 'query' } }, null, 2),
    audio_url_path: '',
    audio_base64_path: 'data',
    audio_tts_error_path: 'message',
    test_method: 'GET',
    test_path: '/api/v1/tts',
    note: '火山 TTS 的 appid 等配置请在请求模板中填写',
  },
  {
    label: 'Fish Audio',
    provider: 'Fish Audio',
    base_url: 'https://api.fish.audio',
    audio_tts_path: '/v1/tts',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'bearer',
    audio_tts_response_type: 'binary_audio',
    tts_content_type: 'application/json',
    tts_accept: 'audio/mpeg',
    tts_timeout_seconds: 120,
    audio_tts_request_template: JSON.stringify({ text: '{{text}}', format: '{{format}}', reference_id: '{{voice_id}}', sample_rate: '{{sample_rate}}', prosody: { speed: '{{speed}}', volume: '{{volume}}' } }, null, 2),
    audio_url_path: '',
    audio_base64_path: '',
    audio_tts_error_path: 'message',
    test_method: 'GET',
    test_path: '/wallet/self/api-credit',
    note: '当前 Supabase EF 出口网络可能无法访问 Fish Audio，如遇超时请配置 FISH_AUDIO_PROXY_URL',
  },
  {
    label: 'Azure TTS',
    provider: 'Microsoft',
    base_url: 'https://eastus.tts.speech.microsoft.com',
    audio_tts_path: '/cognitiveservices/v1',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'header_key',
    audio_tts_response_type: 'binary_audio',
    tts_content_type: 'application/ssml+xml',
    tts_accept: 'audio/mpeg',
    tts_timeout_seconds: 60,
    audio_tts_request_template: '',
    audio_url_path: '',
    audio_base64_path: '',
    audio_tts_error_path: 'message',
    test_method: 'GET',
    test_path: '/cognitiveservices/voices/list',
    note: '鉴权 Header 名设为 Ocp-Apim-Subscription-Key；请求体需为 SSML 格式，建议用自定义模板',
  },
  {
    label: '自定义',
    provider: '',
    base_url: '',
    audio_tts_path: '/v1/tts',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'bearer',
    audio_tts_response_type: 'binary_audio',
    tts_content_type: 'application/json',
    tts_accept: 'audio/mpeg',
    tts_timeout_seconds: 120,
    audio_tts_request_template: JSON.stringify({ model: '{{model_id}}', text: '{{text}}', voice: '{{voice_id}}', format: '{{format}}', speed: '{{speed}}' }, null, 2),
    audio_url_path: 'data.audio_url',
    audio_base64_path: 'data.audio',
    audio_tts_error_path: 'error.message',
    test_method: 'GET',
    test_path: '/v1/models',
  },
];

// ─── OpenAI 兼容服务商预设 ───────────────────────────────────────────────────
// 这些预设只是「省去查文档的起点」，各家端点可能调整，请以服务商官方文档为准。
// 规则：base_url 已含版本段（/v1、/v3、/v4）时，下面的路径不再带版本段，避免拼成 /v1/v1。
interface CompatPreset {
  label: string;
  scopes: Array<'all' | 'image' | 'video'>;
  provider: string;
  base_url: string;
  models_path: string;
  chat_completions_path: string;
  text_response_path: string;
  images_generations_path: string;
  image_response_path: string;
  note?: string;
}

const COMPAT_PRESETS: CompatPreset[] = [
  {
    label: 'OpenAI 官方',
    scopes: ['all', 'image', 'video'],
    provider: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
  {
    label: 'DeepSeek',
    scopes: ['all'],
    provider: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
    note: '官方 base_url 不带 /v1；若请求失败，可在 Base URL 末尾补 /v1 再试',
  },
  {
    label: '月之暗面 Kimi',
    scopes: ['all'],
    provider: 'Moonshot',
    base_url: 'https://api.moonshot.cn/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
  {
    label: '智谱 GLM',
    scopes: ['all'],
    provider: 'Zhipu',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
  {
    label: '硅基流动 SiliconFlow',
    scopes: ['all', 'image', 'video'],
    provider: 'SiliconFlow',
    base_url: 'https://api.siliconflow.cn/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
    note: '文本与图片可用同一份配置',
  },
  {
    label: '火山方舟（豆包）',
    scopes: ['all', 'image', 'video'],
    provider: 'Volcengine',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
  {
    label: '阿里通义千问（兼容模式）',
    scopes: ['all', 'image', 'video'],
    provider: 'Alibaba',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
  {
    label: '腾讯混元',
    scopes: ['all'],
    provider: 'Tencent',
    base_url: 'https://api.hunyuan.cloud.tencent.com/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
  {
    label: 'Ollama（本地）',
    scopes: ['all'],
    provider: 'Ollama',
    base_url: 'http://localhost:11434/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
    note: 'API Key 可随意填写；本机部署需让服务端能访问该地址',
  },
  {
    label: 'LM Studio（本地）',
    scopes: ['all'],
    provider: 'LM Studio',
    base_url: 'http://localhost:1234/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
    note: 'API Key 可随意填写',
  },
  {
    label: 'vLLM（本地）',
    scopes: ['all'],
    provider: 'vLLM',
    base_url: 'http://localhost:8000/v1',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
    note: 'API Key 可随意填写',
  },
  {
    label: '自定义',
    scopes: ['all', 'image', 'video'],
    provider: '',
    base_url: '',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
  },
];

const capabilityColors: Record<string, string> = {
  text_generation:   'bg-blue-500/20 text-blue-300',
  image_generation:  'bg-green-500/20 text-green-300',
  image_edit:        'bg-emerald-500/20 text-emerald-300',
  video_generation:  'bg-red-500/20 text-red-300',
  multimodal:        'bg-purple-500/20 text-purple-300',
  audio_generation:  'bg-yellow-500/20 text-yellow-300',
  audio_recognition: 'bg-orange-500/20 text-orange-300',
  tts:               'bg-amber-500/20 text-amber-300',
  asr:               'bg-orange-500/20 text-orange-300',
  voice_clone:       'bg-pink-500/20 text-pink-300',
  multi_speaker_tts: 'bg-rose-500/20 text-rose-300',
  voice_design:      'bg-violet-500/20 text-violet-300',
  voice_conversion:  'bg-indigo-500/20 text-indigo-300',
  audio_enhancement: 'bg-teal-500/20 text-teal-300',
  // 视频子能力
  text_to_video:               'bg-red-400/20 text-red-300',
  image_to_video:              'bg-rose-400/20 text-rose-300',
  first_last_frame_video:      'bg-pink-400/20 text-pink-300',
  multi_image_reference_video: 'bg-orange-400/20 text-orange-300',
  video_reference_generation:  'bg-amber-400/20 text-amber-300',
  video_to_video:              'bg-red-600/20 text-red-400',
  video_extend:                'bg-rose-600/20 text-rose-400',
  video_repaint:               'bg-fuchsia-500/20 text-fuchsia-300',
  video_edit:                  'bg-purple-400/20 text-purple-300',
  video_style_transfer:        'bg-violet-400/20 text-violet-300',
  audio_driven_video:          'bg-cyan-500/20 text-cyan-300',
  lip_sync:                    'bg-sky-500/20 text-sky-300',
  image_audio_to_video:        'bg-teal-400/20 text-teal-300',
  video_audio_to_video:        'bg-emerald-400/20 text-emerald-300',
  multimodal_video_generation: 'bg-indigo-400/20 text-indigo-300',
  character_reference_video:   'bg-blue-400/20 text-blue-300',
  motion_reference_video:      'bg-green-400/20 text-green-300',
};

const MODEL_FETCH_MODES = [
  { value: 'auto_then_manual', label: '自动同步失败后允许手动添加' },
  { value: 'auto',             label: '仅自动同步 /models' },
  { value: 'manual',           label: '仅手动添加模型' },
];

function ApiConfigDialog({
  open, onOpenChange, config, onSaved, scope = 'all',
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  config?: ApiConfig; onSaved: () => void;
  scope?: 'all' | 'image' | 'video';
}) {
  const [form, setForm] = useState({ name: '', provider: '', base_url: '', api_key: '', api_type: 'openai_compatible' as ApiConfig['api_type'], enabled: true });
  const [vtcOpen, setVtcOpen] = useState(false);
  const [compatOpen, setCompatOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);  // OpenAI 兼容高级配置
  const [compat, setCompat] = useState({
    model_fetch_mode: 'auto_then_manual' as 'auto' | 'manual' | 'auto_then_manual',
    models_path: '/models',
    chat_completions_path: '/chat/completions',
    text_response_path: 'choices.0.message.content',
    images_generations_path: '/images/generations',
    image_response_path: 'data',
    request_timeout_seconds: 120,
  });
  // 音频接口配置（通用 TTS）
  const [audioCfg, setAudioCfg] = useState({
    audio_tts_path: '/v1/tts',
    audio_tts_method: 'POST',
    audio_tts_auth_type: 'bearer',
    audio_tts_model_header_name: '',
    audio_tts_model_id: '',
    audio_tts_response_type: 'binary_audio',
    audio_tts_request_template: '',
    audio_tts_error_path: 'error.message',
    tts_content_type: 'application/json',
    tts_accept: 'audio/mpeg',
    tts_timeout_seconds: 120,
    tts_headers_template: '',
    tts_query_template: '',
    // 响应字段路径
    audio_url_path: 'data.audio_url',
    audio_base64_path: 'data.audio',
    // 测试连接配置
    test_method: 'GET',
    test_path: '/v1/models',
    test_body_template: '',
    // ASR
    audio_asr_path: '/v1/asr',
    audio_asr_method: 'POST',
    audio_asr_text_path: 'text',
    audio_asr_duration_path: 'duration',
    audio_asr_segments_path: 'segments',
    audio_asr_error_path: 'message',
  });
  const [selectedPreset, setSelectedPreset] = useState('自定义');
  const [selectedCompatPreset, setSelectedCompatPreset] = useState('自定义');
  const [presetNote, setPresetNote] = useState('');
  const [vtc, setVtc] = useState({
    create_url_path: '/v1/videos/generations',
    task_id_path: 'id',
    fallback_task_id_path: 'task_id',
    poll_url_template: '{{base_url}}/v1/videos/tasks/{{task_id}}',
    poll_method: 'GET',
    status_path: 'status',
    progress_path: 'progress',
    success_status_values: 'completed,succeeded,success,done',
    running_status_values: 'queued,pending,in_progress,processing,running,submitted',
    failed_status_values: 'failed,fail,error',
    result_url_path: 'url',
    error_path: 'error.message',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [testDetail, setTestDetail] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({ name: config.name, provider: config.provider || '', base_url: config.base_url, api_key: '', api_type: config.api_type, enabled: config.enabled });
      setAudioOpen(config.api_type === 'audio_api');
      const v = config.video_task_config || {};
      setVtc({
        create_url_path:       String(v.create_url_path       || '/v1/videos/generations'),
        task_id_path:          String(v.task_id_path          || 'id'),
        fallback_task_id_path: String(v.fallback_task_id_path || 'task_id'),
        poll_url_template:     String(v.poll_url_template     || '{{base_url}}/v1/videos/tasks/{{task_id}}'),
        poll_method:           String(v.poll_method           || 'GET'),
        status_path:           String(v.status_path           || 'status'),
        progress_path:         String(v.progress_path         || 'progress'),
        success_status_values: Array.isArray(v.success_status_values) ? (v.success_status_values as string[]).join(',') : String(v.success_status_values || 'completed,succeeded,success,done'),
        running_status_values: Array.isArray(v.running_status_values) ? (v.running_status_values as string[]).join(',') : String(v.running_status_values || 'queued,pending,in_progress,processing,running,submitted'),
        failed_status_values:  Array.isArray(v.failed_status_values)  ? (v.failed_status_values  as string[]).join(',') : String(v.failed_status_values  || 'failed,fail,error'),
        result_url_path:       String(v.result_url_path       || 'url'),
        error_path:            String(v.error_path            || 'error.message'),
      });
      setCompat({
        model_fetch_mode:         (config.model_fetch_mode      || 'auto_then_manual') as 'auto' | 'manual' | 'auto_then_manual',
        models_path:              config.models_path            || '/models',
        chat_completions_path:    config.chat_completions_path  || '/chat/completions',
        text_response_path:       config.text_response_path     || 'choices.0.message.content',
        images_generations_path:  config.images_generations_path || '/images/generations',
        image_response_path:      config.image_response_path    || 'data',
        request_timeout_seconds:  config.request_timeout_seconds ?? 120,
      });
      setAudioCfg({
        audio_tts_path:              config.audio_tts_path              || '/v1/tts',
        audio_tts_method:            config.audio_tts_method            || 'POST',
        audio_tts_auth_type:         config.audio_tts_auth_type         || 'bearer',
        audio_tts_model_header_name: config.audio_tts_model_header_name || '',
        audio_tts_model_id:          config.audio_tts_model_id          || '',
        audio_tts_response_type:     config.audio_tts_response_type     || 'binary_audio',
        audio_tts_request_template:  (() => {
          const t = config.audio_tts_request_template;
          if (!t) return '';
          if (typeof t === 'string') return t;
          return JSON.stringify(t, null, 2);
        })(),
        audio_tts_error_path:        config.audio_tts_error_path        || 'error.message',
        tts_content_type:            config.tts_content_type            || 'application/json',
        tts_accept:                  config.tts_accept                  || 'audio/mpeg',
        tts_timeout_seconds:         config.tts_timeout_seconds         ?? 120,
        tts_headers_template:        config.tts_headers_template        || '',
        tts_query_template:          config.tts_query_template          || '',
        audio_url_path:              config.audio_url_path              || 'data.audio_url',
        audio_base64_path:           config.audio_base64_path           || 'data.audio',
        test_method:                 config.test_method                 || 'GET',
        test_path:                   config.test_path                   || '/v1/models',
        test_body_template:          config.test_body_template          || '',
        audio_asr_path:              config.audio_asr_path              || '/v1/asr',
        audio_asr_method:            config.audio_asr_method            || 'POST',
        audio_asr_text_path:         config.audio_asr_text_path         || 'text',
        audio_asr_duration_path:     config.audio_asr_duration_path     || 'duration',
        audio_asr_segments_path:     config.audio_asr_segments_path     || 'segments',
        audio_asr_error_path:        config.audio_asr_error_path        || 'message',
      });
      setSelectedPreset('自定义');
      // 按 base_url 反查预设，命中则回显，否则视为自定义
      const hit = COMPAT_PRESETS.find(p => p.base_url && p.base_url === config.base_url);
      setSelectedCompatPreset(hit ? hit.label : '自定义');
      setPresetNote(hit?.note ?? '');
    } else {
      setForm({ name: '', provider: '', base_url: '', api_key: '', api_type: 'openai_compatible', enabled: true });
      setSelectedCompatPreset('自定义');
      setPresetNote('');
      setAudioOpen(false);
      setVtc({ create_url_path: '/v1/videos/generations', task_id_path: 'id', fallback_task_id_path: 'task_id', poll_url_template: '{{base_url}}/v1/videos/tasks/{{task_id}}', poll_method: 'GET', status_path: 'status', progress_path: 'progress', success_status_values: 'completed,succeeded,success,done', running_status_values: 'queued,pending,in_progress,processing,running,submitted', failed_status_values: 'failed,fail,error', result_url_path: 'url', error_path: 'error.message' });
      setCompat({ model_fetch_mode: 'auto_then_manual', models_path: '/models', chat_completions_path: '/chat/completions', text_response_path: 'choices.0.message.content', images_generations_path: '/images/generations', image_response_path: 'data', request_timeout_seconds: 120 });
      setAudioCfg({ audio_tts_path: '/v1/tts', audio_tts_method: 'POST', audio_tts_auth_type: 'bearer', audio_tts_model_header_name: '', audio_tts_model_id: '', audio_tts_response_type: 'binary_audio', audio_tts_request_template: '', audio_tts_error_path: 'error.message', tts_content_type: 'application/json', tts_accept: 'audio/mpeg', tts_timeout_seconds: 120, tts_headers_template: '', tts_query_template: '', audio_url_path: 'data.audio_url', audio_base64_path: 'data.audio', test_method: 'GET', test_path: '/v1/models', test_body_template: '', audio_asr_path: '/v1/asr', audio_asr_method: 'POST', audio_asr_text_path: 'text', audio_asr_duration_path: 'duration', audio_asr_segments_path: 'segments', audio_asr_error_path: 'message' });
      setSelectedPreset('自定义');
    }
    setTestResult(null);
    setTestDetail('');
  }, [config, open]);

  async function handleTest() {
    if (!form.base_url) { toast.error('请先填写 Base URL'); return; }
    if (!form.api_key && !config?.masked_api_key) { toast.error('请先填写 API Key'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const body = config?.id && !form.api_key
        ? { apiConfigId: config.id, dryRun: true }
        : { base_url: form.base_url, api_key: form.api_key, dryRun: true };
      const { data, error } = await db.functions.invoke('sync-models', { body });
      if (error) {
        const msg = await error?.context?.text?.().catch(() => '') || error.message;
        setTestResult('fail'); setTestDetail(msg);
        toast.error(`连接测试失败：${msg}`);
      } else if (data?.error) {
        setTestResult('fail'); setTestDetail(data.error);
        toast.error(`连接失败：${data.error}`);
      } else {
        setTestResult('success'); setTestDetail(`成功获取 ${data?.models?.length ?? 0} 个模型`);
        toast.success(`连接成功！获取到 ${data?.models?.length ?? 0} 个模型`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      setTestResult('fail'); setTestDetail(msg);
      toast.error(`连接测试异常：${msg}`);
    } finally { setTesting(false); }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.base_url.trim()) { toast.error('请填写配置名称和 Base URL'); return; }
    if (!baseUrlValid) { toast.error('Base URL 格式不正确，请填写以 http:// 或 https:// 开头的地址'); return; }
    if (!config && !form.api_key.trim()) { toast.error('新增配置时必须填写 API Key'); return; }
    setSaving(true);
    try {
      const video_task_config = {
        create_url_path:       vtc.create_url_path.trim()       || '/v1/videos/generations',
        task_id_path:          vtc.task_id_path.trim()          || 'id',
        fallback_task_id_path: vtc.fallback_task_id_path.trim() || 'task_id',
        poll_url_template:     vtc.poll_url_template.trim()     || '{{base_url}}/v1/videos/tasks/{{task_id}}',
        poll_method:           (vtc.poll_method || 'GET') as 'GET' | 'POST',
        status_path:           vtc.status_path.trim()           || 'status',
        progress_path:         vtc.progress_path.trim()         || 'progress',
        success_status_values: vtc.success_status_values.split(',').map(s => s.trim()).filter(Boolean),
        running_status_values: vtc.running_status_values.split(',').map(s => s.trim()).filter(Boolean),
        failed_status_values:  vtc.failed_status_values.split(',').map(s => s.trim()).filter(Boolean),
        result_url_path:       vtc.result_url_path.trim()       || 'url',
        error_path:            vtc.error_path.trim()            || 'error.message',
      };
      const payload = {
        ...form,
        name: form.name.trim(),
        provider: form.provider.trim(),
        base_url: normalizedBaseUrl,
        video_task_config,
        model_fetch_mode:         compat.model_fetch_mode,
        models_path:              compat.models_path.trim()             || '/models',
        chat_completions_path:    compat.chat_completions_path.trim()   || '/chat/completions',
        text_response_path:       compat.text_response_path.trim()      || 'choices.0.message.content',
        images_generations_path:  compat.images_generations_path.trim() || '/images/generations',
        image_response_path:      compat.image_response_path.trim()     || 'data',
        request_timeout_seconds:  Math.min(Math.max(Number(compat.request_timeout_seconds) || 120, 1), 600),
        // TTS 通用字段
        audio_tts_path:              audioCfg.audio_tts_path.trim()              || '/v1/tts',
        audio_tts_method:            audioCfg.audio_tts_method                   || 'POST',
        audio_tts_auth_type:         audioCfg.audio_tts_auth_type                || 'bearer',
        audio_tts_model_header_name: audioCfg.audio_tts_model_header_name.trim() || '',
        audio_tts_model_id:          audioCfg.audio_tts_model_id.trim()          || '',
        audio_tts_response_type:     audioCfg.audio_tts_response_type            || 'binary_audio',
        audio_tts_request_template:  (() => {
          const t = audioCfg.audio_tts_request_template.trim();
          if (!t) return undefined;
          try { return JSON.parse(t); } catch { return t; }
        })(),
        audio_tts_error_path:        audioCfg.audio_tts_error_path.trim()        || 'error.message',
        tts_content_type:            audioCfg.tts_content_type.trim()            || 'application/json',
        tts_accept:                  audioCfg.tts_accept.trim()                  || 'audio/mpeg',
        tts_timeout_seconds:         Number(audioCfg.tts_timeout_seconds)        || 120,
        tts_headers_template:        audioCfg.tts_headers_template.trim()        || '',
        tts_query_template:          audioCfg.tts_query_template.trim()          || '',
        audio_url_path:              audioCfg.audio_url_path.trim()              || '',
        audio_base64_path:           audioCfg.audio_base64_path.trim()           || '',
        test_method:                 audioCfg.test_method                        || 'GET',
        test_path:                   audioCfg.test_path.trim()                   || '/v1/models',
        test_body_template:          audioCfg.test_body_template.trim()          || '',
        // ASR
        audio_asr_path:              audioCfg.audio_asr_path.trim()              || '/v1/asr',
        audio_asr_method:            audioCfg.audio_asr_method                   || 'POST',
        audio_asr_text_path:         audioCfg.audio_asr_text_path.trim()         || 'text',
        audio_asr_duration_path:     audioCfg.audio_asr_duration_path.trim()     || 'duration',
        audio_asr_segments_path:     audioCfg.audio_asr_segments_path.trim()     || 'segments',
        audio_asr_error_path:        audioCfg.audio_asr_error_path.trim()        || 'message',
      };
      if (config) {
        await updateApiConfig(config.id, payload);
        toast.success('配置已更新');
      } else {
        await createApiConfig(payload as Parameters<typeof createApiConfig>[0]);
        toast.success('配置已创建');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally { setSaving(false); }
  }

  const isOpenAICompat = form.api_type === 'openai_compatible';
  const isImageScope = scope === 'image';
  const isVideoScope = scope === 'video';
  const isGeneralScope = scope === 'all';
  const dialogTitle = config ? `编辑${isImageScope ? '图片' : isVideoScope ? '视频' : ''} API 配置` : `新增${isImageScope ? '图片' : isVideoScope ? '视频' : ''} API 配置`;
  const availableApiTypes = API_TYPES.filter(t => isGeneralScope || t.value !== 'audio_api');
  const availableCompatPresets = COMPAT_PRESETS.filter(p => p.scopes.includes(scope));
  const normalizedBaseUrl = form.base_url.trim().replace(/\/+$/, '');
  const baseUrlValid = !normalizedBaseUrl || /^https?:\/\/[^\s]+$/i.test(normalizedBaseUrl);
  const hasStoredKey = !!config?.masked_api_key;
  const canTest = !!normalizedBaseUrl && baseUrlValid && (!!form.api_key.trim() || hasStoredKey) && !testing && !saving;
  const canSave = !!form.name.trim() && !!normalizedBaseUrl && baseUrlValid && (!!config || !!form.api_key.trim()) && !saving && !testing;

  // Chat 请求 URL 预览：与后端 openai-compat.endpointCandidates 的规则保持一致
  const chatUrlPreview = (() => {
    const base = form.base_url.replace(/\/+$/, '');
    const path = (compat.chat_completions_path || '/chat/completions').replace(/^\/+/, '');
    if (!base) return '';
    const baseHasVer = /\/v\d+$/.test(base);
    const pathHasVer = /^v\d+\//.test(path);
    return baseHasVer || pathHasVer ? `${base}/${path}` : `${base}/v1/${path}`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {isImageScope ? '当前为图片 API 配置：只展示模型同步、图片生成路径与图片响应解析参数。' : isVideoScope ? '当前为视频 API 配置：重点展示模型同步与异步视频任务链路参数。' : '当前为通用 API 配置：可配置文本、音频及完整兼容参数。'}
          </div>
          <div><Label>配置名称 *</Label><Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：OpenAI 官方" /></div>
          <div>
            <Label>服务商预设（可选）</Label>
            <Select value={selectedCompatPreset} onValueChange={v => {
              setSelectedCompatPreset(v);
              const p = COMPAT_PRESETS.find(x => x.label === v);
              if (!p || p.label === '自定义') { setPresetNote(''); return; }
              setForm(f => ({ ...f, provider: p.provider || f.provider, base_url: p.base_url }));
              setCompat(c => ({
                ...c,
                models_path:              p.models_path,
                chat_completions_path:    p.chat_completions_path,
                text_response_path:       p.text_response_path,
                images_generations_path:  p.images_generations_path,
                image_response_path:      p.image_response_path,
              }));
              setPresetNote(p.note ?? '');
            }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{availableCompatPresets.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            {presetNote && <p className="text-xs text-muted-foreground mt-1">{presetNote}</p>}
          </div>
          <div><Label>API 提供商</Label><Input className="mt-1" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="如：OpenAI" /></div>
          <div><Label>接口类型</Label>
            <Select value={form.api_type} onValueChange={v => {
              setForm(f => ({ ...f, api_type: v as ApiConfig['api_type'] }));
              if (v === 'audio_api') setAudioOpen(true);
            }}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{availableApiTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Base URL *</Label>
            <Input className={`mt-1 ${!baseUrlValid ? 'border-destructive' : ''}`} value={form.base_url} onChange={e => { setForm(f => ({ ...f, base_url: e.target.value })); setTestResult(null); }} placeholder="https://api.openai.com/v1" />
            {!baseUrlValid && <p className="text-xs text-destructive mt-1">请输入完整的 http:// 或 https:// 地址</p>}
            {baseUrlValid && normalizedBaseUrl && normalizedBaseUrl !== form.base_url.trim() && <p className="text-xs text-muted-foreground mt-1">保存时会自动移除末尾多余的 /</p>}
          </div>
          <div>
            <Label>API Key {config ? '' : '*'}</Label>
            {config?.masked_api_key && (
              <p className="text-xs text-muted-foreground mt-1 mb-1.5 flex items-center gap-1">
                <span>当前密钥：</span>
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{config.masked_api_key}</code>
                <span className="text-muted-foreground/60">（留空不修改）</span>
              </p>
            )}
            <div className="flex gap-2 mt-1">
              <Input className="flex-1" type={showApiKey ? 'text' : 'password'} value={form.api_key}
                onChange={e => { setForm(f => ({ ...f, api_key: e.target.value })); setTestResult(null); }}
                placeholder={config ? '输入新密钥以覆盖，留空保持不变' : 'sk-...'}
                autoComplete="new-password" />
              <Button type="button" variant="outline" size="sm" onClick={() => setShowApiKey(v => !v)}>{showApiKey ? '隐藏' : '显示'}</Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div><p className="text-sm font-medium">连接检查</p><p className="text-xs text-muted-foreground">先测试再保存，可提前发现地址、密钥或模型列表接口问题。</p></div>
              <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={!canTest}>{testing ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />测试中</> : '测试连接'}</Button>
            </div>
            {testResult && <div className={`text-xs rounded-md px-2.5 py-2 ${testResult === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'}`}><span className="font-medium">{testResult === 'success' ? '连接成功' : '连接失败'}</span>{testDetail && <span className="ml-2 break-all">{testDetail}</span>}</div>}
          </div>

          {/* OpenAI 兼容高级配置（仅 openai_compatible 时显示） */}
          {isOpenAICompat && (
            <Collapsible open={compatOpen} onOpenChange={setCompatOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground px-0 hover:text-foreground">
                  <span className="text-sm font-medium">OpenAI 兼容请求配置</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${compatOpen ? '' : '-rotate-90'}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2 pb-2 border border-border rounded-lg px-3">
                <p className="text-xs text-muted-foreground pt-1">
                  配置 Chat Completions 路径与模型获取方式，无需硬编码供应商。
                </p>
                <div>
                  <Label className="text-xs">模型获取方式</Label>
                  <Select value={compat.model_fetch_mode} onValueChange={v => setCompat(c => ({ ...c, model_fetch_mode: v as typeof compat.model_fetch_mode }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{MODEL_FETCH_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">模型列表路径</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={compat.models_path}
                      onChange={e => setCompat(c => ({ ...c, models_path: e.target.value }))}
                      placeholder="/models" />
                    <p className="text-xs text-muted-foreground mt-0.5">直接拼接在 Base URL 后</p>
                  </div>
                  {isGeneralScope && <div>
                    <Label className="text-xs">Chat Completions 路径</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={compat.chat_completions_path}
                      onChange={e => setCompat(c => ({ ...c, chat_completions_path: e.target.value }))}
                      placeholder="/chat/completions" />
                    <p className="text-xs text-muted-foreground mt-0.5">直接拼接在 Base URL 后</p>
                  </div>}
                </div>
                {isGeneralScope && chatUrlPreview && (
                  <div className="bg-muted/60 rounded-md px-3 py-2 text-xs">
                    <p className="text-muted-foreground font-medium mb-0.5">实际 Chat 请求地址预览</p>
                    <p className="font-mono break-all text-foreground">{chatUrlPreview}</p>
                    <p className="text-muted-foreground/70 mt-1">
                      Base URL 与路径均未含版本段（/vN）时，会先请求带 /v1 的地址，返回 404 再自动回退不带 /v1 的地址。
                    </p>
                  </div>
                )}
                {isGeneralScope && <div>
                  <Label className="text-xs">文本响应字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={compat.text_response_path}
                    onChange={e => setCompat(c => ({ ...c, text_response_path: e.target.value }))}
                    placeholder="choices.0.message.content" />
                  <p className="text-xs text-muted-foreground mt-0.5">点分路径，从响应 JSON 中提取文本内容</p>
                </div>}
                {!isVideoScope && <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">图片生成路径</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={compat.images_generations_path}
                      onChange={e => setCompat(c => ({ ...c, images_generations_path: e.target.value }))}
                      placeholder="/images/generations" />
                    <p className="text-xs text-muted-foreground mt-0.5">拼接在 Base URL 后</p>
                  </div>
                  <div>
                    <Label className="text-xs">图片响应列表路径</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={compat.image_response_path}
                      onChange={e => setCompat(c => ({ ...c, image_response_path: e.target.value }))}
                      placeholder="data" />
                    <p className="text-xs text-muted-foreground mt-0.5">取不到时自动按 data / images / output.images 兜底</p>
                  </div>
                </div>}
                <div>
                  <Label className="text-xs">请求超时（秒）</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" type="number" min={1} max={600}
                    value={compat.request_timeout_seconds}
                    onChange={e => setCompat(c => ({ ...c, request_timeout_seconds: Number(e.target.value) }))}
                    placeholder="120" />
                  <p className="text-xs text-muted-foreground mt-0.5">范围 1–600，默认 120。网关响应慢时可适当调大</p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* 异步视频接口配置（可折叠） */}
          {!isImageScope && <Collapsible open={vtcOpen} onOpenChange={setVtcOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground px-0 hover:text-foreground">
                <span className="text-sm font-medium">异步视频接口配置</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${vtcOpen ? '' : '-rotate-90'}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2 pb-1 border border-border rounded-lg px-3">
              <p className="text-xs text-muted-foreground pt-1">
                配置驱动的通用异步视频任务链路。模板变量：<code className="bg-muted px-1 rounded">{"{{task_id}}"}</code>、<code className="bg-muted px-1 rounded">{"{{base_url}}"}</code>
              </p>
              {form.base_url && (
                <div className="bg-muted/60 rounded-md px-3 py-2 text-xs space-y-1">
                  <p className="text-muted-foreground font-medium">视频创建任务 URL 预览</p>
                  <p className="font-mono break-all text-foreground">
                    {(() => {
                      const base = form.base_url.replace(/\/$/, '');
                      const path = vtc.create_url_path || '/v1/videos/generations';
                      if (/^https?:\/\//.test(path)) return path;
                      return `${base}/${path.replace(/^\//, '')}`;
                    })()}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">创建任务路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.create_url_path}
                    onChange={e => setVtc(v => ({ ...v, create_url_path: e.target.value }))}
                    placeholder="/v1/videos/generations" />
                </div>
                <div>
                  <Label className="text-xs">任务 ID 字段</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.task_id_path}
                    onChange={e => setVtc(v => ({ ...v, task_id_path: e.target.value }))}
                    placeholder="id 或 video_id" />
                </div>
                <div>
                  <Label className="text-xs">备用任务 ID 字段</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.fallback_task_id_path}
                    onChange={e => setVtc(v => ({ ...v, fallback_task_id_path: e.target.value }))}
                    placeholder="task_id" />
                </div>
                <div>
                  <Label className="text-xs">轮询方法</Label>
                  <Select value={vtc.poll_method} onValueChange={v => setVtc(c => ({ ...c, poll_method: v }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">轮询 URL 模板</Label>
                <Input className="mt-1 text-xs h-8 px-2" value={vtc.poll_url_template}
                  onChange={e => setVtc(v => ({ ...v, poll_url_template: e.target.value }))}
                  placeholder="{{base_url}}/v1/videos/tasks/{{task_id}}" />
                <p className="text-xs text-muted-foreground mt-1">
                  Agnes 示例：<code className="bg-muted px-1 rounded text-xs">{"{{base_url_root}}/agnesapi?video_id={{task_id}}"}</code>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">状态字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.status_path}
                    onChange={e => setVtc(v => ({ ...v, status_path: e.target.value }))}
                    placeholder="status" />
                </div>
                <div>
                  <Label className="text-xs">进度字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.progress_path}
                    onChange={e => setVtc(v => ({ ...v, progress_path: e.target.value }))}
                    placeholder="progress" />
                </div>
                <div>
                  <Label className="text-xs">结果 URL 字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.result_url_path}
                    onChange={e => setVtc(v => ({ ...v, result_url_path: e.target.value }))}
                    placeholder="url" />
                </div>
                <div>
                  <Label className="text-xs">错误信息字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2" value={vtc.error_path}
                    onChange={e => setVtc(v => ({ ...v, error_path: e.target.value }))}
                    placeholder="error.message" />
                </div>
              </div>
              <div>
                <Label className="text-xs">成功状态值（逗号分隔）</Label>
                <Input className="mt-1 text-xs h-8 px-2" value={vtc.success_status_values}
                  onChange={e => setVtc(v => ({ ...v, success_status_values: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">进行中状态值（逗号分隔）</Label>
                <Input className="mt-1 text-xs h-8 px-2" value={vtc.running_status_values}
                  onChange={e => setVtc(v => ({ ...v, running_status_values: e.target.value }))} />
              </div>
              <div className="pb-1">
                <Label className="text-xs">失败状态值（逗号分隔）</Label>
                <Input className="mt-1 text-xs h-8 px-2" value={vtc.failed_status_values}
                  onChange={e => setVtc(v => ({ ...v, failed_status_values: e.target.value }))} />
              </div>
            </CollapsibleContent>
          </Collapsible>}

          {/* 音频接口配置（通用 TTS / ASR） */}
          {isGeneralScope && <Collapsible open={audioOpen} onOpenChange={setAudioOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground px-0 hover:text-foreground">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  通用 TTS 接口配置
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${audioOpen ? '' : '-rotate-90'}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2 pb-3 border border-border rounded-lg px-3">
              <p className="text-xs text-muted-foreground pt-1">
                支持任意 TTS 服务（OpenAI、MiniMax、ElevenLabs、火山、阿里云、Fish Audio…），通过配置驱动适配不同接口格式。
              </p>

              {/* 供应商预设 */}
              <div>
                <Label className="text-xs flex items-center gap-1"><Wand2 className="w-3 h-3" />供应商预设（快速填充）</Label>
                <Select value={selectedPreset} onValueChange={v => {
                  setSelectedPreset(v);
                  const preset = TTS_PRESETS.find(p => p.label === v);
                  if (!preset) return;
                  setAudioCfg(c => ({
                    ...c,
                    audio_tts_path:             preset.audio_tts_path,
                    audio_tts_method:           preset.audio_tts_method,
                    audio_tts_auth_type:        preset.audio_tts_auth_type,
                    audio_tts_response_type:    preset.audio_tts_response_type,
                    audio_tts_request_template: preset.audio_tts_request_template,
                    audio_tts_error_path:       preset.audio_tts_error_path,
                    tts_content_type:           preset.tts_content_type,
                    tts_accept:                 preset.tts_accept,
                    tts_timeout_seconds:        preset.tts_timeout_seconds,
                    audio_url_path:             preset.audio_url_path,
                    audio_base64_path:          preset.audio_base64_path,
                    test_method:                preset.test_method,
                    test_path:                  preset.test_path,
                  }));
                  if (preset.base_url) {
                    setForm(f => ({ ...f, base_url: preset.base_url, provider: preset.provider }));
                  }
                }}>
                  <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TTS_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(() => {
                  const preset = TTS_PRESETS.find(p => p.label === selectedPreset);
                  return preset?.note ? (
                    <p className="text-xs text-yellow-500/80 mt-1 leading-relaxed">{preset.note}</p>
                  ) : null;
                })()}
              </div>

              {/* 请求基础配置 */}
              <p className="text-xs font-medium text-foreground pt-1">请求配置</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">TTS 路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_tts_path}
                    onChange={e => setAudioCfg(c => ({ ...c, audio_tts_path: e.target.value }))}
                    placeholder="/v1/tts" />
                </div>
                <div>
                  <Label className="text-xs">请求方法</Label>
                  <Select value={audioCfg.audio_tts_method} onValueChange={v => setAudioCfg(c => ({ ...c, audio_tts_method: v }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="GET">GET</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">鉴权方式</Label>
                  <Select value={audioCfg.audio_tts_auth_type} onValueChange={v => setAudioCfg(c => ({ ...c, audio_tts_auth_type: v }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bearer">Bearer Token</SelectItem>
                      <SelectItem value="header_key">自定义 Header Key</SelectItem>
                      <SelectItem value="query_key">Query 参数</SelectItem>
                      <SelectItem value="basic">Basic Auth</SelectItem>
                      <SelectItem value="none">无鉴权</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(audioCfg.audio_tts_auth_type === 'header_key' || audioCfg.audio_tts_auth_type === 'basic') && (
                  <div>
                    <Label className="text-xs">鉴权 Header 名</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_tts_model_header_name}
                      onChange={e => setAudioCfg(c => ({ ...c, audio_tts_model_header_name: e.target.value }))}
                      placeholder="xi-api-key" />
                  </div>
                )}
                {audioCfg.audio_tts_auth_type === 'query_key' && (
                  <div>
                    <Label className="text-xs">Query 参数名</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_tts_model_header_name}
                      onChange={e => setAudioCfg(c => ({ ...c, audio_tts_model_header_name: e.target.value }))}
                      placeholder="api_key" />
                  </div>
                )}
                <div>
                  <Label className="text-xs">响应类型</Label>
                  <Select value={audioCfg.audio_tts_response_type} onValueChange={v => setAudioCfg(c => ({ ...c, audio_tts_response_type: v }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="binary_audio">二进制音频流</SelectItem>
                      <SelectItem value="json_audio_url">JSON → 音频 URL</SelectItem>
                      <SelectItem value="json_audio_base64">JSON → Base64 音频</SelectItem>
                      <SelectItem value="json_task_id">JSON → 异步任务 ID（预留）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">超时秒数</Label>
                  <Input className="mt-1 text-xs h-8 px-2" type="number" min={10} max={600}
                    value={audioCfg.tts_timeout_seconds}
                    onChange={e => setAudioCfg(c => ({ ...c, tts_timeout_seconds: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">Content-Type</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.tts_content_type}
                    onChange={e => setAudioCfg(c => ({ ...c, tts_content_type: e.target.value }))}
                    placeholder="application/json" />
                </div>
                <div>
                  <Label className="text-xs">Accept</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.tts_accept}
                    onChange={e => setAudioCfg(c => ({ ...c, tts_accept: e.target.value }))}
                    placeholder="audio/mpeg" />
                </div>
                <div>
                  <Label className="text-xs">指定模型 ID（可选）</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_tts_model_id}
                    onChange={e => setAudioCfg(c => ({ ...c, audio_tts_model_id: e.target.value }))}
                    placeholder="留空则用模型库 ID" />
                </div>
              </div>

              {/* 请求体模板 */}
              <div>
                <Label className="text-xs">请求体 JSON 模板</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  支持占位符：<code className="bg-muted px-1 rounded">{'{{text}}'}</code>
                  <code className="bg-muted px-1 rounded ml-1">{'{{model_id}}'}</code>
                  <code className="bg-muted px-1 rounded ml-1">{'{{voice_id}}'}</code>
                  <code className="bg-muted px-1 rounded ml-1">{'{{format}}'}</code>
                  <code className="bg-muted px-1 rounded ml-1">{'{{speed}}'}</code>
                  <code className="bg-muted px-1 rounded ml-1">{'{{sample_rate}}'}</code>
                  等
                </p>
                <Textarea
                  className="mt-1 text-xs font-mono resize-none"
                  rows={6}
                  value={audioCfg.audio_tts_request_template}
                  onChange={e => setAudioCfg(c => ({ ...c, audio_tts_request_template: e.target.value }))}
                  placeholder='{"model": "{{model_id}}", "text": "{{text}}", "voice": "{{voice_id}}"}'
                />
              </div>

              {/* 额外 Headers / Query */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">额外 Headers 模板（JSON）</Label>
                  <Textarea className="mt-1 text-xs font-mono resize-none" rows={2}
                    value={audioCfg.tts_headers_template}
                    onChange={e => setAudioCfg(c => ({ ...c, tts_headers_template: e.target.value }))}
                    placeholder='{"X-App-Id": "{{project_id}}"}' />
                </div>
                <div>
                  <Label className="text-xs">额外 Query 模板（JSON）</Label>
                  <Textarea className="mt-1 text-xs font-mono resize-none" rows={2}
                    value={audioCfg.tts_query_template}
                    onChange={e => setAudioCfg(c => ({ ...c, tts_query_template: e.target.value }))}
                    placeholder='{"appid": "xxx"}' />
                </div>
              </div>

              {/* 响应字段路径 */}
              <p className="text-xs font-medium text-foreground pt-1">响应字段路径</p>
              <div className="grid grid-cols-2 gap-2">
                {audioCfg.audio_tts_response_type === 'json_audio_url' && (
                  <div>
                    <Label className="text-xs">音频 URL 字段路径</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_url_path}
                      onChange={e => setAudioCfg(c => ({ ...c, audio_url_path: e.target.value }))}
                      placeholder="data.audio_url" />
                  </div>
                )}
                {audioCfg.audio_tts_response_type === 'json_audio_base64' && (
                  <div>
                    <Label className="text-xs">Base64 音频字段路径</Label>
                    <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_base64_path}
                      onChange={e => setAudioCfg(c => ({ ...c, audio_base64_path: e.target.value }))}
                      placeholder="data.audio" />
                  </div>
                )}
                <div>
                  <Label className="text-xs">错误信息字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_tts_error_path}
                    onChange={e => setAudioCfg(c => ({ ...c, audio_tts_error_path: e.target.value }))}
                    placeholder="error.message" />
                </div>
              </div>

              {/* 测试连接配置 */}
              <p className="text-xs font-medium text-foreground pt-1">连通性测试配置</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">测试方法</Label>
                  <Select value={audioCfg.test_method} onValueChange={v => setAudioCfg(c => ({ ...c, test_method: v }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">测试路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.test_path}
                    onChange={e => setAudioCfg(c => ({ ...c, test_path: e.target.value }))}
                    placeholder="/v1/models" />
                </div>
              </div>

              {/* ASR 配置 */}
              <p className="text-xs font-medium text-foreground pt-1">ASR 配置（可选）</p>
              <div className="grid grid-cols-2 gap-2 pb-1">
                <div>
                  <Label className="text-xs">ASR 路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_asr_path}
                    onChange={e => setAudioCfg(c => ({ ...c, audio_asr_path: e.target.value }))}
                    placeholder="/v1/asr" />
                </div>
                <div>
                  <Label className="text-xs">请求方法</Label>
                  <Select value={audioCfg.audio_asr_method} onValueChange={v => setAudioCfg(c => ({ ...c, audio_asr_method: v }))}>
                    <SelectTrigger className="mt-1 text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="GET">GET</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">文本字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_asr_text_path}
                    onChange={e => setAudioCfg(c => ({ ...c, audio_asr_text_path: e.target.value }))}
                    placeholder="text" />
                </div>
                <div>
                  <Label className="text-xs">时长字段路径</Label>
                  <Input className="mt-1 text-xs h-8 px-2 font-mono" value={audioCfg.audio_asr_duration_path}
                    onChange={e => setAudioCfg(c => ({ ...c, audio_asr_duration_path: e.target.value }))}
                    placeholder="duration" />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>}

          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))} id="cfg-enabled" />
            <Label htmlFor="cfg-enabled">启用此配置</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? '保存中…' : '保存配置'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 手动添加模型弹窗 */
function ManualModelDialog({
  open, onOpenChange, config, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  config: ApiConfig; onSaved: () => void;
}) {
  const defaultCaps: ModelCapability[] = ['text_generation'];
  const [modelId, setModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [caps, setCaps] = useState<ModelCapability[]>(defaultCaps);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setModelId(''); setDisplayName(''); setCaps(defaultCaps); setEnabled(true); }
  }, [open]);

  function toggleCap(cap: ModelCapability) {
    setCaps(prev => prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]);
  }

  async function handleSave() {
    if (!modelId.trim()) { toast.error('请填写模型 ID'); return; }
    setSaving(true);
    try {
      await createManualModel({
        api_config_id: config.id,
        model_id:      modelId.trim(),
        display_name:  displayName.trim() || modelId.trim(),
        capabilities:  caps,
        enabled,
        provider:      config.provider || '',
        base_url:      config.base_url,
      });
      toast.success(`模型 ${modelId.trim()} 已添加`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(`添加失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>手动添加模型</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            为「{config.name}」手动录入模型 ID，适用于 /models 不可用的 API。
          </p>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label>模型 ID *</Label>
            <Input className="mt-1 font-mono" value={modelId}
              onChange={e => setModelId(e.target.value)}
              placeholder="如：glm-5.2、gpt-4o、claude-sonnet-4-5" />
          </div>
          <div>
            <Label>显示名称</Label>
            <Input className="mt-1" value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="留空则使用模型 ID" />
          </div>
          <div>
            <Label className="mb-2 block">能力标签</Label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(CAPABILITY_LABELS) as [ModelCapability, string][]).map(([cap, label]) => {
                const active = caps.includes(cap);
                return (
                  <button key={cap} type="button" onClick={() => toggleCap(cap)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      active
                        ? capabilityColors[cap] + ' border-transparent font-medium'
                        : 'text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                    }`}>
                    {label}
                  </button>
                );
              })}
            </div>
            {caps.length === 0 && <p className="text-xs text-yellow-500 mt-1">请至少选择一个能力标签</p>}
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="manual-model-enabled" />
            <Label htmlFor="manual-model-enabled">立即启用</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving || caps.length === 0}>
            {saving ? '添加中…' : '添加模型'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModelConfigPage() {
  const location = useLocation();
  const modelScope = location.pathname.endsWith('/image') ? 'image' : location.pathname.endsWith('/video') ? 'video' : 'all';
  const pageTitle = modelScope === 'image' ? '图片模型配置' : modelScope === 'video' ? '视频模型配置' : '通用模型配置';
  const pageDescription = modelScope === 'image'
    ? '管理图片生成与图片编辑模型。视频模型不会混在当前列表中。'
    : modelScope === 'video'
      ? '管理文生视频、图生视频、首尾帧、多图参考等视频模型。图片模型不会混在当前列表中。'
      : '管理文本、音频及跨模态 API；图片和视频模型已有独立入口。';
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [models, setModels] = useState<ModelCatalog[]>([]);
  const [bindings, setBindings] = useState<FunctionModelBinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [syncSuccess, setSyncSuccess] = useState<Record<string, { count: number; scopedCount: number; otherCount: number; at: number; diagnostics?: Array<{ id: string; source: string; presentFields: string[]; capabilities: string[] }> }>>({});
  const [configSearch, setConfigSearch] = useState('');
  const [configStatus, setConfigStatus] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<ApiConfig | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedConfigs, setExpandedConfigs] = useState<Set<string>>(new Set());
  const [editingDisplayName, setEditingDisplayName] = useState<string | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState('');
  // 手动添加模型弹窗：记录当前操作的 API 配置
  const [manualModelConfig, setManualModelConfig] = useState<ApiConfig | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgs, mdls, bnds] = await Promise.all([getApiConfigs(), getModelCatalog(), getFunctionModelBindings()]);
      setApiConfigs(cfgs);
      setModels(mdls);
      setBindings(bnds);
    } catch { toast.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(configId: string) {
    setExpandedConfigs(prev => {
      const next = new Set(prev);
      if (next.has(configId)) next.delete(configId);
      else next.add(configId);
      return next;
    });
  }

  async function handleSync(config: ApiConfig) {
    setSyncingId(config.id);
    setSyncErrors(prev => ({ ...prev, [config.id]: '' }));
    try {
      const { data, error } = await db.functions.invoke('sync-models', {
        body: { apiConfigId: config.id, dryRun: false },
      });

      if (error) {
        const msg = await error?.context?.text?.().catch(() => '') || error.message;
        setSyncErrors(prev => ({ ...prev, [config.id]: msg || '请求失败，请检查登录状态' }));
        toast.error(`同步失败：${msg}`);
        return;
      }

      if (data?.error) {
        setSyncErrors(prev => ({ ...prev, [config.id]: data.error }));
        toast.error(`同步失败：${data.error}`);
        return;
      }

      const rawModels = data?.models as Array<{ id: string; owned_by?: string; created?: number; object?: string; capabilities?: unknown; modalities?: unknown; input_modalities?: unknown; output_modalities?: unknown; input?: unknown; output?: unknown; input_types?: unknown; output_types?: unknown }> || [];
      const diagnostics = (data?.diagnostics || []) as Array<{ id: string; source: string; presentFields: string[]; capabilities: string[] }>;
      await upsertModels(config.id, rawModels, config);

      if (data?.static) {
        // audio_api 类型：写入静态 Fish Audio TTS 引擎模型
        toast.success(`已写入 ${rawModels.length} 个 Fish Audio TTS 模型。声音模型请在「音频制作 → 声音库」中同步。`);
      } else {
        toast.success(`同步了 ${rawModels.length} 个模型`);
      }

      // 只重新加载该 config 的模型（增量更新），避免全量查询因 raw 字段过大而失败
      const freshModels = await getModelCatalog(config.id);
      setModels(prev => {
        const others = prev.filter(m => m.api_config_id !== config.id);
        return [...others, ...freshModels];
      });
      setExpandedConfigs(prev => new Set([...prev, config.id]));
      const scopedCount = modelScope === 'all' ? freshModels.length : freshModels.filter(isModelInScope).length;
      setSyncSuccess(prev => ({
        ...prev,
        [config.id]: {
          count: rawModels.length,
          scopedCount,
          otherCount: Math.max(0, freshModels.length - scopedCount),
          at: Date.now(),
          diagnostics,
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      setSyncErrors(prev => ({ ...prev, [config.id]: msg }));
      toast.error(`同步失败：${msg}`);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleToggleConfig(config: ApiConfig) {
    try {
      await updateApiConfig(config.id, { enabled: !config.enabled });
      setApiConfigs(prev => prev.map(item => item.id === config.id ? { ...item, enabled: !item.enabled } : item));
      toast.success(config.enabled ? 'API 配置已停用' : 'API 配置已启用');
    } catch (e) {
      toast.error(`更新失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  async function handleDeleteConfig() {
    if (!deleteId) return;
    try {
      await deleteApiConfig(deleteId);
      toast.success('已删除');
      await load();
    } catch { toast.error('删除失败'); }
    finally { setDeleteId(null); }
  }

  async function handleToggleModel(model: ModelCatalog) {
    await updateModelCatalog(model.id, { enabled: !model.enabled });
    setModels(prev => prev.map(m => m.id === model.id ? { ...m, enabled: !m.enabled } : m));
  }

  async function handleCapabilityToggle(model: ModelCatalog, cap: ModelCapability) {
    // ✅ 正确逻辑：以当前生效能力（capabilities）为基础进行增删
    // 禁止：以 user_confirmed_capabilities 为基（初始为 []，会清空其他能力）
    // 禁止：与 auto_detected_capabilities 做并集（会导致 auto 能力无法取消）
    const current = model.capabilities;
    const updated = current.includes(cap)
      ? current.filter(c => c !== cap)
      : [...current, cap];

    // capabilities 和 user_confirmed_capabilities 保持同步，不碰 auto_detected_capabilities
    await updateModelCatalog(model.id, {
      user_confirmed_capabilities: updated,
      capabilities: updated,
    });

    // 更新前端状态
    setModels(prev =>
      prev.map(m =>
        m.id === model.id
          ? { ...m, user_confirmed_capabilities: updated, capabilities: updated }
          : m,
      ),
    );

    // 清理因能力变更而失效的功能绑定（如：取消文本生成后，自动解除分镜生成绑定）
    const removedBindings = await cleanInvalidBindings(model.id, updated);
    if (removedBindings.length > 0) {
      const names = removedBindings
        .map(k => FUNCTION_KEY_LABELS[k as keyof typeof FUNCTION_KEY_LABELS] || k)
        .join('、');
      toast.warning(`该模型已不具备所需能力，已自动解除以下功能的绑定：${names}，请重新选择模型。`);
      // 刷新绑定列表
      const bnds = await getFunctionModelBindings();
      setBindings(bnds);
    }
  }

  async function handleRestoreAutoDetected(model: ModelCatalog) {
    // 将 capabilities 和 user_confirmed_capabilities 都重置为自动识别结果
    const autoCaps = model.auto_detected_capabilities;
    await updateModelCatalog(model.id, {
      user_confirmed_capabilities: [],
      capabilities: autoCaps,
    });
    setModels(prev =>
      prev.map(m =>
        m.id === model.id
          ? { ...m, user_confirmed_capabilities: [], capabilities: autoCaps }
          : m,
      ),
    );
    toast.success(`已恢复「${model.display_name || model.model_id}」的自动识别能力`);

    // 清理因恢复而可能失效的旧绑定
    const removedBindings = await cleanInvalidBindings(model.id, autoCaps);
    if (removedBindings.length > 0) {
      const names = removedBindings
        .map(k => FUNCTION_KEY_LABELS[k as keyof typeof FUNCTION_KEY_LABELS] || k)
        .join('、');
      toast.warning(`恢复后以下绑定已失效并自动解除：${names}`);
      const bnds = await getFunctionModelBindings();
      setBindings(bnds);
    }
  }

  function startEditDisplayName(model: ModelCatalog) {
    setEditingDisplayName(model.id);
    setDisplayNameInput(model.display_name || model.model_id);
  }

  async function saveDisplayName(model: ModelCatalog) {
    const name = displayNameInput.trim();
    if (!name) { setEditingDisplayName(null); return; }
    await updateModelCatalog(model.id, { display_name: name });
    setModels(prev => prev.map(m => m.id === model.id ? { ...m, display_name: name } : m));
    setEditingDisplayName(null);
    toast.success('展示名已更新');
  }

  async function handleBindingChange(functionKey: string, modelId: string) {
    const model = models.find(m => m.id === modelId);
    await updateFunctionModelBinding(functionKey, model ? model.id : null);
    const bnds = await getFunctionModelBindings();
    setBindings(bnds);
    toast.success('绑定已更新');
  }

  const isModelInScope = (model: ModelCatalog) => {
    if (modelScope === 'image') return model.capabilities.some(cap => IMAGE_CAPABILITIES.has(cap));
    if (modelScope === 'video') return model.capabilities.some(cap => VIDEO_CAPABILITIES.has(cap));
    return true;
  };
  const modelsByConfig = (configId: string) => models.filter(m => m.api_config_id === configId && isModelInScope(m));
  const modelCountsByConfig = (configId: string) => {
    const all = models.filter(m => m.api_config_id === configId);
    const scoped = all.filter(isModelInScope);
    return { total: all.length, scoped: scoped.length, other: Math.max(0, all.length - scoped.length) };
  };
  const visibleApiConfigs = apiConfigs.filter(cfg => {
    const keyword = configSearch.trim().toLowerCase();
    const matchesSearch = !keyword || [cfg.name, cfg.provider, cfg.base_url].some(value => String(value || '').toLowerCase().includes(keyword));
    const matchesStatus = configStatus === 'all' || (configStatus === 'enabled' && cfg.enabled) || (configStatus === 'disabled' && !cfg.enabled) || (configStatus === 'error' && !!syncErrors[cfg.id]);
    return matchesSearch && matchesStatus;
  });

  // 内联模型列表组件
  function ModelList({ config }: { config: ApiConfig }) {
    const cfgModels = modelsByConfig(config.id);
    const syncErr = syncErrors[config.id];
    const canManual = !config.model_fetch_mode || config.model_fetch_mode === 'manual' || config.model_fetch_mode === 'auto_then_manual';

    const emptyHint = syncErr
      ? `模型同步失败。该接口可能不支持 /models，你可以手动添加模型 ID。`
      : '暂无模型，点击「同步模型」获取列表，或手动添加模型 ID。';

    if (cfgModels.length === 0) {
      return (
        <div className="px-4 pb-4 pt-3 space-y-2">
          {syncErr ? (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{syncErr}</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{emptyHint}</p>
          )}
          {canManual && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setManualModelConfig(config)}>
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />手动添加模型
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="px-4 pb-4 space-y-2">
        {syncErr && (
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mt-2">
            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{syncErr}。你可以手动添加模型 ID。</span>
          </div>
        )}
        <div className="text-xs text-muted-foreground mb-1">
          点击能力标签可开启/关闭，点击模型名可编辑展示名称
        </div>
        {cfgModels.map(m => (
          <div key={m.id} className="flex items-start gap-3 py-2 px-3 rounded-lg bg-muted/40 border border-border/50">
            <Switch checked={m.enabled} onCheckedChange={() => handleToggleModel(m)} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              {editingDisplayName === m.id ? (
                <div className="flex items-center gap-1">
                  <Input value={displayNameInput} onChange={e => setDisplayNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(m); if (e.key === 'Escape') setEditingDisplayName(null); }}
                    className="h-6 text-xs px-2 py-0 w-48" autoFocus />
                  <button onClick={() => saveDisplayName(m)} className="text-primary hover:opacity-80">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => startEditDisplayName(m)}
                  className="text-sm font-medium truncate max-w-full text-left hover:text-primary transition-colors group flex items-center gap-1"
                  title="点击编辑展示名称">
                  {m.display_name || m.model_id}
                  <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-40 shrink-0" />
                </button>
              )}
              {m.display_name && m.display_name !== m.model_id && (
                <p className="text-xs text-muted-foreground truncate">{m.model_id}</p>
              )}
              {/* 手动添加标记 */}
              {m.source === 'manual' && (
                <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">手动添加</span>
              )}
              <div className="flex gap-1 flex-wrap items-center">
                {(Object.keys(CAPABILITY_LABELS) as ModelCapability[]).map(cap => {
                  const isActive = m.capabilities.includes(cap);
                  const isAutoOnly = m.auto_detected_capabilities.includes(cap) && m.user_confirmed_capabilities.length === 0;
                  return (
                    <button key={cap} onClick={() => handleCapabilityToggle(m, cap)}
                      title={isAutoOnly ? '系统自动识别（点击可手动开启/关闭）' : isActive ? '已启用（点击关闭）' : '已关闭（点击启用）'}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-all select-none ${
                        isActive
                          ? capabilityColors[cap] + ' border-transparent font-medium'
                          : 'text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
                      }`}>
                      {isAutoOnly && <span className="mr-0.5 opacity-70">⚡</span>}
                      {CAPABILITY_LABELS[cap]}
                    </button>
                  );
                })}
                {m.user_confirmed_capabilities.length > 0 && (
                  <button onClick={() => handleRestoreAutoDetected(m)} title="恢复为系统自动识别结果"
                    className="text-xs px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all flex items-center gap-1">
                    <RotateCcw className="w-3 h-3" />恢复自动识别
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {canManual && (
          <Button size="sm" variant="outline" className="text-xs h-7 mt-1" onClick={() => setManualModelConfig(config)}>
            <UserPlus className="w-3.5 h-3.5 mr-1.5" />手动添加模型
          </Button>
        )}
      </div>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-400" />{pageTitle}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">{pageDescription}</p>
          </div>
        </div>

        <Tabs defaultValue="api" className="space-y-4">
          <TabsList className="bg-muted">
            <TabsTrigger value="api">API 配置</TabsTrigger>
            <TabsTrigger value="bindings">功能绑定</TabsTrigger>
          </TabsList>

          {/* API 配置 Tab（含内联模型列表） */}
          <TabsContent value="api" className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                <Input className="max-w-sm" value={configSearch} onChange={e => setConfigSearch(e.target.value)} placeholder="搜索配置名称、提供商或 Base URL" />
                <Select value={configStatus} onValueChange={v => setConfigStatus(v as typeof configStatus)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="enabled">已启用</SelectItem><SelectItem value="disabled">已停用</SelectItem><SelectItem value="error">同步异常</SelectItem></SelectContent>
                </Select>
              </div>
              <Button onClick={() => { setEditConfig(undefined); setFormOpen(true); }}><Plus className="w-4 h-4 mr-1" />添加配置</Button>
            </div>

            {/* 空状态引导卡 */}
            {!loading && apiConfigs.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Cpu className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">还没有 API 配置</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      添加 API 配置后，同步或手动添加模型，即可在各创作功能中使用 AI 生成能力。
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { icon: '🎙️', title: 'TTS 语音合成', desc: '接入 OpenAI、MiniMax、ElevenLabs 等 TTS 服务，为分镜、剧本配音', type: 'audio_api' },
                    { icon: '✍️', title: '文本生成', desc: '接入 GPT-4o、Claude、DeepSeek 等 LLM，生成剧本、分镜脚本、选题', type: 'openai_compatible' },
                    { icon: '🎨', title: '图片生成', desc: '接入文生图、图生图和图片编辑模型，为分镜和条漫生成素材', type: 'openai_compatible' },
                    { icon: '🎬', title: '视频生成', desc: '接入文生视频、图生视频、首尾帧和多参考视频模型', type: 'openai_compatible' },
                  ].map(item => (
                    <button key={item.type + item.title}
                      className="text-left rounded-lg border border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-colors p-3 space-y-1"
                      onClick={() => { setEditConfig(undefined); setFormOpen(true); }}>
                      <p className="text-sm font-medium">{item.icon} {item.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                    </button>
                  ))}
                </div>
                <Button onClick={() => { setEditConfig(undefined); setFormOpen(true); }}>
                  <Plus className="w-4 h-4 mr-1.5" />添加第一个 API 配置
                </Button>
              </div>
            )}

            {/* Fish Audio 出口网络限制说明 */}
            {apiConfigs.some(c => c.api_type === 'audio_api') && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-xs space-y-2">
                <div className="flex items-center gap-2 font-medium text-yellow-400">
                  <WifiOff className="w-3.5 h-3.5 shrink-0" />
                  Fish Audio 出口网络说明
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  如遇「同步声音 / 生成语音」连接超时，说明当前后端运行节点无法访问{' '}
                  <span className="font-mono text-foreground/70">api.fish.audio</span>（网络限制）。
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground/80">解决方案：</span>在部署环境的环境变量（密钥管理）中配置{' '}
                  <span className="font-mono text-foreground/70">FISH_AUDIO_PROXY_URL</span>，填入一个可访问{' '}
                  <span className="font-mono text-foreground/70">api.fish.audio</span> 的代理服务地址（如 Cloudflare Worker、Nginx 反代、或境外 VPS）。
                  配置后所有 Fish Audio 请求将自动通过代理转发，无需改动其他设置。
                </p>
                <p className="text-muted-foreground">
                  暂时无代理时，可在「音频制作 → 声音库」中{' '}
                  <span className="text-foreground/80">手动添加 Voice ID</span>，或{' '}
                  <span className="text-foreground/80">上传参考音频创建声音模型</span>（上传不受网络限制影响）。
                </p>
              </div>
            )}

            {loading ? (
              <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-24" />)}</div>
            ) : apiConfigs.length > 0 && (
              <div className="space-y-3">
                {visibleApiConfigs.map(cfg => {
                  const isExpanded = expandedConfigs.has(cfg.id);
                  const cfgModelCount = modelsByConfig(cfg.id).length;
                  const cfgCounts = modelCountsByConfig(cfg.id);
                  const cfgSyncErr = syncErrors[cfg.id];
                  const cfgSyncOk = syncSuccess[cfg.id];
                  return (
                    <Card key={cfg.id} className="bg-card border-border overflow-hidden">
                      <CardContent className="p-4 pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold">{cfg.name}</span>
                              <Badge variant={cfg.enabled ? 'default' : 'secondary'} className="text-xs">
                                {cfg.enabled ? '启用' : '禁用'}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {API_TYPES.find(t => t.value === cfg.api_type)?.label}
                              </Badge>
                              {/* 同步失败标记 */}
                              {cfgSyncErr && (
                                <Badge variant="destructive" className="text-xs gap-1">
                                  <XCircle className="w-3 h-3" />同步失败
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{cfg.base_url}</p>
                            {cfg.masked_api_key && (
                              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{cfg.masked_api_key}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
                              {modelScope === 'all' ? (
                                <span>{cfgCounts.total} 个模型</span>
                              ) : (
                                <>
                                  <span className={cfgCounts.scoped > 0 ? 'text-green-400' : ''}>
                                    {cfgCounts.scoped} 个{modelScope === 'image' ? '图片' : '视频'}模型
                                  </span>
                                  {cfgCounts.other > 0 && <span>{cfgCounts.other} 个其他模型已隐藏</span>}
                                </>
                              )}
                              {cfgSyncOk && (
                                <span className="text-green-400">
                                  最近同步：共 {cfgSyncOk.count} 个
                                  {modelScope !== 'all' && `，当前识别 ${cfgSyncOk.scopedCount} 个${modelScope === 'image' ? '图片' : '视频'}模型`}
                                  {' · '}{new Date(cfgSyncOk.at).toLocaleTimeString()}
                                </span>
                              )}
                              {cfgSyncErr && <span className="text-destructive break-all">{cfgSyncErr}</span>}
                            </div>
                            {cfgSyncOk?.diagnostics && cfgSyncOk.diagnostics.length > 0 && (
                              <div className="mt-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground space-y-1">
                                <div className="font-medium text-foreground/80">同步诊断（显示前 5 个模型）</div>
                                {cfgSyncOk.diagnostics.slice(0, 5).map(item => (
                                  <div key={item.id} className="break-all">
                                    <span className="font-mono text-foreground/80">{item.id}</span>
                                    {' · 原始字段：'}{item.presentFields.length ? item.presentFields.join(', ') : '无'}
                                    {' · 来源：'}{item.source === 'capabilities' ? 'API capabilities' : item.source === 'input_output' ? 'API input/output' : item.source === 'modalities' ? 'API modalities' : '模型名称兜底'}
                                    {' · 结果：'}{item.capabilities.length ? item.capabilities.join(', ') : '无生成能力'}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                            <div className="flex items-center gap-1.5 mr-1">
                              <Switch checked={cfg.enabled} onCheckedChange={() => handleToggleConfig(cfg)} aria-label={`${cfg.enabled ? '停用' : '启用'} ${cfg.name}`} />
                              <span className="text-xs text-muted-foreground">{cfg.enabled ? '启用' : '停用'}</span>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => handleSync(cfg)} disabled={syncingId === cfg.id}>
                              <RefreshCw className={`w-3 h-3 mr-1 ${syncingId === cfg.id ? 'animate-spin' : ''}`} />同步模型
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setManualModelConfig(cfg)}>
                              <UserPlus className="w-3.5 h-3.5 mr-1" />手动添加
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setEditConfig(cfg); setFormOpen(true); }}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteId(cfg.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        {/* 展开/收起模型列表按钮 */}
                        <button
                          onClick={() => toggleExpand(cfg.id)}
                          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {isExpanded
                            ? <ChevronUp className="w-3.5 h-3.5" />
                            : <ChevronDown className="w-3.5 h-3.5" />}
                          {cfgModelCount > 0
                            ? `${cfgModelCount} 个模型${isExpanded ? '（收起）' : '（查看并编辑）'}`
                            : cfgSyncErr ? '查看同步错误详情'
                              : cfgCounts.total > 0 && modelScope !== 'all'
                                ? `已同步 ${cfgCounts.total} 个模型，但未识别到${modelScope === 'image' ? '图片' : '视频'}能力`
                                : '查看模型列表'}
                        </button>
                      </CardContent>

                      {/* 内联模型列表 */}
                      {isExpanded && (
                        <div className="border-t border-border/60 bg-muted/20">
                          <ModelList config={cfg} />
                        </div>
                      )}
                    </Card>
                  );
                })}
                {visibleApiConfigs.length === 0 && <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">没有符合当前搜索或状态筛选的 API 配置</div>}
              </div>
            )}
          </TabsContent>

          {/* 功能绑定 Tab */}
          <TabsContent value="bindings" className="space-y-4">
            <p className="text-sm text-muted-foreground">为每个功能绑定默认使用的模型。未选择时将由用户手动选择。</p>
            <div className="space-y-3">
              {(Object.entries(FUNCTION_KEY_LABELS) as [string, string][]).map(([fnKey, label]) => {
                const binding = bindings.find(b => b.function_key === fnKey);
                const allowedCaps = FUNCTION_CAPABILITY_MAP[fnKey as keyof typeof FUNCTION_CAPABILITY_MAP] || [];
                const availableModels = models.filter(m => m.enabled && allowedCaps.some(cap => m.capabilities.includes(cap)));

                return (
                  <Card key={fnKey} className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium text-sm">{label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            需要：{allowedCaps.map(c => CAPABILITY_LABELS[c]).join(' / ')}
                          </div>
                        </div>
                        <div className="min-w-0 w-56 shrink-0">
                          <Select
                            value={binding?.model_catalog_id || 'none'}
                            onValueChange={v => handleBindingChange(fnKey, v === 'none' ? '' : v)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="未绑定" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">不绑定默认模型</SelectItem>
                              {availableModels.map(m => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.display_name || m.model_id}
                                </SelectItem>
                              ))}
                              {availableModels.length === 0 && (
                                <SelectItem value="no-model" disabled>无可用模型</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ApiConfigDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        config={editConfig}
        onSaved={load}
        scope={modelScope}
      />

      {manualModelConfig && (
        <ManualModelDialog
          open={!!manualModelConfig}
          onOpenChange={open => { if (!open) setManualModelConfig(null); }}
          config={manualModelConfig}
          onSaved={async () => {
            const freshModels = await getModelCatalog(manualModelConfig.id);
            setModels(prev => {
              const others = prev.filter(m => m.api_config_id !== manualModelConfig.id);
              return [...others, ...freshModels];
            });
            setExpandedConfigs(prev => new Set([...prev, manualModelConfig.id]));
          }}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除配置？</AlertDialogTitle>
            <AlertDialogDescription>此操作将删除该API配置及其关联模型记录。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfig} className="bg-destructive text-destructive-foreground">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
