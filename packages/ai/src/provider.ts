import type { z } from 'zod';
import type { TokenUsage } from './pricing';

/** Provider-neutral message content. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'document'; mediaType: 'application/pdf'; base64: string; title?: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProgressUpdate {
  /** Characters of output generated so far (for a rough progress bar). */
  outputChars: number;
}

export interface StructuredRequest<S extends z.ZodType> {
  model: string;
  system: string;
  content: ContentPart[];
  schema: S;
  effort: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
  onProgress?: (p: ProgressUpdate) => void;
}

export interface ModelCall {
  /** Model that actually produced the answer (may differ from the request if a fallback ran). */
  model: string;
  usage: TokenUsage;
}

export interface StructuredResult<T> extends ModelCall {
  data: T;
}

export interface ModelProvider {
  readonly id: string;
  generateStructured<S extends z.ZodType>(
    req: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>>;
}

/** The model declined (safety). Not retryable with the same input. */
export class RefusalError extends Error {
  constructor(
    public readonly category: string | null,
    message = 'The model declined this request',
  ) {
    super(message);
  }
}

/** Output was cut off or did not match the schema. */
export class OutputError extends Error {}

/** Missing/invalid credentials or configuration. Not retryable. */
export class ConfigError extends Error {}
