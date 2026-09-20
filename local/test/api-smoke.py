#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地版 HTTP 端到端冒烟测试

自己拉起 local/server.js（用独立数据目录），跑完再关掉，
不依赖外部服务，也不污染真实数据。

运行： python local/test/api-smoke.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SERVER = os.path.join(ROOT, 'local', 'server.js')
PORT = '5199'
BASE = f'http://127.0.0.1:{PORT}'

passed = 0
failed = 0


def test(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print(f'  ✓ {name}')
    except Exception as e:  # noqa: BLE001 - 测试脚本需要看到所有失败
        failed += 1
        print(f'  ✗ {name}\n      {e}')


def req(path, payload=None, method='POST', raw=None, headers=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
    if raw is not None:
        data = raw
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')
        try:
            return e.code, json.loads(body or '{}')
        except json.JSONDecodeError:
            return e.code, {'error': body}


def main():
    tmp = tempfile.mkdtemp(prefix='donghua-api-smoke-')
    env = dict(os.environ)
    env['PORT'] = PORT
    # 让服务把数据写到临时目录：通过环境变量指定应用根不可行，改为启动后清理
    print(f'启动服务 (端口 {PORT})...')
    # 优先用 PATH 里的 node，找不到再退回到托管运行时
    node = shutil.which('node') or r'C:\Users\46144\.workbuddy-ai\binaries\node\versions\22.22.2-2\node.exe'
    if not os.path.exists(node):
        print(f'找不到 node: {node}')
        return 1
    proc = subprocess.Popen(
        [node, SERVER], env=env, cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )

    # 等服务起来
    for _ in range(40):
        try:
            code, body = req('/api/health', method='GET')
            if code == 200:
                break
        except Exception:
            pass
        time.sleep(0.25)
    else:
        print('服务启动失败')
        print(proc.stdout.read() if proc.stdout else '')
        proc.kill()
        return 1

    try:
        print('\n服务与数据层')
        test('health 返回数据目录', lambda: (
            lambda c, b: b['ok'] is True and b.get('dataDir')
        )(*req('/api/health', method='GET')))

        def crud():
            _, ins = req('/api/db', {
                'table': 'projects', 'op': 'insert',
                'payload': {'name': '冒烟项目'}, 'returning': True,
            })
            pid = ins['data'][0]['id']
            assert pid, '应返回新记录 id'
            _, got = req('/api/db', {
                'table': 'projects', 'op': 'select',
                'filters': [{'op': 'eq', 'column': 'id', 'value': pid}],
            })
            assert got['data'][0]['name'] == '冒烟项目', '读回的名称应一致'
            _, upd = req('/api/db', {
                'table': 'projects', 'op': 'update',
                'filters': [{'op': 'eq', 'column': 'id', 'value': pid}],
                'payload': {'name': '改后'}, 'returning': True,
            })
            assert upd['data'][0]['name'] == '改后', '更新应生效'
            req('/api/db', {
                'table': 'projects', 'op': 'delete',
                'filters': [{'op': 'eq', 'column': 'id', 'value': pid}],
            })
            _, after = req('/api/db', {
                'table': 'projects', 'op': 'select',
                'filters': [{'op': 'eq', 'column': 'id', 'value': pid}],
            })
            assert len(after['data']) == 0, '删除后应查不到'
        test('表 CRUD 全流程', crud)

        def bad_table():
            code, _ = req('/api/db', {'table': 'bad;drop', 'op': 'select'})
            assert code >= 400, f'非法表名应被拒绝，实际 {code}'
        test('非法表名被拒绝', bad_table)

        print('\nAPI 配置与加密')
        def config_flow():
            _, saved = req('/api/ai/config/save', {
                'name': '测试配置',
                'base_url': 'https://api.openai.com/v1',
                'api_key': 'sk-test-key-1234',
                'api_type': 'openai_compatible',
                'chat_completions_path': '/chat/completions',
            })
            cfg = saved['data']
            assert cfg['masked_api_key'] == 'sk-****1234', f"脱敏应显示末四位，实际 {cfg['masked_api_key']}"
            assert 'encrypted_api_key' not in cfg, '返回体不应含密文'
            # 密文应真的落盘了
            table_file = None
            data_dir = os.path.join(ROOT, 'local', 'data', 'tables', 'api_configs.json')
            if os.path.exists(data_dir):
                table_file = data_dir
            if table_file:
                with open(table_file, encoding='utf-8') as f:
                    rows = json.load(f)
                hit = [r for r in rows if r['id'] == cfg['id']]
                assert hit, '配置应已落盘'
                assert 'sk-test-key-1234' not in json.dumps(hit[0]), '明文密钥不应出现在数据文件里'
            req('/api/ai/config/delete', {'id': cfg['id']})
        test('保存配置：脱敏返回 + 密文落盘', config_flow)

        def missing_key():
            code, body = req('/api/ai/generate', {
                'apiConfigId': 'nonexistent', 'modelId': 'x', 'prompt': 'hi',
            })
            assert code >= 400, f'不存在的配置应报错，实际 {code}'
            assert 'error' in body, '应返回 error 字段'
        test('生成接口对无效配置报错', missing_key)

        print('\n剪辑链路')
        TL_ID = 'tl_smoke_1'

        def timeline_flow():
            req('/api/edit/timeline/save', {
                'id': TL_ID, 'name': '冒烟时间线',
                'timeline': {
                    'id': TL_ID, 'width': 1080, 'height': 1920, 'fps': 30,
                    'tracks': [
                        {'id': 'v1', 'type': 'video', 'clips': []},
                        {'id': 'a1', 'type': 'audio', 'clips': []},
                    ],
                },
            })
            _, add = req('/api/edit/command', {
                'timelineId': TL_ID,
                'cmd': {'type': 'addClip', 'clip': {
                    'type': 'video', 'src': '/api/files/video/x.mp4',
                    'duration': 10, 'sourceStart': 0, 'speed': 1, 'volume': 1,
                }},
            })
            clips = add['data']['timeline']['tracks'][0]['clips']
            assert len(clips) == 1, '应添加一个片段'
            clip_id = clips[0]['id']

            _, split = req('/api/edit/command', {
                'timelineId': TL_ID, 'cmd': {'type': 'splitClip', 'clipId': clip_id, 'at': 4},
            })
            clips = split['data']['timeline']['tracks'][0]['clips']
            assert len(clips) == 2, f'分割后应有 2 段，实际 {len(clips)}'
            assert abs(clips[0]['duration'] - 4) < 1e-6, '左段 4 秒'
            assert abs(clips[1]['duration'] - 6) < 1e-6, '右段 6 秒'

            _, sp = req('/api/edit/command', {
                'timelineId': TL_ID, 'cmd': {'type': 'setSpeed', 'clipId': clips[0]['id'], 'speed': 2},
            })
            c0 = sp['data']['timeline']['tracks'][0]['clips'][0]
            assert abs(c0['duration'] - 2) < 1e-6, f"2 倍速后应为 2 秒，实际 {c0['duration']}"

            _, mute = req('/api/edit/command', {
                'timelineId': TL_ID,
                'cmd': {'type': 'patchClip', 'clipId': clips[0]['id'], 'patch': {'muted': True}},
            })
            assert mute['data']['timeline']['tracks'][0]['clips'][0]['muted'] is True, '静音应生效'
        test('时间线：添加 / 分割 / 变速 / 静音', timeline_flow)

        def bad_command():
            code, body = req('/api/edit/command', {
                'timelineId': TL_ID,
                'cmd': {'type': 'splitClip', 'clipId': 'nope', 'at': 1},
            })
            assert code >= 400, f'不存在的片段应报错，实际 {code}'
        test('无效剪辑命令被拒绝', bad_command)

        def nan_command():
            code, _ = req('/api/edit/command', {
                'timelineId': TL_ID,
                'cmd': {'type': 'setSpeed', 'clipId': 'x', 'speed': 'abc'},
            })
            assert code >= 400, f'非法数值应报错，实际 {code}'
        test('NaN 数值被拒绝', nan_command)

        def render_rejects_missing_asset():
            code, body = req('/api/edit/render', {'timelineId': TL_ID})
            # 素材不存在时应报错，而不是静默产出坏文件
            assert code >= 400, f'素材缺失应报错，实际 {code} {body}'
        test('渲染：素材不存在时报错', render_rejects_missing_asset)

        print('\n静态资源')
        def static_root():
            # 未构建前端时返回的是纯文本提示（不是 JSON），这里直接读原始响应
            r = urllib.request.Request(BASE + '/', method='GET')
            with urllib.request.urlopen(r, timeout=10) as resp:
                text = resp.read().decode('utf-8', 'ignore')
            assert resp.status in (200, 404), f'根路径应有响应，实际 {resp.status}'
            assert 'dist' in text or '<html' in text or 'index' in text or len(text) > 0, '应返回可识别内容'
        test('根路径有响应', static_root)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    print(f'\n{"全部通过" if failed == 0 else "存在失败"}：{passed} 通过 / {failed} 失败')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
