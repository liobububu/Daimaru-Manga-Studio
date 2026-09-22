'use strict';
/**
 * FFmpeg 渲染层：把时间线编译成滤镜图并导出 H.264 MP4
 *
 * 与 Concat 一样只输出 H.264 MP4 —— 这是兼容性最好的交付格式，
 * 也避免让用户在一堆编码器选项里做选择。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { appRoot } = require('./store');
const { EditError } = require('./timeline');

let cachedPath = null;

/**
 * 定位 FFmpeg，按优先级：
 *   1. 环境变量 DONGHUA_FFMPEG（调试用）
 *   2. ffmpeg-static 包（开发环境）
 *   3. 应用目录 resources/ffmpeg/（打包进 exe 的形态）
 *   4. 系统 PATH 里的 ffmpeg
 */
function findFfmpeg() {
  if (cachedPath) return cachedPath;
  if (process.env.DONGHUA_FFMPEG) return (cachedPath = process.env.DONGHUA_FFMPEG);

  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return (cachedPath = p);
  } catch { /* 未安装，继续往下找 */ }

  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = path.join(appRoot(), 'resources', 'ffmpeg', exe);
  if (fs.existsSync(bundled)) return (cachedPath = bundled);

  return (cachedPath = exe); // 交给 PATH
}

function isImage(src) {
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(src);
}

function isAudioOnly(src) {
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(src);
}

function fmt(t) {
  // FFmpeg 时间参数用固定 6 位小数，避免浮点科学计数法（1e-7 会被解析错）
  return Number(t).toFixed(6);
}

/** atempo 只接受 0.5–2.0，超出范围要拆成多次链式调用 */
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2.0) { parts.push('2.0'); s /= 2.0; }
  while (s < 0.5) { parts.push('0.5'); s /= 0.5; }
  parts.push(s.toFixed(6));
  return parts.map(p => `atempo=${p}`).join(',');
}

/** 单个片段的视频滤镜链 */
function videoFilters(clip, width, height, fps) {
  const srcDuration = clip.duration * clip.speed;
  const chain = [`trim=start=${fmt(clip.sourceStart)}:duration=${fmt(srcDuration)}`, 'setpts=PTS-STARTPTS'];
  if (clip.reversed) chain.push('reverse');
  if (Math.abs(clip.speed - 1) > 1e-6) chain.push(`setpts=PTS/${clip.speed}`);
  chain.push(
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${fps}`,
    'setsar=1',
  );
  const tr = clip.transitionIn;
  if (tr && tr.type === 'fade' && tr.duration > 0) {
    chain.push(`fade=t=in:st=0:d=${fmt(tr.duration)}`);
  }
  return chain.join(',');
}

/**
 * 图片片段的滤镜链。
 * 图片没有时间轴，trim / reverse / setpts 都没意义（且 trim 会把 -t 给的时长再截一遍），
 * 所以只做尺寸与帧率归一。
 */
function imageFilters(clip, width, height, fps) {
  const chain = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${fps}`,
    'setsar=1',
  ];
  const tr = clip.transitionIn;
  if (tr && tr.type === 'fade' && tr.duration > 0) {
    chain.push(`fade=t=in:st=0:d=${fmt(tr.duration)}`);
  }
  return chain.join(',');
}

/** 单个片段的音频滤镜链 */
function audioFilters(clip) {
  const srcDuration = clip.duration * clip.speed;
  const chain = [`atrim=start=${fmt(clip.sourceStart)}:duration=${fmt(srcDuration)}`, 'asetpts=PTS-STARTPTS'];
  if (clip.reversed) chain.push('areverse');
  if (Math.abs(clip.speed - 1) > 1e-6) chain.push(atempoChain(clip.speed));
  chain.push(`volume=${clip.muted ? 0 : clip.volume}`);
  return chain.join(',');
}

/**
 * 编译时间线为 FFmpeg 参数
 * @returns {{ args: string[], duration: number }}
 */
function buildRenderArgs(timeline, outputPath, { hasAudioOutput = true } = {}) {
  const { width, height, fps } = timeline;
  const videoTrack = timeline.tracks.find(t => t.type === 'video') || { clips: [] };
  const audioTrack = timeline.tracks.find(t => t.type === 'audio') || { clips: [] };

  const videoClips = videoTrack.clips.filter(c => !isAudioOnly(c.src));
  if (videoClips.length === 0 && audioTrack.clips.length === 0) {
    throw new EditError('empty_timeline', '时间线上没有可渲染的片段');
  }

  const inputs = [];        // 输入参数
  const filterParts = [];   // filter_complex 片段
  const videoStreams = [];  // 待拼接的视频流标签
  const audioStreams = [];
  /** 输入索引计数器：每 push 一个 -i 就自增，避免用数组长度反推（会错位） */
  let inputCount = 0;

  // ── 视频轨 ──────────────────────────────────────────────
  let cursor = 0;
  videoClips.forEach((clip, i) => {
    const gap = clip.start - cursor;
    // 片段之间有空隙时补黑帧，否则时间轴会整体前移、与预期对不上
    if (gap > 0.001) {
      const vIdx = inputCount++;
      const aIdx = inputCount++;
      inputs.push('-f', 'lavfi', '-t', fmt(gap), '-i', `color=c=black:s=${width}x${height}:r=${fps}`);
      inputs.push('-f', 'lavfi', '-t', fmt(gap), '-i', 'anullsrc=r=44100:cl=stereo');
      filterParts.push(`[${vIdx}:v]setsar=1[gap${i}v]`);
      filterParts.push(`[${aIdx}:a]anull[gap${i}a]`);
      videoStreams.push(`[gap${i}v]`);
      audioStreams.push(`[gap${i}a]`);
    }

    const idx = inputCount++;
    const img = isImage(clip.src);
    if (img) {
      inputs.push('-loop', '1', '-t', fmt(clip.duration * clip.speed), '-i', clip.src);
    } else {
      inputs.push('-i', clip.src);
    }
    filterParts.push(`[${idx}:v]${img ? imageFilters(clip, width, height, fps) : videoFilters(clip, width, height, fps)}[v${i}]`);
    videoStreams.push(`[v${i}]`);

    // 主轨自带音频：仅在独立音频轨为空时才用得上
    // 图片没有音轨；无音轨的视频要用静音补齐，否则 concat 时流数量对不上
    if (!img) {
      if (clip.hasAudio === false) {
        const aIdx = inputCount++;
        inputs.push('-f', 'lavfi', '-t', fmt(clip.duration), '-i', 'anullsrc=r=44100:cl=stereo');
        filterParts.push(`[${aIdx}:a]volume=${clip.muted ? 0 : clip.volume}[va${i}]`);
        audioStreams.push(`[va${i}]`);
      } else {
        filterParts.push(`[${idx}:a]${audioFilters(clip)}[va${i}]`);
        audioStreams.push(`[va${i}]`);
      }
    }

    cursor = clip.start + clip.duration;
  });

  // ── 独立音频轨（旁白 / BGM）──────────────────────────────
  const useSeparateAudio = audioTrack.clips.length > 0;
  const separateAudio = [];
  if (useSeparateAudio) {
    audioTrack.clips.forEach((clip, i) => {
      const idx = inputCount++;
      inputs.push('-i', clip.src);
      filterParts.push(`[${idx}:a]${audioFilters(clip)}[aa${i}]`);
      separateAudio.push(`[aa${i}]`);
    });
  }

  // ── 拼接 ────────────────────────────────────────────────
  let vOut = null;
  if (videoStreams.length === 1) {
    vOut = videoStreams[0];
  } else if (videoStreams.length > 1) {
    filterParts.push(`${videoStreams.join('')}concat=n=${videoStreams.length}:v=1:a=0[vout]`);
    vOut = '[vout]';
  }

  let aOut = null;
  const finalAudio = useSeparateAudio ? separateAudio : audioStreams;
  if (hasAudioOutput && finalAudio.length > 0) {
    if (finalAudio.length === 1) {
      aOut = finalAudio[0];
    } else {
      filterParts.push(`${finalAudio.join('')}concat=n=${finalAudio.length}:v=0:a=1[aout]`);
      aOut = '[aout]';
    }
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  args.push(...inputs);
  if (filterParts.length > 0) args.push('-filter_complex', filterParts.join(';'));
  if (vOut) args.push('-map', vOut);
  if (aOut) args.push('-map', aOut);
  if (vOut) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps));
  }
  if (aOut) args.push('-c:a', 'aac', '-b:a', '192k');
  if (vOut && aOut) args.push('-shortest');
  args.push('-movflags', '+faststart', outputPath);

  return { args, duration: cursor };
}

/**
 * 执行渲染
 * @param onProgress (percent 0-100) => void
 */
/** 取 stderr 末尾几行：FFmpeg 的原始报错比任何包装过的文案都好定位 */
function tailLines(s, n = 12) {
  const lines = s.split(/\r?\n/).filter(l => l.trim());
  return lines.slice(-n).join('\n');
}

/**
 * 渲染超时按时间线长度算，而不是一律 30 分钟。
 * 素材损坏时 FFmpeg 会反复报错又不退出，固定长超时意味着用户要干等半小时
 * 才知道失败；3 秒的片子不该等 30 分钟。
 */
function renderTimeoutMs(duration) {
  const sec = Math.min(45 * 60, Math.max(90, (duration || 0) * 20 + 120));
  return sec * 1000;
}

function render(timeline, outputPath, { onProgress, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const { args, duration } = buildRenderArgs(timeline, outputPath);
    const bin = findFfmpeg();
    const child = spawn(bin, [...args, '-progress', 'pipe:1', '-nostats'], {
      windowsHide: true,
    });

    let stderr = '';
    let finished = false;

    const timeoutMs = renderTimeoutMs(duration);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      const why = tailLines(stderr, 8);
      reject(new EditError('render_timeout',
        `渲染超时（${Math.round(timeoutMs / 1000)} 秒），已终止。` +
        (why ? `\nFFmpeg 最后的输出：\n${why}` : '')));
    }, timeoutMs);

    child.stderr.on('data', buf => {
      stderr += buf.toString();
      // 渲染是长活，卡住时需要能看到 FFmpeg 正在说什么，否则只能干等
      if (onStderr) onStderr(buf.toString());
    });

    // -progress pipe:1 输出 key=value 行，用 out_time_ms 推算百分比
    let buf = '';
    child.stdout.on('data', chunk => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const m = /^out_time_ms=(\d+)$/.exec(line.trim());
        if (m && duration > 0 && onProgress) {
          const ms = Number(m[1]);
          const pct = Math.min(99, Math.round((ms / 1000000 / duration) * 100));
          onProgress(pct);
        }
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      reject(new EditError('ffmpeg_missing',
        `无法启动 FFmpeg（${bin}）：${err.message}。请确认已安装 FFmpeg，或把 ffmpeg 放到应用目录 resources/ffmpeg/ 下。`));
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve({ outputPath, duration });
      } else {
        reject(new EditError('render_failed', `FFmpeg 退出码 ${code}：${stderr.slice(-800)}`));
      }
    });
  });
}

/**
 * 探测媒体信息：时长 + 是否含音轨
 *
 * 必须知道有没有音轨：无音轨的素材（AI 生成的片段、静音视频很常见）
 * 如果照样生成 `[0:a]atrim...` 滤镜，FFmpeg 会直接报
 * "Stream specifier ':a' ... matches no streams" 而整个导出失败。
 *
 * 用 ffmpeg 自身解析，避免依赖 ffprobe（打包时少带一个可执行文件）。
 */
function probeMedia(src) {
  return new Promise((resolve) => {
    const bin = findFfmpeg();
    const child = spawn(bin, ['-hide_banner', '-i', src, '-f', 'null', '-'], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', b => { stderr += b.toString(); });
    child.on('error', () => resolve({ duration: null, hasAudio: false }));
    child.on('close', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(stderr);
      const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
      // Stream #0:1(und): Audio: aac ...
      const hasAudio = /Stream #\d+:\d+.*:\s*Audio:/.test(stderr);
      // 顺手记下解码错误。素材损坏时渲染会卡很久才失败，
      // 提前告诉用户「哪个素材坏了」比让他等超时有用得多。
      const errors = stderr.split(/\r?\n/)
        .filter(l => /Invalid data|IEND without|Error submitting packet|moov atom not found|Invalid argument|No such file/i.test(l))
        .slice(0, 3);
      resolve({ duration, hasAudio, errors });
    });
  });
}

/** 探测媒体文件时长（秒），用于添加素材时自动填 duration */
async function probeDuration(src) {
  const info = await probeMedia(src);
  return info.duration;
}

module.exports = { findFfmpeg, buildRenderArgs, render, probeMedia, probeDuration, atempoChain, isImage, isAudioOnly };
