import { randomInt, randomUUID } from 'node:crypto';

/** Values available to {{...}} placeholders. `env.*` names resolve against the run's environment. */
export interface VariableScope {
  /** Collection variables + values extracted by earlier requests (chaining). */
  vars: Record<string, string>;
  /** Environment variables (non-secret) and secrets (decrypted, never logged). */
  env: Record<string, string>;
  secrets: Record<string, string>;
}

const DYNAMIC: Record<string, () => string> = {
  $guid: () => randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(randomInt(0, 1000)),
};

/**
 * Replace {{name}}, {{env.NAME}} and {{$dynamic}} placeholders. Unknown placeholders are left as
 * they are and reported, so a typo shows up in the result instead of sending an empty value.
 */
export function interpolate(input: string, scope: VariableScope, missing?: Set<string>): string {
  return input.replace(/\{\{\s*([$\w.-]+)\s*\}\}/g, (all, name: string) => {
    if (name in DYNAMIC) return DYNAMIC[name]!();
    if (name.startsWith('env.')) {
      const key = name.slice(4);
      const v = scope.secrets[key] ?? scope.env[key];
      if (v !== undefined) return v;
    } else {
      const v = scope.vars[name] ?? scope.env[name] ?? scope.secrets[name];
      if (v !== undefined) return v;
    }
    missing?.add(name);
    return all;
  });
}

/** Replace every secret value (and common credential headers) so logs and exchanges are safe to store. */
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(secrets)
    .filter((s) => s && s.length >= 4)
    .sort((a, b) => b.length - a.length)) {
    out = out.split(v).join('[redacted]');
  }
  return out;
}

export const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);
