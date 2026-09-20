// 应用核心类型定义

export interface Project {
  id: string;
  name: string;
  type: string;
  target_platform: string;
  aspect_ratio: string;
  description?: string;
  status: string;
  created_at: string;
  updated_at: string;
  // 统计字段（通过关联查询得到）
  topics_count?: number;
  scripts_count?: number;
  storyboards_count?: number;
  assets_count?: number;
}

export interface Topic {
  id: string;
  project_id: string;
  title: string;
  summary?: string;
  audience?: string;
  core_conflict?: string;
  selling_point?: string;
  platform?: string;
  duration_suggestion?: string;
  content?: string;
  creative_advice?: string;
  extend_directions?: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface Script {
  id: string;
  project_id: string;
  topic_id?: string;
  title: string;
  content?: string;
  duration?: string;
  style?: string;
  script_type?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ScriptVersion {
  id: string;
  script_id: string;
  version: number;
  content?: string;
  created_at: string;
}

export interface Storyboard {
  id: string;
  project_id: string;
  script_id?: string;
  shot_index: number;
  duration?: string;
  shot_type?: string;
  camera_movement?: string;
  visual_description?: string;
  character_action?: string;
  expression?: string;
  dialogue?: string;
  voiceover?: string;
  sound_effect?: string;
  image_prompt?: string;
  video_prompt?: string;
  image_asset_id?: string;
  video_asset_id?: string;
  voiceover_asset_id?: string;
  dialogue_asset_id?: string;
  // 关联查询时填充
  voiceover_audio?: Asset;
  dialogue_audio?: Asset;
  created_at: string;
  updated_at: string;
}

export type AssetType = 'image' | 'video' | 'audio' | 'text' | 'storyboard' | 'script' | 'comic' | 'pdf' | 'other';

export interface Asset {
  id: string;
  project_id: string;
  storyboard_id?: string;
  asset_type: AssetType;
  name: string;
  file_url?: string;
  thumbnail_url?: string;
  prompt?: string;
  source_module?: string;
  metadata?: Record<string, unknown>;
  notes?: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
}

export type ApiType = 'openai_compatible' | 'custom' | 'comfyui' | 'audio_api';

/**
 * 通用异步视频任务接口配置（存储于 api_configs.video_task_config）
 * 通过配置驱动任务创建、任务 ID 提取、轮询、状态判断、结果 URL 提取
 */
export interface VideoTaskConfig {
  /** 创建任务的路径，相对 baseUrl，默认 /videos/generations */
  create_url_path?: string;
  /** 从创建响应中提取任务 ID 的字段路径，默认 id */
  task_id_path?: string;
  /** 备用任务 ID 字段（如 Agnes 优先用 video_id），默认 task_id */
  fallback_task_id_path?: string;
  /**
   * 轮询 URL 模板，支持 {{task_id}}、{{base_url}}、{{base_url_root}}
   * 默认: {{base_url}}/videos/tasks/{{task_id}}
   */
  poll_url_template?: string;
  /** 轮询请求方法，默认 GET */
  poll_method?: 'GET' | 'POST';
  /** 从轮询响应提取状态的字段路径，默认 status */
  status_path?: string;
  /** 从轮询响应提取进度的字段路径，默认 progress */
  progress_path?: string;
  /** 视为成功的状态值列表 */
  success_status_values?: string[];
  /** 视为进行中的状态值列表 */
  running_status_values?: string[];
  /** 视为失败的状态值列表 */
  failed_status_values?: string[];
  /** 从轮询响应提取最终视频 URL 的字段路径，默认 url */
  result_url_path?: string;
  /** 从轮询响应提取错误信息的字段路径，默认 error.message */
  error_path?: string;
}

export interface ApiConfig {
  id: string;
  user_id?: string;
  name: string;
  provider?: string;
  base_url: string;
  /** 永远不在前端显示原始值，仅供后端使用 */
  encrypted_api_key?: string;
  /** 脱敏后的密钥：sk-****xxxx，前端只读 */
  masked_api_key?: string;
  /** 原始 API Key 末 4 位，用于拼接脱敏显示 */
  key_suffix?: string;
  api_type: ApiType;
  enabled: boolean;
  /** 通用异步视频任务配置（替代 video_endpoint_path） */
  video_task_config?: VideoTaskConfig;
  /** @deprecated 改用 video_task_config.create_url_path */
  video_endpoint_path?: string;
  /** 模型获取方式: auto=自动同步; manual=手动添加; auto_then_manual=自动同步失败后允许手动添加 */
  model_fetch_mode?: 'auto' | 'manual' | 'auto_then_manual';
  /** 模型列表路径，拼接在 base_url 后，默认 /models */
  models_path?: string;
  /** Chat Completions 请求路径，拼接在 base_url 后，默认 /chat/completions */
  chat_completions_path?: string;
  /** 文本响应字段路径（点分），默认 choices.0.message.content */
  text_response_path?: string;
  /** 图片生成端点路径，拼接在 base_url 后，默认 /images/generations */
  images_generations_path?: string;
  /** 图片响应的图片列表字段路径（点分），默认 data */
  image_response_path?: string;
  /** 请求上游的超时秒数，默认 120，上限 600 */
  request_timeout_seconds?: number;
  // ===== 通用 TTS 接口配置 =====
  /** TTS 请求方法，默认 POST */
  audio_tts_method?: string;
  /** TTS 请求路径，默认 /v1/tts */
  audio_tts_path?: string;
  /** 鉴权方式：bearer / header_key / query_key / basic / none / custom */
  audio_tts_auth_type?: string;
  /** 自定义鉴权 Header 名（auth_type=header_key 时使用） */
  audio_tts_model_header_name?: string;
  /** 默认模型 ID（覆盖 model_catalog.model_id） */
  audio_tts_model_id?: string;
  /** 请求体 JSON 模板，支持 {{变量}} 占位符 */
  audio_tts_request_template?: Record<string, unknown>;
  /** 响应类型：binary_audio | json_audio_url | json_audio_base64 | json_task_id */
  audio_tts_response_type?: string;
  /** @deprecated 改用 audio_url_path */
  audio_tts_result_path?: string;
  /** 错误字段路径，默认 message */
  audio_tts_error_path?: string;
  /** Content-Type，默认 application/json */
  tts_content_type?: string;
  /** Accept，默认 audio/mpeg */
  tts_accept?: string;
  /** 请求超时秒数，默认 120 */
  tts_timeout_seconds?: number;
  /** 额外 Header 模板（JSON 字符串），支持 {{变量}} */
  tts_headers_template?: string;
  /** 额外 Query 模板（JSON 字符串），支持 {{变量}} */
  tts_query_template?: string;
  // 响应字段路径
  /** json_audio_url 模式：音频 URL 字段路径 */
  audio_url_path?: string;
  /** json_audio_base64 模式：base64 音频字段路径 */
  audio_base64_path?: string;
  /** json_task_id 模式：任务 ID 字段路径 */
  task_id_path?: string;
  /** 异步任务状态字段路径 */
  status_path?: string;
  /** 异步任务结果 URL 字段路径 */
  result_url_path?: string;
  /** 错误信息字段路径 */
  error_message_path?: string;
  // 连通性测试配置
  /** 测试请求方法，默认 GET */
  test_method?: string;
  /** 测试路径，默认 /v1/models */
  test_path?: string;
  test_headers_template?: string;
  test_query_template?: string;
  test_body_template?: string;
  test_success_condition?: string;
  // ===== ASR 接口配置 =====
  audio_asr_method?: string;
  audio_asr_path?: string;
  audio_asr_content_type?: string;
  audio_asr_text_path?: string;
  audio_asr_duration_path?: string;
  audio_asr_segments_path?: string;
  audio_asr_error_path?: string;
  // ===== 声音转换接口配置 =====
  /** 声音转换请求方法，默认 POST */
  voice_conversion_method?: string;
  /** 声音转换请求路径 */
  voice_conversion_path?: string;
  /** 响应类型：binary_audio | json_audio_url | json_audio_base64 */
  voice_conversion_response_type?: string;
  /** 结果 URL 字段路径（json_audio_url 模式）*/
  voice_conversion_result_path?: string;
  /** 错误字段路径 */
  voice_conversion_error_path?: string;
  /** 请求体模板（JSON），支持 {{变量}} 占位符 */
  voice_conversion_request_template?: Record<string, unknown>;
  // ===== 声音设计接口配置 =====
  /** 声音设计请求路径 */
  voice_design_path?: string;
  /** 请求体模板（JSON），支持 {{变量}} 占位符 */
  voice_design_request_template?: Record<string, unknown>;
  /** 结果路径（返回音频 URL 数组） */
  voice_design_result_path?: string;
  created_at: string;
  updated_at: string;
}

export type ModelCapability =
  | 'text_generation' | 'image_generation' | 'image_edit'
  | 'multimodal' | 'audio_generation' | 'audio_recognition'
  | 'tts' | 'asr' | 'voice_clone' | 'multi_speaker_tts'
  | 'voice_design' | 'voice_conversion' | 'audio_enhancement'
  // 视频通用
  | 'video_generation'
  // 视频子能力
  | 'text_to_video'
  | 'image_to_video'
  | 'first_last_frame_video'
  | 'multi_image_reference_video'
  | 'video_reference_generation'
  | 'video_to_video'
  | 'video_extend'
  | 'video_repaint'
  | 'video_edit'
  | 'video_style_transfer'
  | 'audio_driven_video'
  | 'lip_sync'
  | 'image_audio_to_video'
  | 'video_audio_to_video'
  | 'multimodal_video_generation'
  | 'character_reference_video'
  | 'motion_reference_video';

export interface ModelCatalog {
  id: string;
  api_config_id: string;
  provider?: string;
  base_url?: string;
  model_id: string;
  display_name?: string;
  owned_by?: string;
  capabilities: ModelCapability[];
  auto_detected_capabilities: ModelCapability[];
  user_confirmed_capabilities: ModelCapability[];
  enabled: boolean;
  raw?: Record<string, unknown>;
  last_synced_at?: string;
  /** 模型来源: synced=自动同步; manual=手动添加 */
  source?: 'synced' | 'manual';
  // ===== TTS 专属字段 =====
  /** 是否需要指定声音（voice_id），默认 false */
  requires_voice?: boolean;
  /** 声音字段显示标签 */
  voice_field_label?: string;
  /** 声音字段占位符 */
  voice_field_placeholder?: string;
  /** 默认声音 ID */
  default_voice_id?: string;
  /** 默认输出格式 */
  default_format?: string;
  /** 默认采样率 */
  default_sample_rate?: number;
  /** 动态参数面板 schema，key → { type, label, default, min, max, options } */
  tts_param_schema?: Record<string, TtsParamDef>;
  /** 模型默认参数 */
  default_params?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // 关联
  api_config?: ApiConfig;
}

/** TTS 动态参数定义 */
export interface TtsParamDef {
  type: 'number' | 'select' | 'text' | 'boolean';
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
}

// ===== 声音库 =====
export interface VoiceProfile {
  id: string;
  user_id: string;
  api_config_id?: string;
  name: string;
  /** Fish Audio / MiniMax 声音模型 ID，即 reference_id */
  voice_id: string;
  /** 来源：手动添加 / 同步 / 创建 */
  source?: 'manual' | 'synced' | 'created';
  gender?: string;
  language?: string;
  style_tags?: string[];
  description?: string;
  is_default: boolean;
  /** 服务商原始返回数据 */
  raw?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ===== 音频生成记录 =====
export type AudioGenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AudioGenerationRecord {
  id: string;
  user_id: string;
  project_id?: string;
  storyboard_id?: string;
  model_catalog_id?: string;
  api_config_id?: string;
  voice_profile_id?: string;
  mode: string;
  input_text?: string;
  params?: Record<string, unknown>;
  result_asset_id?: string;
  status: AudioGenerationStatus;
  error_message?: string;
  created_at: string;
  updated_at: string;
  // 关联
  result_asset?: Asset;
  voice_profile?: VoiceProfile;
}

export type FunctionKey = 'topic_generation' | 'script_generation' | 'storyboard_generation' | 'image_generation' | 'image_edit' | 'video_generation' | 'comic_generation';

export interface FunctionModelBinding {
  id: string;
  function_key: FunctionKey;
  model_catalog_id?: string;
  default_params?: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  // 关联
  model?: ModelCatalog;
}

export interface TemplateVariable {
  name: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  default: string;
  required: boolean;
  description: string;
  options?: string[];
}

export interface PromptTemplate {
  id: string;
  user_id?: string;
  /** true = 系统内置模板，所有用户可读但不可删改 */
  is_system_template?: boolean;
  name: string;
  category: string;
  sub_type?: string;
  description?: string;
  platforms?: string[];
  scenarios?: string[];
  tags?: string[];
  rating?: number;
  content: string;
  variables?: TemplateVariable[];
  usage_guide?: string;
  created_at: string;
  updated_at: string;
}

export type VideoTaskStatus = 'pending' | 'submitted' | 'processing' | 'fetching' | 'storage_failed' | 'completed' | 'failed' | 'expired' | 'timeout';

export interface VideoTask {
  id: string;
  user_id?: string;
  project_id: string;
  storyboard_id?: string;
  api_config_id?: string;
  model_catalog_id?: string;
  upstream_task_id?: string;
  /** 部分提供商（如 Agnes）用独立 video_id 查询进度 */
  upstream_video_id?: string;
  prompt?: string;
  negative_prompt?: string;
  /** 生成模式：text2video / image2video / keyframes / multi_image */
  mode?: string;
  reference_image_url?: string;
  /** 参考图片素材 ID（优先于 reference_image_url） */
  reference_image_asset_id?: string;
  first_frame_url?: string;
  first_frame_asset_id?: string;
  last_frame_url?: string;
  last_frame_asset_id?: string;
  /** 参数快照（JSON），保存提交时的 width/height/num_frames/frame_rate/extra_body 等 */
  params_snapshot?: Record<string, unknown>;
  /** 多模态输入：images / videos / audios */
  inputs?: {
    images?: Array<{ asset_id?: string; url: string; role?: string; weight?: number; sort_order?: number }>;
    videos?: Array<{ asset_id?: string; url: string; role?: string; weight?: number; sort_order?: number }>;
    audios?: Array<{ asset_id?: string; url: string; role?: string; weight?: number; sort_order?: number }>;
  };
  /** 生成参数（新版统一结构） */
  params?: Record<string, unknown>;
  /** 本次任务引用的所有素材 ID */
  source_asset_ids?: string[];
  /** 生成完成后保存到素材库的 asset ID */
  result_asset_id?: string;
  status: VideoTaskStatus;
  progress: number;
  polling_retry_count: number;
  video_url?: string;
  thumbnail_url?: string;
  error_message?: string;
  /** 创建任务时的原始响应（方便排查问题） */
  raw_create_response?: Record<string, unknown>;
  /** 最后一次轮询的原始响应 */
  raw_poll_response?: Record<string, unknown>;
  submitted_at?: string;
  processing_at?: string;
  fetching_at?: string;
  completed_at?: string;
  failed_at?: string;
  expired_at?: string;
  timeout_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CanvasElement {
  id: string;
  type: 'image' | 'text' | 'bubble' | 'rect' | 'divider';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  z_index: number;
  locked: boolean;
  // 通用内容
  content?: string;
  color?: string;
  background_color?: string;
  // 文本属性
  font_size?: number;
  text_align?: string;
  bold?: boolean;
  line_height?: number;
  letter_spacing?: number;
  // 气泡属性
  bubble_shape?: string;
}

export interface CanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
  panels: { id: string; height: number }[];
}

export interface ComicDraft {
  id: string;
  project_id: string;
  name: string;           // DB column: name
  canvas_config: CanvasConfig;
  elements: CanvasElement[]; // DB column: elements
  version: number;
  created_at: string;
  updated_at: string;
  // 前端便利别名
  title?: string;
  canvas_elements?: CanvasElement[];
}

export interface AppSetting {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

/** 用户 Profile（与 auth.users 1:1 同步） */
export interface Profile {
  id: string;
  email?: string;
  username?: string;
  role: 'user' | 'admin';
  status: string;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export const ASSET_TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  storyboard: '分镜',
  script: '剧本',
  comic: '条漫',
  pdf: 'PDF',
  other: '其他',
};

export const FUNCTION_KEY_LABELS: Record<FunctionKey, string> = {
  topic_generation: '爆款选题生成',
  script_generation: '剧本生成',
  storyboard_generation: '分镜脚本生成',
  image_generation: '图片生成',
  image_edit: '图片编辑',
  video_generation: '视频生成',
  comic_generation: '条漫生成',
};

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text_generation:   '文本生成',
  image_generation:  '图片生成',
  image_edit:        '图片编辑',
  video_generation:  '视频生成',
  multimodal:        '多模态理解',
  audio_generation:  '音频生成',
  audio_recognition: '音频识别',
  tts:               '文本转语音',
  asr:               '语音转文字',
  voice_clone:       '声音克隆',
  multi_speaker_tts: '多角色配音',
  voice_design:      '声音设计',
  voice_conversion:  '声音转换',
  audio_enhancement: '音频增强',
  // 视频子能力
  text_to_video:               '文生视频',
  image_to_video:              '图生视频',
  first_last_frame_video:      '首尾帧视频',
  multi_image_reference_video: '多图参考',
  video_reference_generation:  '视频参考生成',
  video_to_video:              '视频转视频',
  video_extend:                '视频续写',
  video_repaint:               '视频重绘',
  video_edit:                  '视频编辑',
  video_style_transfer:        '视频风格迁移',
  audio_driven_video:          '音频驱动视频',
  lip_sync:                    '口型同步',
  image_audio_to_video:        '图片+音频生视频',
  video_audio_to_video:        '视频+音频生视频',
  multimodal_video_generation: '多模态参考生成',
  character_reference_video:   '角色参考视频',
  motion_reference_video:      '运动参考视频',
};

export const VIDEO_STATUS_LABELS: Record<VideoTaskStatus, string> = {
  pending: '等待提交',
  submitted: '已提交',
  processing: '生成中',
  fetching: '获取中',
  storage_failed: '保存失败',
  completed: '已完成',
  failed: '生成失败',
  expired: '已过期',
  timeout: '超时',
};

export const PROJECT_TYPE_OPTIONS = ['AI漫剧', '条漫', '教程短视频', '图文内容', '其他'];
export const PLATFORM_OPTIONS = ['抖音', '快手', '视频号', '小红书', 'B站', '公众号'];
export const ASPECT_RATIO_OPTIONS = ['9:16', '16:9', '1:1', '4:5', '3:4'];

export const TEMPLATE_CATEGORIES = [
  { value: 'topic_generation', label: '选题生成' },
  { value: 'script_generation', label: '剧本生成' },
  { value: 'storyboard_generation', label: '分镜脚本生成' },
  { value: 'image_prompt_generation', label: '图片提示词生成' },
  { value: 'video_prompt_generation', label: '视频提示词生成' },
  { value: 'comic_generation', label: '条漫生成' },
  { value: 'image_edit', label: '图片编辑' },
  { value: 'content_optimization', label: '内容优化' },
];

export const FUNCTION_CAPABILITY_MAP: Record<FunctionKey, ModelCapability[]> = {
  topic_generation: ['text_generation'],
  script_generation: ['text_generation'],
  storyboard_generation: ['text_generation'],
  image_generation: ['image_generation'],
  image_edit: ['image_edit'],
  video_generation: ['video_generation', 'text_to_video', 'image_to_video', 'first_last_frame_video', 'multi_image_reference_video', 'video_reference_generation', 'video_to_video', 'video_extend', 'video_repaint', 'video_edit', 'video_style_transfer', 'audio_driven_video', 'lip_sync', 'image_audio_to_video', 'video_audio_to_video', 'multimodal_video_generation', 'character_reference_video', 'motion_reference_video'],
  comic_generation: ['text_generation', 'image_generation'],
};
