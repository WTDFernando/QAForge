/**
 * USD per million tokens (Anthropic first-party rates, checked 2026-11). Used for the AI usage log
 * and budgets; the bill from the provider is authoritative. Cache writes are 1.25x input, reads per table.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
};

const DEFAULT_MODEL = 'claude-opus-5-5';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(model: string, u: TokenUsage): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES[DEFAULT_MODEL]!;
  const usd =
    (u.inputTokens * p.input +
      u.cacheWriteTokens * p.input * 1.25 +
      u.cacheReadTokens * p.cacheRead +
      u.outputTokens * p.output) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
