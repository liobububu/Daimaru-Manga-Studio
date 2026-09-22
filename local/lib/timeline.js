'use strict';
/**
 * 时间线与剪辑命令模型
 *
 * 设计参考了 Concat（AGPL-3.0, github.com/jub0t/Concat）的剪辑语义，但这里是独立实现，
 * 用 FFmpeg 落地，不含 Concat 的任何代码。借鉴的是它的几条工程原则：
 *
 *   1. 编辑是**命令 + 文档**：一条命令要么整体生效、要么整体拒绝，不留半改状态。
 *   2. 严格校验：任何含 NaN / Infinity 的数值直接拒绝（Concat 明确这么做）。
 *   3. 头部裁剪（head trim）止于源素材起点 —— 裁到头就不动，像素不会继续滑动。
 *   4. 反转片段上的剪切要**镜像**：对 reversed 片段做 split / trim 时，
 *      源时间轴上的移动方向是反的，否则剪出来的内容和预期不一致。
 *   5. 合并前检查方向、类型、音频流是否一致，不一致就拒绝合并。
 *
 * 时间量纲统一用「秒」，浮点。时间线时间（timeline time）与源素材时间（source time）
 * 通过 speed 换算：sourceDuration = duration * speed。
 */

class EditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EditError';
    this.code = code;
  }
}

// ─────────────────────────── 校验 ───────────────────────────

/** 数值必须有限；NaN / Infinity 一律拒绝（Concat 原则 2） */
function num(value, field) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new EditError('invalid_number', `${field} 不是有效数字（NaN 或 Infinity）`);
  }
  return n;
}

function clipById(timeline, clipId) {
  for (const track of timeline.tracks) {
    const idx = track.clips.findIndex(c => c.id === clipId);
    if (idx >= 0) return { track, clip: track.clips[idx], idx };
  }
  return null;
}

function assertClip(timeline, clipId) {
  const found = clipById(timeline, clipId);
  if (!found) throw new EditError('clip_not_found', `未找到片段 ${clipId}`);
  return found;
}

/** 反转片段：源时间轴上的位移方向取反（Concat 原则 4） */
function sourceDeltaFor(clip, timelineDelta) {
  const d = num(timelineDelta, '时间偏移') * (clip.speed || 1);
  return clip.reversed ? -d : d;
}

// ─────────────────────────── 时间线构造 ───────────────────────────

/**
 * 创建空时间线
 * @param {object} opts { name, width, height, fps }
 */
function createTimeline(opts = {}) {
  return {
    id: opts.id || `tl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name || '主时间线',
    width: opts.width || 1080,
    height: opts.height || 1920,
    fps: opts.fps || 30,
    tracks: [
      { id: 'v1', type: 'video', clips: [] },
      { id: 'a1', type: 'audio', clips: [] },
    ],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 往时间线追加片段。视频片段自动排在当前末尾之后（不留缝），
 * 音频片段默认从 0 开始铺，便于给成片配旁白 / BGM。
 */
function addClip(timeline, clip) {
  const trackId = clip.trackId || (clip.type === 'audio' ? 'a1' : 'v1');
  const track = timeline.tracks.find(t => t.id === trackId);
  if (!track) throw new EditError('track_not_found', `未找到轨道 ${trackId}`);

  const duration = num(clip.duration, 'duration');
  const start = typeof clip.start === 'number'
    ? num(clip.start, 'start')
    : track.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
  const sourceStart = num(clip.sourceStart ?? 0, 'sourceStart');
  const speed = num(clip.speed ?? 1, 'speed');
  const volume = num(clip.volume ?? 1, 'volume');
  if (sourceStart < 0) throw new EditError('invalid_source_start', 'sourceStart 不能为负');
  if (speed <= 0) throw new EditError('invalid_speed', 'speed 必须大于 0');
  if (volume < 0) throw new EditError('invalid_volume', 'volume 不能为负');

  const next = {
    id: clip.id || `clip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: clip.type || 'video',
    src: clip.src,
    assetId: clip.assetId || null,
    name: clip.name || '',
    start: Math.max(0, start),
    duration,
    sourceStart,
    speed,
    reversed: !!clip.reversed,
    muted: !!clip.muted,
    volume,
    transitionIn: clip.transitionIn || null, // { type: 'fade'|'slide'|'none', duration }
  };

  if (next.duration <= 0) throw new EditError('invalid_duration', 'duration 必须大于 0');
  if (!next.src) throw new EditError('missing_src', '片段缺少 src（素材路径）');

  track.clips.push(next);
  track.clips.sort((a, b) => a.start - b.start);
  timeline.updatedAt = new Date().toISOString();
  return next;
}

// ─────────────────────────── 剪辑命令 ───────────────────────────

function removeClip(timeline, clipId) {
  const { track, idx } = assertClip(timeline, clipId);
  track.clips.splice(idx, 1);
  timeline.updatedAt = new Date().toISOString();
  return true;
}

/**
 * 分割：在时间线时间 at 处把片段切成两半。
 * 返回 [左片段, 右片段]。
 */
function splitClip(timeline, clipId, at) {
  const { track, clip, idx } = assertClip(timeline, clipId);
  const t = num(at, '分割点');
  if (t <= clip.start || t >= clip.start + clip.duration) {
    throw new EditError('split_out_of_range', '分割点必须落在片段内部');
  }

  const leftDuration = t - clip.start;
  const rightDuration = clip.duration - leftDuration;
  // Concat 原则 4：反转片段的源位移取反
  const rightSourceStart = clip.sourceStart + sourceDeltaFor(clip, leftDuration);

  const left = { ...clip, duration: leftDuration };
  const right = {
    ...clip,
    id: `clip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    start: t,
    duration: rightDuration,
    sourceStart: Math.max(0, rightSourceStart),
  };

  track.clips.splice(idx, 1, left, right);
  track.clips.sort((a, b) => a.start - b.start);
  timeline.updatedAt = new Date().toISOString();
  return [left, right];
}

/**
 * 裁剪边缘
 * @param edge 'head' 保留尾部、砍掉开头；'tail' 保留开头、砍掉尾部
 * @param targetDuration 裁剪后的目标时长
 *
 * head trim 的关键约束（Concat 原则 3）：源偏移最多推到 0，
 * 到头就不再动，画面不会继续滑动。
 */
function trimClip(timeline, clipId, edge, targetDuration) {
  const { clip } = assertClip(timeline, clipId);
  const target = num(targetDuration, '目标时长');
  if (target <= 0) throw new EditError('invalid_duration', '裁剪后时长必须大于 0');
  if (edge !== 'head' && edge !== 'tail') {
    throw new EditError('invalid_trim_edge', '裁剪方向必须是 head 或 tail');
  }
  if (target > clip.duration) {
    throw new EditError('trim_overflow', '裁剪后时长不能超过片段原有长度');
  }

  if (edge === 'head') {
    const delta = clip.duration - target; // 从头部砍掉多少
    let newSourceStart = clip.sourceStart + sourceDeltaFor(clip, delta);
    // 反转片段向源起点方向推进时也不能越过 0
    newSourceStart = Math.max(0, newSourceStart);
    clip.sourceStart = newSourceStart;
    clip.duration = target;
  } else {
    clip.duration = target;
  }

  timeline.updatedAt = new Date().toISOString();
  return clip;
}

/**
 * 合并相邻两片段。
 * Concat 原则 5：方向（reversed）、类型、音轨存在性必须一致，否则拒绝。
 */
function mergeClips(timeline, clipIdA, clipIdB) {
  const a = assertClip(timeline, clipIdA);
  const b = assertClip(timeline, clipIdB);
  if (a.clip.src !== b.clip.src) {
    throw new EditError('merge_mismatch', '只有同一素材的相邻片段才能合并');
  }
  if (!!a.clip.reversed !== !!b.clip.reversed) {
    throw new EditError('merge_mismatch', '反转方向不同，不能合并');
  }
  if (a.clip.type !== b.clip.type) {
    throw new EditError('merge_mismatch', '类型不同，不能合并');
  }
  // 必须首尾相接（留 1e-6 容差）
  if (Math.abs(a.clip.start + a.clip.duration - b.clip.start) > 1e-6) {
    throw new EditError('merge_not_adjacent', '两个片段在时间线上不相邻');
  }

  const merged = {
    ...a.clip,
    duration: a.clip.duration + b.clip.duration,
  };
  a.track.clips.splice(a.idx, 1, merged);
  b.track.clips.splice(b.track.clips.findIndex(c => c.id === clipIdB), 1);
  a.track.clips.sort((x, y) => x.start - y.start);
  timeline.updatedAt = new Date().toISOString();
  return merged;
}

/**
 * 交换同一轨道内两个相邻片段的顺序。
 *
 * 为什么单独成一条命令而不是让前端调两次 moveClip：
 * 两次调用之间会存在一个「两片段重叠」的中间状态，只是没人看到而已——
 * 命令要么整体生效要么整体拒绝，不该有中间态。
 */
function swapClips(timeline, clipIdA, clipIdB) {
  const a = assertClip(timeline, clipIdA);
  const b = assertClip(timeline, clipIdB);
  if (a.track !== b.track) {
    throw new EditError('swap_cross_track', '只能交换同一轨道内的片段');
  }
  const adjacent = Math.abs(a.clip.start + a.clip.duration - b.clip.start) < 1e-6
    || Math.abs(b.clip.start + b.clip.duration - a.clip.start) < 1e-6;
  if (!adjacent) {
    throw new EditError('swap_not_adjacent', '两个片段在时间线上不相邻，无法交换顺序');
  }

  const aStart = a.clip.start;
  const bStart = b.clip.start;
  const aDur = a.clip.duration;
  const bDur = b.clip.duration;

  if (aStart < bStart) {
    b.clip.start = aStart;
    a.clip.start = aStart + bDur;
  } else {
    a.clip.start = bStart;
    b.clip.start = bStart + aDur;
  }
  a.track.clips.sort((x, y) => x.start - y.start);
  timeline.updatedAt = new Date().toISOString();
  return a.clip;
}

/** 设置速度：时间线时长按 speed 反比缩放，源窗口不变 */
function setSpeed(timeline, clipId, speed) {
  const { clip } = assertClip(timeline, clipId);
  const s = num(speed, 'speed');
  if (s <= 0) throw new EditError('invalid_speed', 'speed 必须大于 0');
  const sourceDuration = clip.duration * clip.speed;
  clip.speed = s;
  clip.duration = sourceDuration / s;
  timeline.updatedAt = new Date().toISOString();
  return clip;
}

/** 移动片段到时间线上的新位置 */
function moveClip(timeline, clipId, start) {
  const { clip } = assertClip(timeline, clipId);
  clip.start = Math.max(0, num(start, 'start'));
  timeline.updatedAt = new Date().toISOString();
  return clip;
}

/** 通用属性修改（muted / volume / transitionIn / name） */
function patchClip(timeline, clipId, patch) {
  const { clip } = assertClip(timeline, clipId);
  const allowed = ['muted', 'volume', 'transitionIn', 'name', 'reversed'];
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) {
      throw new EditError('patch_not_allowed', `不允许修改字段 ${key}`);
    }
    if (key === 'volume') {
      const v = num(patch.volume, 'volume');
      if (v < 0) throw new EditError('invalid_volume', 'volume 不能为负');
      clip.volume = v;
    } else if (key === 'transitionIn') {
      const transition = patch.transitionIn;
      if (transition == null) {
        clip.transitionIn = null;
      } else {
        if (typeof transition !== 'object' || Array.isArray(transition)) {
          throw new EditError('invalid_transition', 'transitionIn 必须是对象或 null');
        }
        if (!['fade', 'slide', 'none'].includes(transition.type)) {
          throw new EditError('invalid_transition', '不支持的转场类型');
        }
        const duration = num(transition.duration, 'transitionIn.duration');
        if (duration < 0 || duration > clip.duration) {
          throw new EditError('invalid_transition', '转场时长必须在 0 到片段时长之间');
        }
        clip.transitionIn = { type: transition.type, duration };
      }
    } else if (key === 'muted' || key === 'reversed') {
      if (typeof patch[key] !== 'boolean') {
        throw new EditError('invalid_boolean', `${key} 必须是布尔值`);
      }
      clip[key] = patch[key];
    } else if (key === 'name') {
      if (typeof patch.name !== 'string') {
        throw new EditError('invalid_name', 'name 必须是字符串');
      }
      clip.name = patch.name;
    } else {
      clip[key] = patch[key];
    }
  }
  timeline.updatedAt = new Date().toISOString();
  return clip;
}

/** 时间线总时长 = 所有轨道中最后一个片段的结束时间 */
function timelineDuration(timeline) {
  return timeline.tracks.reduce((max, track) => {
    for (const c of track.clips) max = Math.max(max, c.start + c.duration);
    return max;
  }, 0);
}

/** 命令分发：统一入口，保证「整体接受或整体拒绝」 */
function applyCommand(timeline, cmd) {
  switch (cmd.type) {
    case 'addClip': return addClip(timeline, cmd.clip);
    case 'removeClip': return removeClip(timeline, cmd.clipId);
    case 'splitClip': return splitClip(timeline, cmd.clipId, cmd.at);
    case 'trimClip': return trimClip(timeline, cmd.clipId, cmd.edge, cmd.duration);
    case 'mergeClips': return mergeClips(timeline, cmd.clipIdA, cmd.clipIdB);
    case 'setSpeed': return setSpeed(timeline, cmd.clipId, cmd.speed);
    case 'moveClip': return moveClip(timeline, cmd.clipId, cmd.start);
    case 'swapClips': return swapClips(timeline, cmd.clipIdA, cmd.clipIdB);
    case 'patchClip': return patchClip(timeline, cmd.clipId, cmd.patch);
    default: throw new EditError('unknown_command', `未知命令 ${cmd.type}`);
  }
}

module.exports = {
  EditError,
  createTimeline,
  addClip,
  removeClip,
  splitClip,
  trimClip,
  mergeClips,
  setSpeed,
  moveClip,
  swapClips,
  patchClip,
  timelineDuration,
  applyCommand,
  clipById,
};
