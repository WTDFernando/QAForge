import type { z } from 'zod';
import type { ContentPart, Effort } from '../provider';

import type { AgentId } from '@qaforge/shared';
export type { AgentId };

export interface AgentDefinition<I extends z.ZodType, O extends z.ZodType> {
  id: AgentId;
  name: string;
  description: string;
  /** Prompt file: prompts/<id>.<promptVersion>.md */
  promptVersion: string;
  effort: Effort;
  input: I;
  output: O;
  buildContent(input: z.infer<I>): ContentPart[];
  /**
   * Enforce rules the schema can't express ("only cite refs from the input").
   * Returns the cleaned output plus human-readable notes about anything removed.
   */
  postprocess?(input: z.infer<I>, output: z.infer<O>): { output: z.infer<O>; dropped: string[] };
}

/** Escape text placed inside XML-ish tags so user data can't close our delimiters. */
export function tagSafe(s: string): string {
  return s.replace(/<\/?(document|requirement|requirements|test_case|existing|siblings)\b/gi, (m) =>
    m.replace('<', '‹'),
  );
}
