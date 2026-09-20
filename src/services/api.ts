import { db } from '@/db/client';
import type { Project, Topic, Script, ScriptVersion, Storyboard, Asset, AssetType, ApiConfig, ModelCatalog, ModelCapability, FunctionModelBinding, PromptTemplate, VideoTask, ComicDraft, AppSetting, VoiceProfile, AudioGenerationRecord } from '@/types/types';

// ===================== 工具函数 =====================
function detectCapabilities(modelId: string): ModelCapability[] {
  const id = modelId.toLowerCase();
  const caps: ModelCapability[] = [];
  if (/gpt|claude|llama|qwen|deepseek|ernie|chatglm|baichuan|gemini|mistral/.test(id)) caps.push('text_generation');
  if (/vision|vl|multimodal|mmx/.test(id)) caps.push('multimodal');
  if (/dalle|image|flux|sd|stable-diffusion|midjourney|ideogram|kolors/.test(id)) caps.push('image_generation');
  if (/edit|inpaint|outpaint/.test(id)) caps.push('image_edit');
  if (/video|kling|runway|pika|seedance|wan|sora|gen-|animate/.test(id)) caps.push('video_generation');
  // Fish Audio TTS 模型: s2.1-pro-free / s2.1-pro / s2-pro / s1 / voice-design-*
  if (/tts|voice|audio-gen|^s2|^s1$|voice-design/.test(id)) caps.push('audio_generation');
  if (/whisper|asr|speech-to-text/.test(id)) caps.push('audio_recognition');
  return caps.length > 0 ? caps : ['text_generation'];
}

// ===================== Projects =====================
export async function getProjects(search?: string, type?: string): Promise<Project[]> {
  let query = db.from('projects').select('*').order('updated_at', { ascending: false });
  if (search) query = query.ilike('name', `%${search}%`);
  if (type && type !== 'all') query = query.eq('type', type);
  const { data, error } = await query.limit(100);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getProjectsWithStats(): Promise<Project[]> {
  const { data, error } = await db.from('projects').select('*').order('updated_at', { ascending: false }).limit(100);
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  const projects = data as Project[];
  // 批量获取统计
  const ids = projects.map(p => p.id);
  if (ids.length === 0) return projects;

  const [{ data: topics }, { data: scripts }, { data: storyboards }, { data: assets }] = await Promise.all([
    db.from('topics').select('project_id').in('project_id', ids),
    db.from('scripts').select('project_id').in('project_id', ids),
    db.from('storyboards').select('project_id').in('project_id', ids),
    db.from('assets').select('project_id').in('project_id', ids),
  ]);

  const countByProject = (rows: {project_id: string}[] | null, projectId: string) =>
    (rows || []).filter(r => r.project_id === projectId).length;

  return projects.map(p => ({
    ...p,
    topics_count: countByProject(topics as {project_id: string}[], p.id),
    scripts_count: countByProject(scripts as {project_id: string}[], p.id),
    storyboards_count: countByProject(storyboards as {project_id: string}[], p.id),
    assets_count: countByProject(assets as {project_id: string}[], p.id),
  }));
}

export async function createProject(data: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<Project> {
  const { data: result, error } = await db.from('projects').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as Project;
}

export async function updateProject(id: string, data: Partial<Project>): Promise<void> {
  const { error } = await db.from('projects').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await db.from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ===================== Topics =====================
export async function getTopics(projectId: string): Promise<Topic[]> {
  const { data, error } = await db.from('topics').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createTopics(topics: Omit<Topic, 'id' | 'created_at' | 'updated_at'>[]): Promise<Topic[]> {
  const { data, error } = await db.from('topics').insert(topics).select();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function updateTopic(id: string, data: Partial<Topic>): Promise<void> {
  const { error } = await db.from('topics').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteTopic(id: string): Promise<void> {
  const { error } = await db.from('topics').delete().eq('id', id);
  if (error) throw error;
}

// ===================== Scripts =====================
export async function getScripts(projectId: string): Promise<Script[]> {
  const { data, error } = await db.from('scripts').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createScript(data: Omit<Script, 'id' | 'created_at' | 'updated_at'>): Promise<Script> {
  const { data: result, error } = await db.from('scripts').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as Script;
}

export async function updateScript(id: string, data: Partial<Script>): Promise<void> {
  const { error } = await db.from('scripts').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteScript(id: string): Promise<void> {
  const { error } = await db.from('scripts').delete().eq('id', id);
  if (error) throw error;
}

export async function getScriptVersions(scriptId: string): Promise<ScriptVersion[]> {
  const { data, error } = await db.from('script_versions').select('*').eq('script_id', scriptId).order('version', { ascending: false }).limit(20);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function saveScriptVersion(scriptId: string, version: number, content: string): Promise<void> {
  const { error } = await db.from('script_versions').insert({ script_id: scriptId, version, content });
  if (error) throw error;
}

// ===================== Storyboards =====================
export async function getStoryboards(projectId: string, scriptId?: string): Promise<Storyboard[]> {
  let query = db
    .from('storyboards')
    .select('*, voiceover_audio:assets!storyboards_voiceover_asset_id_fkey(id,name,file_url,asset_type,metadata), dialogue_audio:assets!storyboards_dialogue_asset_id_fkey(id,name,file_url,asset_type,metadata)')
    .eq('project_id', projectId)
    .order('shot_index', { ascending: true });
  if (scriptId) query = query.eq('script_id', scriptId);
  const { data, error } = await query.order('shot_index', { ascending: true }).limit(200);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createStoryboards(storyboards: Omit<Storyboard, 'id' | 'created_at' | 'updated_at'>[]): Promise<Storyboard[]> {
  const { data, error } = await db.from('storyboards').insert(storyboards).select();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createStoryboard(data: Omit<Storyboard, 'id' | 'created_at' | 'updated_at'>): Promise<Storyboard> {
  const { data: result, error } = await db.from('storyboards').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as Storyboard;
}

export async function updateStoryboard(id: string, data: Partial<Storyboard>): Promise<void> {
  const { error } = await db.from('storyboards').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteStoryboard(id: string): Promise<void> {
  const { error } = await db.from('storyboards').delete().eq('id', id);
  if (error) throw error;
}

// ===================== Assets =====================
export async function getAssets(projectId: string, assetType?: AssetType): Promise<Asset[]> {
  let query = db.from('assets').select('*').eq('project_id', projectId);
  if (assetType) query = query.eq('asset_type', assetType);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createAsset(data: Omit<Asset, 'id' | 'created_at' | 'updated_at'>): Promise<Asset> {
  const { data: result, error } = await db.from('assets').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as Asset;
}

export async function updateAsset(id: string, data: Partial<Asset>): Promise<void> {
  const { error } = await db.from('assets').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await db.from('assets').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadAssetFile(file: File, projectId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'bin';
  const safeName = `${projectId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await db.storage.from('assets').upload(safeName, file, { contentType: file.type });
  if (error) throw error;
  if (!data) throw new Error('上传失败：未返回文件路径');
  const { data: urlData } = db.storage.from('assets').getPublicUrl(data.path);
  return urlData.publicUrl;
}

// ===================== API Configs =====================
// 前端查询 api_configs 时永远不选取 encrypted_api_key，只取 key_suffix 用于脱敏显示
const API_CONFIG_SAFE_COLUMNS = 'id, user_id, name, provider, base_url, api_type, enabled, video_task_config, key_suffix, model_fetch_mode, models_path, chat_completions_path, text_response_path, images_generations_path, image_response_path, request_timeout_seconds, audio_tts_method, audio_tts_path, audio_tts_auth_type, audio_tts_model_header_name, audio_tts_model_id, audio_tts_request_template, audio_tts_response_type, audio_tts_result_path, audio_tts_error_path, audio_asr_method, audio_asr_path, audio_asr_content_type, audio_asr_text_path, audio_asr_duration_path, audio_asr_segments_path, audio_asr_error_path, created_at, updated_at';

/** 为前端生成脱敏展示字段 masked_api_key */
function maskApiKey(config: ApiConfig): ApiConfig {
  return {
    ...config,
    masked_api_key: config.key_suffix ? `sk-****${config.key_suffix}` : undefined,
  };
}

export async function getApiConfigs(): Promise<ApiConfig[]> {
  const { data, error } = await db
    .from('api_configs')
    .select(API_CONFIG_SAFE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(d => maskApiKey(d as ApiConfig));
}

/**
 * 新增 API 配置
 * api_key 为用户在前端输入的明文密钥，通过 Edge Function 加密后保存
 */
export async function createApiConfig(data: Omit<ApiConfig, 'id' | 'created_at' | 'updated_at'> & { api_key: string }): Promise<ApiConfig> {
  const { data: result, error } = await db.functions.invoke('save-api-config', {
    body: {
      name: data.name,
      provider: data.provider,
      base_url: data.base_url,
      api_key: data.api_key,
      api_type: data.api_type,
      enabled: data.enabled,
      video_task_config: data.video_task_config,
      model_fetch_mode: data.model_fetch_mode ?? 'auto_then_manual',
      models_path: data.models_path ?? '/models',
      chat_completions_path: data.chat_completions_path ?? '/chat/completions',
      text_response_path: data.text_response_path ?? 'choices.0.message.content',
      images_generations_path: data.images_generations_path ?? '/images/generations',
      image_response_path: data.image_response_path ?? 'data',
      request_timeout_seconds: data.request_timeout_seconds ?? 120,
      audio_tts_method: data.audio_tts_method,
      audio_tts_path: data.audio_tts_path,
      audio_tts_auth_type: data.audio_tts_auth_type,
      audio_tts_model_header_name: data.audio_tts_model_header_name,
      audio_tts_model_id: data.audio_tts_model_id,
      audio_tts_request_template: data.audio_tts_request_template,
      audio_tts_response_type: data.audio_tts_response_type,
      audio_tts_result_path: data.audio_tts_result_path,
      audio_tts_error_path: data.audio_tts_error_path,
      audio_asr_method: data.audio_asr_method,
      audio_asr_path: data.audio_asr_path,
      audio_asr_content_type: data.audio_asr_content_type,
      audio_asr_text_path: data.audio_asr_text_path,
      audio_asr_duration_path: data.audio_asr_duration_path,
      audio_asr_segments_path: data.audio_asr_segments_path,
      audio_asr_error_path: data.audio_asr_error_path,
    },
  });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
  return maskApiKey(result as ApiConfig);
}

/**
 * 更新 API 配置
 * api_key 若为空则不修改密钥；若提供则重新加密后覆盖
 */
export async function updateApiConfig(id: string, data: Partial<ApiConfig> & { api_key?: string }): Promise<void> {
  const { error } = await db.functions.invoke('save-api-config', {
    body: {
      id,
      name: data.name,
      provider: data.provider,
      base_url: data.base_url,
      api_key: data.api_key || '',
      api_type: data.api_type,
      enabled: data.enabled,
      video_task_config: data.video_task_config,
      model_fetch_mode: data.model_fetch_mode ?? 'auto_then_manual',
      models_path: data.models_path ?? '/models',
      chat_completions_path: data.chat_completions_path ?? '/chat/completions',
      text_response_path: data.text_response_path ?? 'choices.0.message.content',
      images_generations_path: data.images_generations_path ?? '/images/generations',
      image_response_path: data.image_response_path ?? 'data',
      request_timeout_seconds: data.request_timeout_seconds ?? 120,
      audio_tts_method: data.audio_tts_method,
      audio_tts_path: data.audio_tts_path,
      audio_tts_auth_type: data.audio_tts_auth_type,
      audio_tts_model_header_name: data.audio_tts_model_header_name,
      audio_tts_model_id: data.audio_tts_model_id,
      audio_tts_request_template: data.audio_tts_request_template,
      audio_tts_response_type: data.audio_tts_response_type,
      audio_tts_result_path: data.audio_tts_result_path,
      audio_tts_error_path: data.audio_tts_error_path,
      audio_asr_method: data.audio_asr_method,
      audio_asr_path: data.audio_asr_path,
      audio_asr_content_type: data.audio_asr_content_type,
      audio_asr_text_path: data.audio_asr_text_path,
      audio_asr_duration_path: data.audio_asr_duration_path,
      audio_asr_segments_path: data.audio_asr_segments_path,
      audio_asr_error_path: data.audio_asr_error_path,
    },
  });
  if (error) {
    const msg = await error?.context?.text?.();
    throw new Error(msg || error.message);
  }
}

export async function deleteApiConfig(id: string): Promise<void> {
  const { error } = await db.from('api_configs').delete().eq('id', id);
  if (error) throw error;
}

// ===================== Model Catalog =====================
/** 手动添加模型到 model_catalog，source 标记为 manual */
export async function createManualModel(data: {
  api_config_id: string;
  model_id: string;
  display_name?: string;
  capabilities: ModelCapability[];
  enabled?: boolean;
  provider?: string;
  base_url?: string;
}): Promise<ModelCatalog> {
  const { data: result, error } = await db
    .from('model_catalog')
    .insert({
      api_config_id:              data.api_config_id,
      model_id:                   data.model_id,
      display_name:               data.display_name || data.model_id,
      capabilities:               data.capabilities,
      auto_detected_capabilities: [],
      user_confirmed_capabilities: data.capabilities,
      enabled:                    data.enabled ?? true,
      provider:                   data.provider || '',
      base_url:                   data.base_url || '',
      source:                     'manual',
      raw:                        { source: 'manual' },
    })
    .select()
    .single();
  if (error) throw error;
  return result as ModelCatalog;
}
export async function getModelCatalog(apiConfigId?: string): Promise<ModelCatalog[]> {
  // 排除 raw 字段（大型 JSON，不在 UI 显示）避免响应体过大导致 status:0
  let query = db.from('model_catalog').select(
    'id,api_config_id,provider,base_url,model_id,display_name,owned_by,capabilities,auto_detected_capabilities,user_confirmed_capabilities,enabled,last_synced_at,created_at,updated_at,user_id,source,requires_voice,voice_field_label,voice_field_placeholder,default_voice_id,default_format,default_sample_rate,tts_param_schema,default_params'
  );
  if (apiConfigId) query = query.eq('api_config_id', apiConfigId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function updateModelCatalog(id: string, data: Partial<ModelCatalog>): Promise<void> {
  const { error } = await db.from('model_catalog').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function upsertModels(apiConfigId: string, rawModels: {id: string; owned_by?: string; created?: number; object?: string}[], apiConfig: ApiConfig): Promise<void> {
  for (const m of rawModels) {
    const autoCaps = detectCapabilities(m.id);

    // 查询时包含 user_confirmed_capabilities，以判断用户是否手动编辑过
    const existing = await db
      .from('model_catalog')
      .select('id, user_confirmed_capabilities')
      .eq('api_config_id', apiConfigId)
      .eq('model_id', m.id)
      .maybeSingle();

    if (existing.data) {
      const userCaps: string[] = existing.data.user_confirmed_capabilities || [];
      // 用户已手动确认能力：只更新 auto_detected_capabilities，不覆盖 capabilities
      // 用户未编辑过（userCaps 为空）：用新的 autoCaps 同时更新两个字段
      const updatePayload: Record<string, unknown> = {
        auto_detected_capabilities: autoCaps,
        last_synced_at: new Date().toISOString(),
        raw: m as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      };
      if (userCaps.length === 0) {
        // 未手动编辑，capabilities 跟随最新自动识别结果
        updatePayload.capabilities = autoCaps;
      }
      // userCaps.length > 0 时，capabilities 保持数据库当前值不变

      await db.from('model_catalog').update(updatePayload).eq('id', existing.data.id);
    } else {
      // 全新模型：初始化三个字段均为自动识别结果
      // 本地版没有账号体系，user_id 固定为 'local'，仅为保持字段完整
      await db.from('model_catalog').insert({
        api_config_id: apiConfigId,
        user_id: 'local',
        provider: apiConfig.provider || '',
        base_url: apiConfig.base_url,
        model_id: m.id,
        display_name: m.id,
        owned_by: m.owned_by || '',
        capabilities: autoCaps,
        auto_detected_capabilities: autoCaps,
        user_confirmed_capabilities: [],
        enabled: true,
        raw: m as unknown as Record<string, unknown>,
        last_synced_at: new Date().toISOString(),
      });
    }
  }
}

/**
 * 清理因模型能力变更而失效的功能绑定。
 * 返回被清除绑定的功能名称列表（用于提示用户）。
 */
export async function cleanInvalidBindings(
  modelCatalogId: string,
  newCapabilities: string[],
): Promise<string[]> {
  const { data: bindings } = await db
    .from('function_model_bindings')
    .select('id, function_key')
    .eq('model_catalog_id', modelCatalogId);

  if (!bindings || bindings.length === 0) return [];

  const { FUNCTION_CAPABILITY_MAP } = await import('@/types/types');
  const invalidBindings = bindings.filter((b: { id: string; function_key: string }) => {
    const required = FUNCTION_CAPABILITY_MAP[b.function_key as keyof typeof FUNCTION_CAPABILITY_MAP] || [];
    return !required.some(cap => newCapabilities.includes(cap));
  });

  if (invalidBindings.length === 0) return [];

  await db
    .from('function_model_bindings')
    .update({ model_catalog_id: null, updated_at: new Date().toISOString() })
    .in('id', invalidBindings.map((b: { id: string }) => b.id));

  return invalidBindings.map((b: { function_key: string }) => b.function_key);
}

// ===================== Function Model Bindings =====================
export async function getFunctionModelBindings(): Promise<FunctionModelBinding[]> {
  const { data, error } = await db.from('function_model_bindings').select('*').order('function_key').limit(20);
  if (error) throw error;
  if (!Array.isArray(data)) return [];

  const bindings = data as FunctionModelBinding[];
  const modelIds = bindings.map(b => b.model_catalog_id).filter(Boolean) as string[];
  if (modelIds.length === 0) return bindings;

  const { data: models } = await db.from('model_catalog').select('*').in('id', modelIds);
  const modelMap = new Map<string, ModelCatalog>((models || []).map((m: ModelCatalog) => [m.id, m] as [string, ModelCatalog]));

  return bindings.map(b => ({ ...b, model: b.model_catalog_id ? modelMap.get(b.model_catalog_id) : undefined }));
}

export async function updateFunctionModelBinding(functionKey: string, modelCatalogId: string | null, defaultParams?: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('function_model_bindings').update({
    model_catalog_id: modelCatalogId,
    default_params: defaultParams || {},
    updated_at: new Date().toISOString(),
  }).eq('function_key', functionKey);
  if (error) throw error;
}

// ===================== App Settings =====================
export async function getAppSettings(): Promise<AppSetting[]> {
  const { data, error } = await db.from('app_settings').select('*');
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  // value 存储为 jsonb，统一转为 string
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    key: String(row.key),
    value: typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
    updated_at: String(row.updated_at),
  }));
}

export async function updateAppSetting(key: string, value: string): Promise<void> {
  const { error } = await db.from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    if (error.code === '42P01') return;
    throw error;
  }
}

// ===================== Prompt Templates =====================
export async function getPromptTemplates(category?: string, search?: string): Promise<PromptTemplate[]> {
  let query = db.from('prompt_templates').select('*');
  if (category && category !== 'all') query = query.eq('category', category);
  if (search) query = query.ilike('name', `%${search}%`);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as PromptTemplate[]) : [];
}

export async function createPromptTemplate(data: Omit<PromptTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<PromptTemplate> {
  const { data: result, error } = await db.from('prompt_templates').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as unknown as PromptTemplate;
}

export async function updatePromptTemplate(id: string, data: Partial<PromptTemplate>): Promise<void> {
  const { error } = await db.from('prompt_templates').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deletePromptTemplate(id: string): Promise<void> {
  const { error } = await db.from('prompt_templates').delete().eq('id', id);
  if (error) throw error;
}

// ===================== Video Tasks =====================
export async function getVideoTasks(projectId?: string): Promise<VideoTask[]> {
  let query = db.from('video_tasks').select('*');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createVideoTask(data: Omit<VideoTask, 'id' | 'created_at' | 'updated_at'>): Promise<VideoTask> {
  const { data: result, error } = await db.from('video_tasks').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as VideoTask;
}

export async function updateVideoTask(id: string, data: Partial<VideoTask>): Promise<void> {
  const { error } = await db.from('video_tasks').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ===================== Comic Drafts =====================
export async function getComicDrafts(projectId: string): Promise<ComicDraft[]> {
  const { data, error } = await db.from('comic_drafts').select('*').eq('project_id', projectId).order('updated_at', { ascending: false }).limit(50);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as ComicDraft[]) : [];
}

export async function createComicDraft(data: Omit<ComicDraft, 'id' | 'created_at' | 'updated_at'>): Promise<ComicDraft> {
  const { data: result, error } = await db.from('comic_drafts').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as unknown as ComicDraft;
}

export async function updateComicDraft(id: string, data: Partial<ComicDraft>): Promise<void> {
  const { error } = await db.from('comic_drafts').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ===================== AI 生成 =====================

/**
 * 上游错误分类 → 面向用户的处置建议。
 * 后端已经算出了 errorType，但如果前端只显示原始消息，
 * 用户看到的是「上游返回 401：xxxx」而不知道该去改什么。
 */
const UPSTREAM_HINT: Record<string, string> = {
  upstream_auth: '通常是 API Key 无效，或该 Key 无权访问所选模型，请到「模型配置」检查。',
  upstream_not_found: '端点或模型不存在，请检查 Base URL 与模型 ID。',
  upstream_rate: '上游限流，请稍后再试。',
  timeout: '上游响应超时，可在「模型配置」中调大请求超时，或稍后重试。',
  invalid_response: '上游返回结构不符合预期，请检查「文本响应字段路径」配置。',
  network: '无法连接上游服务，请检查网络或代理设置。',
};

/** 从 Edge Function 的错误响应体中解析出 errorType（响应体可能是纯文本或 JSON） */
function parseErrorType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { errorType?: string };
    return parsed.errorType;
  } catch {
    return undefined;
  }
}

export async function callAiGenerate(apiConfigId: string, modelId: string, prompt: string, params?: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.functions.invoke('ai-generate', {
    body: { apiConfigId, modelId, prompt, params: params || {} },
  });
  if (error) {
    const msg = await error?.context?.text?.();
    const text = msg || error.message;
    const hint = UPSTREAM_HINT[parseErrorType(msg) ?? ''];
    throw new Error(hint ? `${text}\n\n${hint}` : text);
  }
  if (!data?.content) throw new Error('模型返回内容为空');
  return data.content as string;
}

// ===================== 工具函数 =====================
export function buildPromptFromTemplate(templateContent: string, variables: Record<string, string>): string {
  let result = templateContent;
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

export function parseJsonSafely<T>(text: string): T | null {
  try {
    // 1. 去除 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
    let cleaned = text
      .replace(/^```(?:json|JSON)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    // 2. 直接解析尝试
    try { return JSON.parse(cleaned) as T; } catch { /* continue */ }

    // 3. 提取 JSON 数组（优先）
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]) as T; } catch { /* continue */ }
    }

    // 4. 提取 JSON 对象，检查是否包含单个数组属性（如 {"topics":[...]}）
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]) as Record<string, unknown>;
        // 如果对象只有一个值是数组，返回该数组
        const vals = Object.values(obj);
        const arrVal = vals.find(v => Array.isArray(v));
        if (arrVal !== undefined) return arrVal as T;
        return obj as T;
      } catch { /* continue */ }
    }

    // 5. 原始文本最后尝试
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ===================== Voice Profiles =====================
export async function getVoiceProfiles(apiConfigId?: string): Promise<VoiceProfile[]> {
  let query = db.from('voice_profiles').select('*').order('is_default', { ascending: false }).order('created_at', { ascending: false });
  if (apiConfigId) query = query.eq('api_config_id', apiConfigId);
  const { data, error } = await query.limit(200);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createVoiceProfile(data: Omit<VoiceProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<VoiceProfile> {
  // 若设为默认，先取消其他默认
  if (data.is_default) {
    await db.from('voice_profiles').update({ is_default: false }).eq('is_default', true);
  }
  const { data: result, error } = await db.from('voice_profiles').insert(data).select().maybeSingle();
  if (error) throw error;
  return result as VoiceProfile;
}

export async function updateVoiceProfile(id: string, data: Partial<VoiceProfile>): Promise<void> {
  if (data.is_default) {
    await db.from('voice_profiles').update({ is_default: false }).eq('is_default', true).neq('id', id);
  }
  const { error } = await db.from('voice_profiles').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteVoiceProfile(id: string): Promise<void> {
  const { error } = await db.from('voice_profiles').delete().eq('id', id);
  if (error) throw error;
}

// ===================== Audio Generation Records =====================
export async function getAudioGenerationRecords(projectId?: string, limit = 50): Promise<AudioGenerationRecord[]> {
  let query = db.from('audio_generation_records').select('*, result_asset:assets(*), voice_profile:voice_profiles(*)').order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function generateTts(params: {
  project_id?: string;
  storyboard_id?: string;
  model_catalog_id: string;
  voice_profile_id?: string;
  voice_id?: string;
  text: string;
  params?: Record<string, unknown>;
  save_to_assets?: boolean;
}): Promise<{ record: AudioGenerationRecord; asset?: Asset }> {
  const { data, error } = await db.functions.invoke('audio-tts', { body: params });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message);
  }
  return data as { record: AudioGenerationRecord; asset?: Asset };
}

export interface AudioProviderTestResult {
  ok: boolean;
  provider: string;
  network: 'reachable' | 'timeout' | 'error';
  error_type?: 'connect_timeout' | 'upstream_401' | 'upstream_error' | 'network' | 'auth' | 'not_found';
  status_code?: number;
  message: string;
  latency_ms?: number;
  api_credit?: unknown;
  test_url?: string;
}

export async function testAudioProvider(provider = 'fish_audio', api_config_id?: string): Promise<AudioProviderTestResult> {
  // 优先使用带 Key 的鉴权测试（模式 B），更能确认是网络问题还是 Key 问题
  const body = api_config_id
    ? { api_config_id }
    : { provider };
  const { data, error } = await db.functions.invoke('audio-provider-test', { body });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message);
  }
  return data as AudioProviderTestResult;
}

export interface SyncVoicesResult {
  synced: number;
  added: number;
  updated: number;
}

export interface SyncVoicesError {
  error: string;
  errorType?: string;
}

// ===================== MiniMax TTS (Platform-managed) - REMOVED =====================

export async function bindStoryboardAudio(
  storyboardId: string,
  assetId: string | null,
  type: 'voiceover' | 'dialogue',
): Promise<void> {
  const col = type === 'voiceover' ? 'voiceover_asset_id' : 'dialogue_asset_id';
  const { error } = await db
    .from('storyboards')
    .update({ [col]: assetId, updated_at: new Date().toISOString() })
    .eq('id', storyboardId);
  if (error) throw error;
}

export async function syncFishVoices(api_config_id: string): Promise<SyncVoicesResult> {
  const { data, error } = await db.functions.invoke('fish-sync-voices', {
    body: { api_config_id },
  });
  // HTTP 层面错误（401/403 等）
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message);
  }
  // EF 返回 { error, errorType }
  if (data?.error) {
    const err = new Error(data.error) as Error & { errorType?: string };
    err.errorType = data.errorType;
    throw err;
  }
  return data as SyncVoicesResult;
}

export async function createFishVoice(params: {
  api_config_id: string;
  name: string;
  audio: File;
  reference_text?: string;
  language?: string;
  tags?: string;
  visibility?: string;
}): Promise<VoiceProfile> {
  const form = new FormData();
  form.append('api_config_id', params.api_config_id);
  form.append('name', params.name);
  form.append('audio', params.audio, params.audio.name);
  if (params.reference_text) form.append('reference_text', params.reference_text);
  if (params.language) form.append('language', params.language);
  if (params.tags) form.append('tags', params.tags);
  if (params.visibility) form.append('visibility', params.visibility);

  const { data, error } = await db.functions.invoke('fish-create-voice', { body: form });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message);
  }
  const result = data as { voice_profile: VoiceProfile };
  return result.voice_profile;
}

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
}

export interface AsrResult {
  text: string;
  segments: AsrSegment[];
  duration: number;
}

export async function transcribeAudio(params: {
  api_config_id: string;
  audio: File;
  language?: string;
  project_id?: string;
}): Promise<AsrResult> {
  const form = new FormData();
  form.append('api_config_id', params.api_config_id);
  form.append('audio', params.audio, params.audio.name);
  if (params.language) form.append('language', params.language);
  if (params.project_id) form.append('project_id', params.project_id);

  const { data, error } = await db.functions.invoke('audio-asr', { body: form });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message);
  }
  return data as AsrResult;
}

export async function convertVoice(params: {
  api_config_id: string;
  audio: File;
  voice_profile_id?: string;
  voice_id?: string;
  project_id?: string;
}): Promise<{ asset?: { id: string; file_url?: string }; audio_url?: string }> {
  const form = new FormData();
  form.append('api_config_id', params.api_config_id);
  form.append('audio', params.audio, params.audio.name);
  if (params.voice_profile_id) form.append('voice_profile_id', params.voice_profile_id);
  if (params.voice_id)         form.append('voice_id', params.voice_id);
  if (params.project_id)       form.append('project_id', params.project_id);

  const { data, error } = await db.functions.invoke('audio-voice-conversion', { body: form });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message);
  }
  return data as { asset?: { id: string; file_url?: string }; audio_url?: string };
}
