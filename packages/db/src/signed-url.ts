import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed file URLs for the local storage driver (S3 uses presigned URLs instead).
 * The token binds the attachment id, an expiry and the disposition, so a leaked link stops working
 * after a few minutes and can't be repurposed for another file.
 */
function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('ENCRYPTION_KEY or BETTER_AUTH_SECRET must be set to sign URLs');
  return createHash('sha256').update(`qaforge:file-urls:${secret}`).digest();
}

export type Disposition = 'inline' | 'attachment';

export function signFileToken(id: string, exp: number, disposition: Disposition): string {
  return createHmac('sha256', key()).update(`${id}.${exp}.${disposition}`).digest('base64url');
}

export function verifyFileToken(
  id: string,
  exp: number,
  disposition: Disposition,
  sig: string,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(signFileToken(id, exp, disposition));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
