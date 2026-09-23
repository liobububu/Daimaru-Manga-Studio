/**
 * 模型能力判断规则 —— 前端展示与服务端同步模型共用这一份。
 *
 * 为什么单独放一个文件：之前前端（src/services/api.ts）和服务端
 * （local/routes/ai.js）各写了一版，规则还不完全一样。后果是同一个模型
 * 前端显示「能生成视频」、服务端同步进来却存成文本模型 —— 功能直接废掉，
 * 而且不报错，只是按钮灰着或者点了没反应。
 *
 * 注意：这里是 CommonJS 而不是 JSON，因为服务端要打进单文件 exe，
 * 打包脚本只认 JS 模块，require 一个 .json 在打包后取不到。
 *
 * 规则按顺序全部匹配，命中的能力累加；一条都没命中则返回 default。
 * 改成 TS 类型的话记得同步 shared/capability-rules.d.ts。
 */
module.exports = {
  rules: [
    { p: 'dall|image|flux|stable-?diffusion|sd(xl)?[-_]|midjourney|ideogram|kolors|seedream|imagen|recraft|playground|pixart|hidream|qwen[-_]?image|nano[-_]?banana', caps: ['image_generation'] },
    { p: 'video|kling|runway|pika|seedance|^wan([-. _]|$)|sora|gen[-_]?\d|animate|minimax[-_]?h\\d|hailuo|veo([-. _]|$)|hunyuan[-_]?video|ltx[-_]?video|cogvideo|mochi[-_]?\d', caps: ['video_generation'] },
    { p: 'tts|voice|audio-gen|speech-?synth|text-?to-?speech', caps: ['audio_generation'] },
    { p: 'whisper|asr|speech-?to-?text|sensevoice|fun-?asr', caps: ['audio_recognition'] },
    { p: 'vision|[-_]vl|multimodal|mmx', caps: ['multimodal'] },
    { p: 'edit|inpaint|outpaint|fill|kontext', caps: ['image_edit'] },
    { p: 'gpt|claude|llama|qwen|deepseek|ernie|chatglm|baichuan|gemini|mistral', caps: ['text_generation'] },
    // 这类模型不用于内容生成，留空避免被误选去生成内容
    { p: 'embedding|rerank|moderation', caps: [] },
  ],
  default: ['text_generation'],
};
