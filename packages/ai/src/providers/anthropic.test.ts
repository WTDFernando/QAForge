import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, OutputError, RefusalError } from '../provider';
import { AnthropicProvider } from './anthropic';

/** Build an SSE response the SDK will parse exactly like the real API. */
function sse(
  text: string,
  stop: { reason: string; details?: unknown } = { reason: 'end_turn' },
  model = 'claude-opus-5-5',
) {
  const events: Array<[string, unknown]> = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1200,
            output_tokens: 1,
            cache_read_input_tokens: 800,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: text.slice(0, 5) },
      },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(5) } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: {
          stop_reason: stop.reason,
          stop_sequence: null,
          stop_details: stop.details ?? null,
        },
        usage: { output_tokens: 345 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(
    events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function provider(respond: (body: Record<string, unknown>, headers: Headers) => Response) {
  const seen: { body?: Record<string, unknown>; headers?: Headers } = {};
  const client = new Anthropic({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (_url, init) => {
      seen.body = JSON.parse(String(init?.body));
      seen.headers = new Headers(init?.headers);
      return respond(seen.body!, seen.headers);
    },
  });
  return { p: new AnthropicProvider(undefined, client), seen };
}

const schema = z.object({ answer: z.string() });
const req = {
  model: 'claude-opus-5-5',
  system: 'SYS',
  content: [{ type: 'text' as const, text: 'hi' }],
  schema,
  effort: 'high' as const,
};

describe('AnthropicProvider', () => {
  it('streams a structured response and reports usage and progress', async () => {
    const { p, seen } = provider(() => sse('{"answer":"42"}'));
    const progress: number[] = [];
    const res = await p.generateStructured({
      ...req,
      onProgress: (u) => progress.push(u.outputChars),
    });
    expect(res).toEqual({
      data: { answer: '42' },
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1200, outputTokens: 345, cacheReadTokens: 800, cacheWriteTokens: 0 },
    });
    expect(progress).toEqual([5, 15]);
    // Request shape: cached system prompt, effort + JSON schema format, refusal fallback on.
    expect(seen.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      stream: true,
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'high', format: { type: 'json_schema' } },
      fallbacks: 'default',
    });
    expect(seen.body).not.toHaveProperty('thinking');
    expect(seen.headers!.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
  });

  it('does not send fallbacks for models without server-side fallback', async () => {
    const { p, seen } = provider(() => sse('{"answer":"x"}', undefined, 'claude-haiku-5-5'));
    await p.generateStructured({ ...req, model: 'claude-haiku-5-5' });
    expect(seen.body).not.toHaveProperty('fallbacks');
  });

  it('raises RefusalError with the category', async () => {
    const { p } = provider(() =>
      sse('', {
        reason: 'refusal',
        details: { type: 'refusal', category: 'cyber', explanation: 'no' },
      }),
    );
    await expect(p.generateStructured(req)).rejects.toMatchObject({
      constructor: RefusalError,
      category: 'cyber',
    });
  });

  it('raises OutputError when output is truncated or invalid', async () => {
    await expect(
      provider(() => sse('{"answer":', { reason: 'max_tokens' })).p.generateStructured(req),
    ).rejects.toBeInstanceOf(OutputError);
    await expect(provider(() => sse('{"wrong":1}')).p.generateStructured(req)).rejects.toThrow();
  });

  it('maps auth errors to ConfigError', async () => {
    const { p } = provider(
      () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'bad key' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(p.generateStructured(req)).rejects.toBeInstanceOf(ConfigError);
  });
});
