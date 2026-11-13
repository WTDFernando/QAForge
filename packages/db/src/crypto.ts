import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets at rest (environment secrets, org AI keys).
 * Key: ENCRYPTION_KEY (64 hex chars or base64 of 32 bytes), else derived from BETTER_AUTH_SECRET.
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32)
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
    return buf;
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new Error('ENCRYPTION_KEY or BETTER_AUTH_SECRET must be set to encrypt secrets');
  return createHash('sha256').update(`qaforge:secrets:${secret}`).digest();
}

/** Output: base64(iv[12] | tag[16] | ciphertext). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptJson<T>(payload: string): T {
  const buf = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const out = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T;
}
