import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM with a random 96-bit IV. Output: base64(iv | tag | ciphertext). Key: 32 bytes as 64 hex chars. */
export function encryptToken(plain: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptToken(payload: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 29) throw new Error("Encrypted token is malformed");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

function keyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes as 64 hex characters");
  return Buffer.from(hex, "hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Meta signs webhooks as "sha256=<hex hmac of raw body using the app secret>". */
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqualHex(header, expected);
}

/** Cal.com signs the raw body with HMAC-SHA256 (hex) in x-cal-signature-256. */
export function verifyCalSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  return safeEqualHex(header, createHmac("sha256", secret).update(rawBody).digest("hex"));
}

/** appsecret_proof hardens Graph API calls so a leaked token alone is not enough. */
export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}
