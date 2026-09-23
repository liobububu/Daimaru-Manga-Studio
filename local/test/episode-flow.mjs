import assert from 'node:assert/strict';
import episodeFlow from '../../shared/episode-flow.js';
const { episodeNumber, sortEpisodes, nextEpisodeNumber, parseEpisodeOutlines, firstIncompleteScript, clipStoryboardBinding, rebindTimelineMedia, videoTaskResultAssetId, videoTaskUpdateTarget, findExistingVideoTaskAsset, videoTaskWritebackContext, videoTaskBelongsToProject, mediaWorkKey, mediaWorkIsCurrent, storyboardLoadKey, storyboardLoadIsCurrent, resolveEpisodeStage, resolveProjectStage } = episodeFlow;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
console.log('\n分集跨集归属');

test('缺号/跳号严格按真实集号排序，不按数据库返回顺序', () => {
  const scripts = sortEpisodes([
    { id: 'e7', episode_number: 7, title: '第7集' },
    { id: 'e1', episode_number: 1, title: '第1集' },
    { id: 'e3', episode_number: 3, title: '第3集' },
  ]);
  assert.deepEqual(scripts.map(x => x.id), ['e1', 'e3', 'e7']);
  assert.equal(scripts[scripts.findIndex(x => x.id === 'e1') + 1].id, 'e3');
});

test('显式 episode_number 优先于标题，历史中文标题仍可识别', () => {
  assert.equal(episodeNumber({ episode_number: 4, title: '第99集' }), 4);
  assert.equal(episodeNumber({ title: '第二十五集' }), 25);
});

test('跳号后新建集使用最大真实集号 + 1，不填补历史空洞', () => {
  assert.equal(nextEpisodeNumber([{ episode_number: 1 }, { episode_number: 3 }, { episode_number: 7 }]), 8);
});

test('多集大纲解析为完整的集级骨架', () => {
  const items = parseEpisodeOutlines('第1集：开端\n第一集冲突\n第2集：升级\n第二集冲突\n第3集：反转');
  assert.deepEqual(items.map(x => x.episode_number), [1, 2, 3]);
  assert.equal(items[1].episode_outline, '升级\n第二集冲突');
});

test('多集大纲允许跳号但保持真实集号，不擅自补洞', () => {
  const items = parseEpisodeOutlines('第1集：A\n第3集：C\n第7集：G');
  assert.deepEqual(items.map(x => x.episode_number), [1, 3, 7]);
});

test('多集大纲拒绝重复集号，避免创建两个同集 Script', () => {
  assert.throws(() => parseEpisodeOutlines('第1集：A\n第2集：B\n第2集：B2'), /重复集号/);
});

test('首页续作锁定第一个 content 为空的集，不受数据库返回顺序影响', () => {
  const target = firstIncompleteScript([
    { id: 'e4', episode_number: 4, content: '' },
    { id: 'e2', episode_number: 2, content: '第2集正文' },
    { id: 'e3', episode_number: 3, content: '   ' },
    { id: 'e1', episode_number: 1, content: '第1集正文' },
  ]);
  assert.equal(target?.id, 'e3');
});

test('后续空集不会越过更早的未完成集', () => {
  const scripts = [
    { id: 'e1', episode_number: 1, content: '完成' },
    { id: 'e2', episode_number: 2, content: '' },
    { id: 'e3', episode_number: 3, content: '提前生成的正文' },
    { id: 'e4', episode_number: 4, content: '' },
  ];
  assert.equal(firstIncompleteScript(scripts)?.id, 'e2');
});

test('1-N 全部已有正文时不存在待写剧本集', () => {
  assert.equal(firstIncompleteScript([
    { id: 'e1', episode_number: 1, content: 'A' },
    { id: 'e2', episode_number: 2, content: 'B' },
    { id: 'e3', episode_number: 3, content: 'C' },
  ]), null);
});

const usableIds = new Set(['i1', 'v1', 'a1', 'i2']);
const usable = id => !!id && usableIds.has(id);
const script = { id: 'e3', episode_number: 3 };

test('部分完成：缺视频时仍归属当前集并进入视频阶段', () => {
  const result = resolveEpisodeStage(script, [{ id: 's31', script_id: 'e3', image_asset_id: 'i1' }], usable);
  assert.equal(result.stage, 'video'); assert.equal(result.script.id, 'e3'); assert.equal(result.shot.id, 's31');
});

test('部分完成：图片视频齐全但必需音频缺失时进入音频阶段', () => {
  const result = resolveEpisodeStage(script, [{ id: 's31', script_id: 'e3', image_asset_id: 'i1', video_asset_id: 'v1', voiceover: '旁白' }], usable);
  assert.equal(result.stage, 'audio'); assert.equal(result.script.id, 'e3');
});

test('视频已有效时源图片丢失不让整集倒退到图片阶段', () => {
  const result = resolveEpisodeStage(script, [{ id: 's31', script_id: 'e3', image_asset_id: 'deleted-image', video_asset_id: 'v1' }], usable);
  assert.equal(result.stage, 'complete');
});

test('视频缺失且源图片不可用时仍应先补图片', () => {
  const result = resolveEpisodeStage(script, [{ id: 's31', script_id: 'e3', image_asset_id: 'deleted-image' }], usable);
  assert.equal(result.stage, 'image');
});

test('混合镜头中已有视频的缺图镜头不阻塞真正待补视频镜头', () => {
  const result = resolveEpisodeStage(script, [
    { id: 's31', script_id: 'e3', image_asset_id: 'deleted-image', video_asset_id: 'v1' },
    { id: 's32', script_id: 'e3', image_asset_id: 'i2' },
  ], usable);
  assert.equal(result.stage, 'video'); assert.equal(result.shot.id, 's32');
});

test('当前集完整时才允许进入 complete', () => {
  const result = resolveEpisodeStage(script, [{ id: 's31', script_id: 'e3', image_asset_id: 'i1', video_asset_id: 'v1', voiceover: '旁白', voiceover_asset_id: 'a1' }], usable);
  assert.equal(result.stage, 'complete');
});

test('首页优先补前集分镜，不会因后集 content 为空而跳集', () => {
  const scripts = [{ id: 'e2', episode_number: 2, content: '' }, { id: 'e1', episode_number: 1, content: '正文' }];
  const result = resolveProjectStage(scripts, { e1: [] }, usable);
  assert.equal(result.stage, 'storyboard'); assert.equal(result.script.id, 'e1');
});

test('首页乱序返回时仍优先补前集视频，不进入后集空剧本', () => {
  const scripts = [{ id: 'e4', episode_number: 4, content: '' }, { id: 'e1', episode_number: 1, content: '正文' }, { id: 'e3', episode_number: 3, content: '' }];
  const result = resolveProjectStage(scripts, { e1: [{ id: 's11', image_asset_id: 'i1' }] }, usable);
  assert.equal(result.stage, 'video'); assert.equal(result.script.id, 'e1');
});

test('首页缺号场景按真实集序优先补前集音频', () => {
  const scripts = [{ id: 'e7', episode_number: 7, content: '' }, { id: 'e3', episode_number: 3, content: '正文' }, { id: 'e1', episode_number: 1, content: '正文' }];
  const shots = {
    e1: [{ id: 's11', image_asset_id: 'i1', video_asset_id: 'v1' }],
    e3: [{ id: 's31', image_asset_id: 'i1', video_asset_id: 'v1', dialogue: '对白' }],
  };
  const result = resolveProjectStage(scripts, shots, usable);
  assert.equal(result.stage, 'audio'); assert.equal(result.script.id, 'e3');
});

test('前集完整后才进入后续第一个 content 为空的集', () => {
  const scripts = [{ id: 'e5', episode_number: 5, content: '' }, { id: 'e2', episode_number: 2, content: '正文' }, { id: 'e1', episode_number: 1, content: '正文' }];
  const completeShot = [{ image_asset_id: 'i1', video_asset_id: 'v1' }];
  const result = resolveProjectStage(scripts, { e1: completeShot, e2: completeShot }, usable);
  assert.equal(result.stage, 'script'); assert.equal(result.script.id, 'e5');
});

test('项目重开：分镜必须按真实集序加载，数据库乱序不能让前集被误判为缺分镜', () => {
  const raw = [
    { id: 'e3', episode_number: 3, content: '正文' },
    { id: 'e1', episode_number: 1, content: '正文' },
    { id: 'e2', episode_number: 2, content: '正文' },
  ];
  const ordered = sortEpisodes(raw);
  assert.deepEqual(ordered.map(item => item.id), ['e1', 'e2', 'e3']);
  const completeShot = [{ image_asset_id: 'i1', video_asset_id: 'v1' }];
  const shotsByScript = { e1: completeShot, e2: [{ image_asset_id: 'i1' }] };
  const result = resolveProjectStage(ordered, shotsByScript, usable);
  assert.equal(result.stage, 'video'); assert.equal(result.script.id, 'e2');
});

console.log('\n项目重开断点续作');
const reopenScripts = [
  { id: 'e1', episode_number: 1, content: '第一集正文' },
  { id: 'e2', episode_number: 2, content: '第二集正文' },
  { id: 'e3', episode_number: 3, content: '' },
];
const doneShot = { id: 'e1s1', script_id: 'e1', image_asset_id: 'i1', video_asset_id: 'v1' };
const resumeQueue = (stage, shots) => stage === 'image'
  ? shots.filter(item => !usable(item.video_asset_id) && !usable(item.image_asset_id)).map(item => item.id)
  : stage === 'video'
    ? shots.filter(item => !usable(item.video_asset_id) && usable(item.image_asset_id)).map(item => item.id)
    : [];

test('项目重开停在剧本：前集完成后恢复到最早空正文集，不误进后续阶段', () => {
  const result = resolveProjectStage(reopenScripts, { e1: [doneShot], e2: [{ ...doneShot, id: 'e2s1', script_id: 'e2' }] }, usable);
  assert.equal(result.stage, 'script'); assert.equal(result.script.id, 'e3'); assert.deepEqual(resumeQueue(result.stage, []), []);
});

test('项目重开停在分镜：恢复到正确集且待办队列为空', () => {
  const scripts = reopenScripts.slice(0, 2);
  const result = resolveProjectStage(scripts, { e1: [doneShot], e2: [] }, usable);
  assert.equal(result.stage, 'storyboard'); assert.equal(result.script.id, 'e2'); assert.deepEqual(resumeQueue(result.stage, []), []);
});

test('项目重开停在图片：恢复到首个缺图镜头，队列只含缺视频且缺图的当前集镜头', () => {
  const shots = [
    { id: 'e2s1', image_asset_id: 'missing-image' },
    { id: 'e2s2', image_asset_id: 'i2' },
    { id: 'e2s3', image_asset_id: 'missing-old-image', video_asset_id: 'v1' },
  ];
  const result = resolveProjectStage(reopenScripts.slice(0, 2), { e1: [doneShot], e2: shots }, usable);
  assert.equal(result.stage, 'image'); assert.equal(result.script.id, 'e2'); assert.equal(result.shot.id, 'e2s1');
  assert.deepEqual(resumeQueue('image', shots), ['e2s1']);
});

test('项目重开停在视频：恢复到首个缺视频镜头，队列只含已有有效图片的待视频镜头', () => {
  const shots = [
    { id: 'e2s1', image_asset_id: 'i2' },
    { id: 'e2s2', image_asset_id: 'i1' },
    { id: 'e2s3', image_asset_id: 'deleted-image', video_asset_id: 'v1' },
  ];
  const result = resolveProjectStage(reopenScripts.slice(0, 2), { e1: [doneShot], e2: shots }, usable);
  assert.equal(result.stage, 'video'); assert.equal(result.script.id, 'e2'); assert.equal(result.shot.id, 'e2s1');
  assert.deepEqual(resumeQueue('video', shots), ['e2s1', 'e2s2']);
});

test('项目重开停在音频：视频完成后恢复到首个缺必需音频镜头，不生成图片/视频待办', () => {
  const shots = [
    { id: 'e2s1', image_asset_id: 'i1', video_asset_id: 'v1', voiceover: '旁白', voiceover_asset_id: 'missing-audio' },
    { id: 'e2s2', image_asset_id: 'i2', video_asset_id: 'v1', dialogue: '对白', dialogue_asset_id: 'a1' },
  ];
  const result = resolveProjectStage(reopenScripts.slice(0, 2), { e1: [doneShot], e2: shots }, usable);
  assert.equal(result.stage, 'audio'); assert.equal(result.script.id, 'e2'); assert.equal(result.shot.id, 'e2s1');
  assert.deepEqual(resumeQueue('audio', shots), []);
});

test('项目重开停在剪辑：所有生产素材完整后恢复最后完成集进入剪辑，不跳到错误集', () => {
  const scripts = reopenScripts.slice(0, 2);
  const e2Shot = { id: 'e2s1', image_asset_id: 'i2', video_asset_id: 'v1', voiceover: '旁白', voiceover_asset_id: 'a1' };
  const result = resolveProjectStage(scripts, { e1: [doneShot], e2: [e2Shot] }, usable);
  assert.equal(result.stage, 'complete'); assert.equal(result.script.id, 'e2'); assert.deepEqual(resumeQueue(result.stage, [e2Shot]), []);
});

test('分镜加载：项目级旧请求不得覆盖当前 Script 分镜', () => {
  const oldRequest = storyboardLoadKey('p1', '');
  assert.equal(storyboardLoadIsCurrent(oldRequest, 'p1', 'e2'), false);
});

test('分镜加载：切换集后前一集迟到响应不得覆盖当前集', () => {
  const episode1Request = storyboardLoadKey('p1', 'e1');
  assert.equal(storyboardLoadIsCurrent(episode1Request, 'p1', 'e2'), false);
  assert.equal(storyboardLoadIsCurrent(storyboardLoadKey('p1', 'e2'), 'p1', 'e2'), true);
});

test('分镜加载：切换项目后同名 Script 也不得串数据', () => {
  const oldProjectRequest = storyboardLoadKey('p1', 'e1');
  assert.equal(storyboardLoadIsCurrent(oldProjectRequest, 'p2', 'e1'), false);
});

test('图片/视频队列：切到下一镜后上一镜迟到响应不得覆盖当前镜', () => {
  const oldKey = mediaWorkKey('p1', 's11', ['s11', 's12']);
  assert.equal(mediaWorkIsCurrent(oldKey, 'p1', 's12', ['s11', 's12']), false);
});

test('图片/视频队列：跨集切换后旧集响应不得覆盖新集', () => {
  const episode1Key = mediaWorkKey('p1', 'e1s1', ['e1s1', 'e1s2']);
  assert.equal(mediaWorkIsCurrent(episode1Key, 'p1', 'e2s1', ['e2s1', 'e2s2']), false);
});

test('图片/视频队列：同镜头但队列上下文改变也视为旧请求', () => {
  const oldQueue = mediaWorkKey('p1', 's11', ['s11', 's12']);
  assert.equal(mediaWorkIsCurrent(oldQueue, 'p1', 's11', ['s11', 's13']), false);
});

test('视频轮询：切换项目后完成结果仍写回任务原始 project_id', () => {
  const task = { id: 't1', project_id: 'p1', storyboard_id: 's11' };
  assert.deepEqual(videoTaskWritebackContext(task), { project_id: 'p1', storyboard_id: 's11' });
  assert.equal(videoTaskBelongsToProject(task, 'p2'), false);
});

test('视频轮询：切换集或镜头不改变任务原始 storyboard_id', () => {
  const task = { id: 't2', project_id: 'p1', storyboard_id: 'e1s3' };
  assert.equal(videoTaskWritebackContext(task).storyboard_id, 'e1s3');
  assert.notEqual(videoTaskWritebackContext(task).storyboard_id, 'e2s1');
});

test('视频轮询：无 storyboard 的项目级任务只落项目，不凭当前页面补绑镜头', () => {
  const task = { id: 't3', project_id: 'p1' };
  assert.deepEqual(videoTaskWritebackContext(task), { project_id: 'p1', storyboard_id: undefined });
});

test('视频轮询：超时后重试仍更新同一个原始 task.id', () => {
  const task = { id: 'timeout-task', project_id: 'p1', storyboard_id: 's1', status: 'timeout' };
  assert.equal(videoTaskUpdateTarget(task), 'timeout-task');
  const retried = { ...task, status: 'submitted', polling_retry_count: 0 };
  assert.equal(videoTaskUpdateTarget(retried), 'timeout-task');
});

test('视频轮询：重复完成回调优先复用 task.result_asset_id，不重复创建 Asset', () => {
  const task = { id: 't4', project_id: 'p1', storyboard_id: 's1', result_asset_id: 'a1' };
  const assets = [{ id: 'a1', project_id: 'p1', storyboard_id: 's1', asset_type: 'video', file_url: 'video.mp4' }];
  assert.equal(findExistingVideoTaskAsset(task, assets, 'video.mp4')?.id, 'a1');
});

test('视频轮询：页面刷新后 task 尚未记 result_asset_id 时按原始归属和 URL 找回已有 Asset', () => {
  const task = { id: 't5', project_id: 'p1', storyboard_id: 's1' };
  const assets = [
    { id: 'wrong-project', project_id: 'p2', storyboard_id: 's1', asset_type: 'video', file_url: 'video.mp4' },
    { id: 'wrong-shot', project_id: 'p1', storyboard_id: 's2', asset_type: 'video', file_url: 'video.mp4' },
    { id: 'existing', project_id: 'p1', storyboard_id: 's1', asset_type: 'video', file_url: 'video.mp4' },
  ];
  assert.equal(findExistingVideoTaskAsset(task, assets, 'video.mp4')?.id, 'existing');
});

test('视频轮询：不同 URL 不得误复用旧 Asset', () => {
  const task = { id: 't6', project_id: 'p1', storyboard_id: 's1' };
  const assets = [{ id: 'old', project_id: 'p1', storyboard_id: 's1', asset_type: 'video', file_url: 'old.mp4' }];
  assert.equal(findExistingVideoTaskAsset(task, assets, 'new.mp4'), undefined);
});

test('视频轮询并发：同一个 task.id 的两个 completed 回调使用同一个确定性 Asset ID', () => {
  const task = { id: 'same-task', project_id: 'p1', storyboard_id: 's1' };
  const callbackA = videoTaskResultAssetId(task);
  const callbackB = videoTaskResultAssetId({ ...task });
  assert.equal(callbackA, 'video-task-same-task');
  assert.equal(callbackA, callbackB);
});

test('视频轮询并发：两个轮询实例刷新后仍收敛到同一 Asset 与同一 storyboard 绑定', () => {
  const task = { id: 'shared-task', project_id: 'p1', storyboard_id: 's1' };
  const deterministicId = videoTaskResultAssetId(task);
  const afterFirst = [{ id: deterministicId, project_id: 'p1', storyboard_id: 's1', asset_type: 'video', file_url: 'done.mp4' }];
  const secondInstanceAsset = findExistingVideoTaskAsset(task, afterFirst, 'done.mp4');
  assert.equal(secondInstanceAsset?.id, deterministicId);
  assert.deepEqual(videoTaskWritebackContext(task), { project_id: 'p1', storyboard_id: 's1' });
  assert.equal(videoTaskUpdateTarget(task), 'shared-task');
});

test('剪辑方案重绑：旧 Asset ID 与旧 URL 自动切到镜头最新视频且保留人工剪辑参数', () => {
  const old = { id: 'tl1', tracks: [{ id: 'v1', clips: [{ id: 'shot_s1_visual', type: 'video', assetId: 'old-v', src: 'old.mp4', start: 7, duration: 3, sourceStart: 1.25, speed: 0.8, muted: true, volume: 0.4 }] }] };
  const result = rebindTimelineMedia(old, [{ id: 's1', video_asset_id: 'new-v' }], [{ id: 'new-v', file_url: 'new.mp4' }]);
  const clip = result.timeline.tracks[0].clips[0];
  assert.equal(result.changed, true); assert.equal(clip.assetId, 'new-v'); assert.equal(clip.src, 'new.mp4');
  assert.equal(clip.start, 7); assert.equal(clip.duration, 3); assert.equal(clip.sourceStart, 1.25); assert.equal(clip.speed, 0.8); assert.equal(clip.muted, true); assert.equal(clip.volume, 0.4);
});

test('剪辑方案重绑：旧版旁白 clip 可从稳定 clip id 恢复 storyboard 归属并换最新音频', () => {
  assert.deepEqual(clipStoryboardBinding({ id: 'shot_s2_旁白' }), { storyboardId: 's2', role: 'voiceover' });
  const old = { tracks: [{ clips: [{ id: 'shot_s2_旁白', assetId: 'a-old', src: 'old.wav', start: 2, duration: 4 }] }] };
  const result = rebindTimelineMedia(old, [{ id: 's2', voiceover_asset_id: 'a-new' }], [{ id: 'a-new', file_url: 'new.wav' }]);
  assert.equal(result.timeline.tracks[0].clips[0].src, 'new.wav');
});

test('剪辑方案重绑：手工添加且无 storyboard 归属的 clip 不得擅自替换', () => {
  const old = { tracks: [{ clips: [{ id: 'manual1', assetId: 'old', src: 'manual.mp4' }] }] };
  const result = rebindTimelineMedia(old, [{ id: 's1', video_asset_id: 'new' }], [{ id: 'new', file_url: 'new.mp4' }]);
  assert.equal(result.changed, false); assert.equal(result.timeline, old);
});

console.log(`全部通过：${passed} 通过 / 0 失败`);
