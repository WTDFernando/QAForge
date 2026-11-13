import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import {
  ConfigError,
  OutputError,
  RefusalError,
  type ContentPart,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResult,
} from '../provider';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-fable-5-2',
  'claude-fable-5-1',
]);

function toBlocks(parts: ContentPart[]): Anthropic.Beta.BetaContentBlockParam[] {
  return parts.map((p) => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    if (p.type === 'document')
      return {
        type: 'document',
        title: p.title,
        source: { type: 'base64', media_type: p.mediaType, data: p.base64 },
      };
    return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } };
  });
}

export function toTokenUsage(u: Anthropic.Beta.BetaUsage) {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function checkStop(m: Anthropic.Beta.BetaMessage) {
  if (m.stop_reason === 'refusal')
    throw new RefusalError(
      m.stop_details?.category ?? null,
      m.stop_details?.explanation ?? undefined,
    );
  if (m.stop_reason === 'max_tokens')
    throw new OutputError('The model ran out of output tokens before finishing');
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic';
  readonly client: Anthropic;

  /** apiKey undefined -> SDK resolves ANTHROPIC_API_KEY / auth profile from the environment. */
  constructor(apiKey?: string, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 2 });
  }

  async generateStructured<S extends z.ZodType>(
    req: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    const useFallback = FALLBACK_MODELS.has(req.model);
    let chars = 0;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          // Streaming: generous ceiling so long outputs are never cut mid-JSON.
          max_tokens: req.maxTokens ?? 64000,
          // Stable system prompt first so it is cached across calls.
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: toBlocks(req.content) }],
          // Adaptive thinking is the default on current models; depth is controlled by effort.
          output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
          ...(useFallback
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        },
        { signal: req.signal },
      );
      stream.on('text', (delta) => {
        chars += delta.length;
        req.onProgress?.({ outputChars: chars });
      });
      let msg: Awaited<ReturnType<typeof stream.finalMessage>>;
      try {
        msg = await stream.finalMessage();
      } catch (e) {
        // finalMessage() parses the JSON eagerly; on a refusal or truncation it throws a parse error,
        // so classify from the raw message's stop_reason first.
        const raw = stream.currentMessage;
        if (raw && !(e instanceof Anthropic.APIError)) {
          checkStop(raw);
          throw new OutputError('The model output did not match the expected format');
        }
        throw e;
      }
      checkStop(msg);
      if (!msg.parsed_output)
        throw new OutputError('The model output did not match the expected format');
      return {
        data: msg.parsed_output as z.infer<S>,
        model: msg.model,
        usage: toTokenUsage(msg.usage),
      };
    } catch (e) {
      if (
        e instanceof Anthropic.AuthenticationError ||
        e instanceof Anthropic.PermissionDeniedError
      ) {
        throw new ConfigError(
          'The Anthropic API key is missing or invalid. Set it in Settings > AI.',
        );
      }
      if (e instanceof Anthropic.NotFoundError)
        throw new ConfigError(`Model "${req.model}" is not available for this API key.`);
      throw e;
    }
  }
}
