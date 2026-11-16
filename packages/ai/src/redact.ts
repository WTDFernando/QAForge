/**
 * Redaction applied to everything QAForge sends to a model provider.
 * NFR: never send secrets or environment passwords to the AI.
 *
 * Two layers:
 *  1. Known secret values (environment secrets, the org's own API key) are replaced verbatim.
 *  2. Common credential shapes (API keys, bearer tokens, JWTs, private keys, password=...) are masked
 *     even when we don't know them, e.g. pasted into a requirement or a bug note.
 */
const PATTERNS: [RegExp, string][] = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[redacted private key]',
  ],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '[redacted key]'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, '[redacted key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[redacted key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted token]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[redacted token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted key]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[redacted key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted token]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, '$1 [redacted]'],
  // credentials embedded in URLs: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1[redacted]@'],
];

export function redactText(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  // Longest first so a secret that contains another is replaced whole.
  for (const s of [...new Set(knownSecrets)]
    .filter((v) => v && v.length >= 4)
    .sort((a, b) => b.length - a.length)) {
    out = out.split(s).join('[redacted]');
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  // key=value / key: value for credential-like names. Only values that look like a secret (contain a
  // digit or symbol) so prose such as "Password: required" stays readable for the agents.
  out = out.replace(
    /\b((?:pass(?:word|wd)?|pwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret|token)["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi,
    (all, key: string, value: string) =>
      /[\d\W_]/.test(value.replace(/[.!?:)]+$/, '')) && value !== '[redacted]'
        ? `${key}[redacted]`
        : all,
  );
  return out;
}

/** Collect string leaves of a decrypted secrets object (e.g. environment secrets). */
export function secretValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(secretValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(secretValues);
  return [];
}
