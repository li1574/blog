/**
 * 网易云音乐 weapi 加密与请求封装。
 *
 * 网易的接口要求参数用 AES-128-CBC 加密两遍，再用 RSA 加密密钥。
 * 这里用 Web Crypto + BigInt 实现，不依赖 Node。
 *
 * 所有请求都打 music.163.com；登录态靠 cookie，
 * cookie 由浏览器保存并在请求时带上，服务端不落任何状态。
 */

const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const IV = "0102030405060708";
const PUBKEY = "010001";
const MODULUS =
  "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

const encoder = new TextEncoder();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function aesEncrypt(text: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: encoder.encode(IV) },
    cryptoKey,
    encoder.encode(text)
  );
  return bytesToBase64(new Uint8Array(encrypted));
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function rsaEncrypt(text: string): string {
  const reversed = text.split("").reverse().join("");
  let hex = "";
  for (const char of reversed) {
    hex += char.charCodeAt(0).toString(16).padStart(2, "0");
  }
  const message = BigInt("0x" + hex);
  const encrypted = modPow(message, BigInt("0x" + PUBKEY), BigInt("0x" + MODULUS));
  return encrypted.toString(16).padStart(256, "0");
}

function randomKey(length = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += chars[byte % chars.length];
  return out;
}

/** 把 payload 编成 weapi 需要的表单体 */
export async function weapiBody(payload: Record<string, unknown>): Promise<string> {
  const text = JSON.stringify(payload);
  const secretKey = randomKey(16);
  const params = await aesEncrypt(await aesEncrypt(text, PRESET_KEY), secretKey);
  const encSecKey = rsaEncrypt(secretKey);
  return `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
}

/** 调一个 weapi 接口，返回解析后的 JSON */
export async function neteaseApi(
  path: string,
  payload: Record<string, unknown> = {},
  cookie?: string
): Promise<{ status: number; data: Record<string, unknown>; setCookie: string | null }> {
  const body = await weapiBody(payload);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    referer: "https://music.163.com/",
    origin: "https://music.163.com",
  };
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`https://music.163.com${path}`, { method: "POST", headers, body });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") };
}

/** 从 cookie 串里取 __csrf */
export function csrfFrom(cookie?: string): string {
  if (!cookie) return "";
  const match = cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return match ? match[1] : "";
}
