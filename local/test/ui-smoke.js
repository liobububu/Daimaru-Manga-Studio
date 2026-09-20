'use strict';
/**
 * 界面冒烟（CDP，零新增依赖）
 *
 * 为什么需要这一层：接口测试和逻辑测试全绿，界面仍然可能是白屏。
 * 前端一个运行时错误不会让任何接口失败，也不会让服务起不来，
 * 只会让用户打开浏览器看到一片空白 —— 这次尤其值得测，因为整个数据层
 * 从 supabase-js 换成了自己写的 local-client。
 *
 * 直接测打包出来的 exe（不是源码服务），这样能顺带发现「exe 里的前端资源是旧的」
 * 这类只在分发形态下才暴露的问题。
 *
 * 运行： node local/test/ui-smoke.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const EXE = path.join(ROOT, 'dist-exe', '动画大丸家.exe');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ───────── 找浏览器 ─────────
function findBrowser() {
  const cands = [
    process.env.NM_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return cands.find(p => fs.existsSync(p));
}

// ───────── 极简 CDP 客户端 ─────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 25000);
    });
  }

  /** 表达式包成 async 函数：里面要能写 await，且必须 awaitPromise */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async function(){ ${expr} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    }
    return r.result && r.result.value;
  }
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('未找到 Chrome / Edge，跳过界面测试（这不算失败）。');
    process.exit(0);
  }
  if (!fs.existsSync(EXE)) {
    console.log(`未找到 ${EXE}，跳过界面测试。请先 npm run build:exe。`);
    process.exit(0);
  }
  console.log(`浏览器: ${browser}`);
  console.log(`被测程序: ${EXE}\n`);

  // ───────── 启动 exe ─────────
  const appPort = 20000 + (process.pid % 10000);
  const exe = spawn(EXE, [], {
    cwd: path.dirname(EXE),
    env: { ...process.env, PORT: String(appPort), NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const APP = `http://127.0.0.1:${appPort}`;

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${APP}/api/health`); if (r.ok) { up = true; break; } } catch { /* wait */ }
    await sleep(300);
  }
  if (!up) { console.log('exe 未能启动'); exe.kill(); process.exit(1); }
  console.log('exe 已启动');

  // ───────── 启动浏览器 ─────────
  const devPort = 9400 + (process.pid % 300);
  const profileDir = path.join(os.tmpdir(), `donghua-ui-${process.pid}-${Date.now()}`);
  const chrome = spawn(browser, [
    '--headless=new',
    `--remote-debugging-port=${devPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-gpu', '--mute-audio',
    '--window-size=1440,900',
    APP,
  ], { stdio: 'ignore' });

  try {
    // ───────── 找到目标标签页（必须按 URL 挑，不能取第一个）─────────
    let target = null;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${devPort}/json/list`);
        const list = await r.json();
        const pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
        target = pages.find(t => t.url && t.url.indexOf(APP) === 0)
          || pages.find(t => t.url && t.url !== 'about:blank');
        if (target) break;
      } catch { /* wait */ }
      await sleep(300);
    }
    if (!target) throw new Error('未能连上浏览器标签页');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
      setTimeout(() => rej(new Error('WebSocket 连接超时')), 15000);
    });
    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // 未处理的 Promise 拒绝必须单独收集：CDP 的 exceptionThrown 不报它，
    // 而界面回调里的错误大多正是以 unhandledrejection 的形式静默消失
    await cdp.eval(`
      window.__rej = [];
      window.addEventListener('unhandledrejection', (e) => {
        window.__rej.push(String((e.reason && e.reason.message) || e.reason || '未知'));
      });
      window.__errs = [];
      window.addEventListener('error', (e) => { window.__errs.push(String(e.message || e)); });
      return true;
    `);

    // 等界面真正就绪：轮询关键元素，不用固定 sleep
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const ok = await cdp.eval(`
        return !!(document.querySelector('#root') && document.querySelector('#root').children.length > 0);
      `).catch(() => false);
      if (ok) { ready = true; break; }
      await sleep(250);
    }
    check('界面完成渲染（#root 有内容，非白屏）', ready);

    // 侧边栏与标题
    const title = await cdp.eval('return document.title');
    check('页面标题存在', !!title, `title=${title}`);

    const hasNav = await cdp.eval(`
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links.some(a => a.textContent && a.textContent.includes('剪辑台'));
    `);
    check('侧边栏有「剪辑台」入口', hasNav);

    // 屏幕中央点得到内容（全屏遮罩该藏没藏时会吃掉所有点击）
    const hit = await cdp.eval(`
      const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (!e) return 'nothing';
      const blocked = e.closest('[role="dialog"], .overlay, .mask');
      return blocked ? 'overlay' : 'content';
    `);
    check('屏幕中央可点击（无遮罩吃点击）', hit === 'content', `实际 ${hit}`);

    // 切到剪辑台：真实点击，断言视图真的变了
    if (hasNav) {
      await cdp.eval(`
        const a = Array.from(document.querySelectorAll('a[href]')).find(x => x.textContent.includes('剪辑台'));
        a.click();
        return true;
      `);
      let switched = false;
      for (let i = 0; i < 40; i++) {
        const ok = await cdp.eval(`
          return location.pathname === '/editor' &&
                 document.body.innerText.includes('成片输出后的内部剪辑');
        `).catch(() => false);
        if (ok) { switched = true; break; }
        await sleep(250);
      }
      check('点击后切到剪辑台且内容渲染', switched);

      const clipPanel = await cdp.eval(`
        const t = document.body.innerText;
        return t.includes('时间线') && t.includes('素材');
      `);
      check('剪辑台含时间线与素材面板', clipPanel);
    }

    // 切到模型配置页（验证 OpenAI 兼容配置界面）
    const cfgOk = await cdp.eval(`
      const a = Array.from(document.querySelectorAll('a[href]')).find(x => x.textContent.includes('模型配置'));
      if (!a) return false;
      a.click();
      return true;
    `);
    if (cfgOk) {
      let ok = false;
      for (let i = 0; i < 40; i++) {
        ok = await cdp.eval(`return location.pathname === '/model-config'`).catch(() => false);
        if (ok) break;
        await sleep(250);
      }
      check('可切到模型配置页', ok);
    }

    // 收尾：断言没有运行时错误
    const rej = await cdp.eval('return window.__rej || []');
    const errs = await cdp.eval('return window.__errs || []');
    check('无未处理的 Promise 拒绝', (rej || []).length === 0, JSON.stringify(rej));
    check('无 window error 事件', (errs || []).length === 0, JSON.stringify(errs));

    ws.close();
  } finally {
    chrome.kill();
    exe.kill();
    await sleep(800);
    // 只杀带调试端口的 chrome，别动用户正在用的浏览器
    try {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
        { windowsHide: true, stdio: 'ignore' });
    } catch { /* 清理失败不影响结果 */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* 临时目录，失败无妨 */ }
  }

  console.log(`\n__RESULT__ pass=${passed} fail=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('界面测试异常:', e.message);
  process.exit(1);
});
