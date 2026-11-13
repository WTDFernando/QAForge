import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Prompts live in versioned files: prompts/<agent>.<version>.md. The version is recorded on every
 * AgentJob so outputs can be traced to the exact prompt that produced them.
 */
const cache = new Map<string, string>();

export function loadPrompt(name: string, version: string): string {
  const key = `${name}.${version}`;
  if (!cache.has(key)) {
    const candidates = [
      path.resolve(__dirname, 'prompts'),
      path.resolve(__dirname, '..', 'prompts'),
    ];
    for (const dir of candidates) {
      try {
        cache.set(key, readFileSync(path.join(dir, `${key}.md`), 'utf8').trim());
        break;
      } catch {
        /* try next */
      }
    }
    if (!cache.has(key)) throw new Error(`Prompt ${key}.md not found`);
  }
  return cache.get(key)!;
}
