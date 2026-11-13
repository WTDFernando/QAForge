import type { z } from 'zod';
import {
  OutputError,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResult,
} from '../provider';

/**
 * Deterministic provider for tests and offline demos: returns scripted outputs in order
 * (or computed from the request). Validates against the schema like the real provider.
 */
export class FakeProvider implements ModelProvider {
  readonly id = 'fake';
  readonly calls: StructuredRequest<z.ZodType>[] = [];

  constructor(private readonly responder: (req: StructuredRequest<z.ZodType>) => unknown) {}

  async generateStructured<S extends z.ZodType>(
    req: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    this.calls.push(req);
    const raw = this.responder(req);
    req.onProgress?.({ outputChars: JSON.stringify(raw ?? null).length });
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success)
      throw new OutputError(`Fake output did not match schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}
