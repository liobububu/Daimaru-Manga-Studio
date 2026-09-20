'use strict';
/**
 * API Key 本地加密存储
 *
 * 诚实说明这层保护到什么程度：
 * 本地版没有登录密码，无法用用户口令派生密钥，因此主密钥是本机随机生成、
 * 存放在数据目录下的一个文件。它能防止 API Key 以明文出现在 data/ 里被误传、
 * 误粘贴或误提交，但**防不住本机上的其他程序读取**（因为主密钥也在本机）。
 * 真正的安全边界是操作系统账户权限，不是这层加密。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');

const MASTER_FILE = 'master.key';
let masterKey = null;

async function loadMasterKey() {
  if (masterKey) return masterKey;
  const dir = store.resolveDataDir();
  const file = path.join(dir, MASTER_FILE);

  if (fs.existsSync(file)) {
    masterKey = Buffer.from((await fsp.readFile(file, 'utf8')).trim(), 'hex');
    if (masterKey.length !== 32) {
      throw new Error('主密钥文件损坏（长度不是 32 字节），请删除 data/master.key 后重启（已保存的 API Key 需重新填写）');
    }
    return masterKey;
  }

  masterKey = crypto.randomBytes(32);
  await fsp.writeFile(file, masterKey.toString('hex'), { mode: 0o600 });
  return masterKey;
}

/** AES-256-GCM 加密，输出 base64(iv).base64(ciphertext) */
async function encrypt(plaintext) {
  const key = await loadMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${enc.toString('base64')}.${tag.toString('base64')}`;
}

async function decrypt(packed) {
  const key = await loadMasterKey();
  const parts = String(packed).split('.');
  if (parts.length !== 3) throw new Error('密文格式错误');
  const [ivB64, dataB64, tagB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

/** 判断是否已是加密格式（三段 base64，用点分隔） */
function isEncrypted(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const b64 = /^[A-Za-z0-9+/]+=*$/;
  return parts.every(p => b64.test(p));
}

/** 解密，兼容历史明文值（云端版迁移过来的数据可能是明文） */
async function decryptMaybe(value) {
  if (!value) return '';
  return isEncrypted(value) ? await decrypt(value) : value;
}

module.exports = { encrypt, decrypt, isEncrypted, decryptMaybe };
