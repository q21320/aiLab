// ============================================================================
// 数据加密工具（教学科研安全需求 4.9）
//
// - sha256Hex：密码单向散列（PBKDF2 可进一步增强，见 README）
// - aesEncrypt/aesDecrypt：AES-256-GCM 对称加密（可用于敏感字段/本地存储加密）
//   密钥由 PBKDF2 从口令派生，无需明文存 key。
// ============================================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 散列（返回 hex） */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return bufToHex(digest);
}

/** 从口令派生 AES 密钥（PBKDF2-SHA256，10 万次迭代） */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as any, iterations: 100000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** AES-256-GCM 加密，返回 base64(iv + ciphertext) */
export async function aesEncrypt(plain: string, passphrase: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const payload = new Uint8Array(iv.length + ct.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ct), iv.length);
  let bin = "";
  for (const b of payload) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** AES-256-GCM 解密 */
export async function aesDecrypt(cipher: string, passphrase: string): Promise<string> {
  const bin = atob(cipher);
  const payload = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) payload[i] = bin.charCodeAt(i);
  const iv = payload.slice(0, 12);
  const ct = payload.slice(12);
  const key = await deriveKey(passphrase, iv);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct as any);
  return dec.decode(pt);
}
