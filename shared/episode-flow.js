function chineseNumber(value) {
  const digits = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  if (!value) return null;
  if (!/[十百]/.test(value)) return [...value].reduce((n, char) => n * 10 + (digits[char] ?? 0), 0) || null;
  let total = 0, current = 0;
  for (const char of value) {
    if (char in digits) current = digits[char];
    else if (char === '十') { total += (current || 1) * 10; current = 0; }
    else if (char === '百') { total += (current || 1) * 100; current = 0; }
  }
  return total + current || null;
}

function episodeNumber(script) {
  if (Number.isFinite(script?.episode_number) && Number(script.episode_number) > 0) return Number(script.episode_number);
  const title = script?.title || '';
  const numbered = title.match(/第\s*(\d+)\s*[集话章]/) || title.match(/(?:^|\D)(\d+)\s*[集话章]/);
  if (numbered) return Number(numbered[1]);
  const chinese = title.match(/第\s*([零〇一二两三四五六七八九十百]+)\s*[集话章]/);
  if (chinese) return chineseNumber(chinese[1]);
  const digits = title.match(/(?:^|\D)(\d+)(?:\D|$)/);
  return digits ? Number(digits[1]) : null;
}

function sortEpisodes(items) {
  return [...items].sort((a, b) => {
    const an = episodeNumber(a), bn = episodeNumber(b);
    if (an !== null && bn !== null && an !== bn) return an - bn;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    const created = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    return created || String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function nextEpisodeNumber(items) {
  return Math.max(0, ...items.map(item => episodeNumber(item) || 0)) + 1;
}

function parseEpisodeOutlines(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];
  const marker = /(?:^|\n)\s*(?:#{1,6}\s*)?第\s*(\d+|[零〇一二两三四五六七八九十百]+)\s*[集话章]\s*[：:、.\-]\s*/g;
  const matches = [...source.matchAll(marker)];
  if (!matches.length) throw new Error('未识别到“第N集/话/章”格式的分集大纲');
  const seen = new Set();
  return matches.map((match, index) => {
    const raw = match[1];
    const number = /^\d+$/.test(raw) ? Number(raw) : chineseNumber(raw);
    if (!number || number < 1) throw new Error(`无效集号：${raw}`);
    if (seen.has(number)) throw new Error(`分集大纲存在重复集号：第${number}集`);
    seen.add(number);
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const outline = source.slice(start, end).trim();
    if (!outline) throw new Error(`第${number}集大纲为空`);
    return { episode_number: number, episode_outline: outline, title: `第${number}集` };
  }).sort((a, b) => a.episode_number - b.episode_number);
}

function firstIncompleteScript(items) {
  return sortEpisodes(items).find(script => !String(script?.content || '').trim()) || null;
}

function resolveProjectStage(items, shotsByScript, usable) {
  for (const script of sortEpisodes(items)) {
    if (!String(script?.content || '').trim()) return { stage: 'script', script };
    const shots = typeof shotsByScript === 'function' ? shotsByScript(script) : (shotsByScript?.[script.id] || []);
    const result = resolveEpisodeStage(script, shots || [], usable);
    if (result.stage !== 'complete') return result;
  }
  const scripts = sortEpisodes(items);
  return { stage: 'complete', script: scripts[scripts.length - 1] };
}

function videoTaskResultAssetId(task) {
  const id = String(task?.id || '').trim();
  return id ? `video-task-${id}` : '';
}

function videoTaskUpdateTarget(task) {
  return String(task?.id || '');
}

function findExistingVideoTaskAsset(task, assets, videoUrl) {
  if (task?.result_asset_id) {
    const byId = (assets || []).find(asset => String(asset?.id || '') === String(task.result_asset_id));
    if (byId) return byId;
  }
  if (!videoUrl) return undefined;
  return (assets || []).find(asset => asset?.asset_type === 'video'
    && String(asset?.project_id || '') === String(task?.project_id || '')
    && String(asset?.storyboard_id || '') === String(task?.storyboard_id || '')
    && String(asset?.file_url || '') === String(videoUrl));
}

function videoTaskWritebackContext(task) {
  return { project_id: String(task?.project_id || ''), storyboard_id: task?.storyboard_id ? String(task.storyboard_id) : undefined };
}

function videoTaskBelongsToProject(task, projectId) {
  return String(task?.project_id || '') === String(projectId || '');
}

function mediaWorkKey(projectId, storyboardId, queueIds) {
  return `${String(projectId || '')}::${String(storyboardId || '')}::${Array.isArray(queueIds) ? queueIds.join('|') : ''}`;
}

function mediaWorkIsCurrent(requestKey, projectId, storyboardId, queueIds) {
  return requestKey === mediaWorkKey(projectId, storyboardId, queueIds);
}

function storyboardLoadKey(projectId, scriptId) {
  return `${String(projectId || '')}::${String(scriptId || '')}`;
}

function storyboardLoadIsCurrent(requestKey, projectId, scriptId) {
  return requestKey === storyboardLoadKey(projectId, scriptId);
}

function clipStoryboardBinding(clip) {
  if (clip?.storyboardId) return { storyboardId: String(clip.storyboardId), role: clip.mediaRole || '' };
  const match = String(clip?.id || '').match(/^shot_(.+)_(visual|旁白|对白)$/);
  if (!match) return null;
  return { storyboardId: match[1], role: match[2] === 'visual' ? 'visual' : match[2] === '旁白' ? 'voiceover' : 'dialogue' };
}

function rebindTimelineMedia(timeline, storyboards, assets) {
  const byShot = new Map((storyboards || []).map(shot => [String(shot.id), shot]));
  const byAsset = new Map((assets || []).map(asset => [String(asset.id), asset]));
  let changed = false;
  const tracks = (timeline?.tracks || []).map(track => ({ ...track, clips: (track.clips || []).map(clip => {
    const binding = clipStoryboardBinding(clip);
    if (!binding) return clip;
    const shot = byShot.get(binding.storyboardId);
    if (!shot) return clip;
    const targetId = binding.role === 'voiceover' ? shot.voiceover_asset_id
      : binding.role === 'dialogue' ? shot.dialogue_asset_id
      : (shot.video_asset_id || shot.image_asset_id);
    const asset = targetId ? byAsset.get(String(targetId)) : undefined;
    if (!asset?.file_url) return clip;
    if (String(clip.assetId || '') === String(asset.id) && String(clip.src || '') === String(asset.file_url)) return clip;
    changed = true;
    return { ...clip, assetId: asset.id, src: asset.file_url, storyboardId: binding.storyboardId, mediaRole: binding.role };
  }) }));
  return { timeline: changed ? { ...timeline, tracks } : timeline, changed };
}

function resolveEpisodeStage(script, shots, usable) {
  if (!script) return { stage: 'script' };
  if (!shots.length) return { stage: 'storyboard', script };
  const video = shots.find(shot => !usable(shot.video_asset_id));
  if (video) {
    if (!usable(video.image_asset_id)) return { stage: 'image', script, shot: video };
    return { stage: 'video', script, shot: video };
  }
  const audio = shots.find(shot => (!!shot.voiceover?.trim() && !usable(shot.voiceover_asset_id)) || (!!shot.dialogue?.trim() && !usable(shot.dialogue_asset_id)));
  if (audio) return { stage: 'audio', script, shot: audio };
  return { stage: 'complete', script };
}

module.exports = { episodeNumber, sortEpisodes, nextEpisodeNumber, parseEpisodeOutlines, firstIncompleteScript, videoTaskResultAssetId, videoTaskUpdateTarget, findExistingVideoTaskAsset, videoTaskWritebackContext, videoTaskBelongsToProject, mediaWorkKey, mediaWorkIsCurrent, storyboardLoadKey, storyboardLoadIsCurrent, clipStoryboardBinding, rebindTimelineMedia, resolveEpisodeStage, resolveProjectStage };
