import { z } from 'zod';
import { PRIORITIES, REQUIREMENT_TYPES } from '@qaforge/shared';
import type { ContentPart } from '../provider';
import { tagSafe, type AgentDefinition } from './types';

export const requirementAgentInput = z.object({
  mode: z.enum(['split', 'analyze']),
  projectName: z.string(),
  /** Text content (Markdown, extracted DOCX/XLSX text, or the requirement for "analyze"). */
  text: z.string().optional(),
  /** Binary sources the model reads natively. */
  pdfBase64: z.string().optional(),
  image: z
    .object({ mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']), base64: z.string() })
    .optional(),
  sourceName: z.string(),
  existingTitles: z.array(z.string()).default([]),
});
export type RequirementAgentInput = z.infer<typeof requirementAgentInput>;

// Schema kept to plain types for structured outputs; ranges are enforced in postprocess.
export const requirementAgentOutput = z.object({
  summary: z.string().describe('2-4 sentences: what the source covers and what was skipped'),
  requirements: z.array(
    z.object({
      key: z.string().describe('R1, R2, ...'),
      parentKey: z.string().nullable(),
      type: z.enum(REQUIREMENT_TYPES),
      title: z.string(),
      description: z.string(),
      acceptanceCriteria: z.array(z.string()),
      priority: z.enum(PRIORITIES),
      clarityScore: z.number(),
      ambiguities: z.array(z.string()),
      missingCriteria: z.array(z.string()),
      questions: z.array(z.string()),
      sourceQuote: z.string(),
    }),
  ),
  documentQuestions: z.array(z.string()).describe('Questions about the document as a whole'),
});
export type RequirementAgentOutput = z.infer<typeof requirementAgentOutput>;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
const RANK = { EPIC: 0, FEATURE: 1, STORY: 2 } as const;

export const requirementAgent: AgentDefinition<
  typeof requirementAgentInput,
  typeof requirementAgentOutput
> = {
  id: 'requirement',
  name: 'Requirement Agent',
  description:
    'Splits documents into atomic requirements, scores clarity, lists ambiguities and questions.',
  promptVersion: 'v1',
  effort: 'high',
  input: requirementAgentInput,
  output: requirementAgentOutput,

  buildContent(input) {
    const parts: ContentPart[] = [];
    if (input.pdfBase64)
      parts.push({
        type: 'document',
        mediaType: 'application/pdf',
        base64: input.pdfBase64,
        title: input.sourceName,
      });
    if (input.image)
      parts.push({ type: 'image', mediaType: input.image.mediaType, base64: input.image.base64 });
    const existing = input.existingTitles.length
      ? input.existingTitles.map((t) => `- ${tagSafe(t)}`).join('\n')
      : '(none)';
    parts.push({
      type: 'text',
      text: [
        `Mode: ${input.mode}`,
        `Project: ${tagSafe(input.projectName)}`,
        `<existing>\n${existing}\n</existing>`,
        input.text !== undefined
          ? `<document name="${tagSafe(input.sourceName)}">\n${tagSafe(input.text)}\n</document>`
          : `The document "${tagSafe(input.sourceName)}" is attached above.`,
      ].join('\n\n'),
    });
    return parts;
  },

  postprocess(input, out) {
    const dropped: string[] = [];
    const haystack = input.text ? normalize(input.text) : null;
    const keys = new Set(out.requirements.map((r) => r.key));
    const byKey = new Map(out.requirements.map((r) => [r.key, r]));
    const requirements = out.requirements
      .filter((r) => {
        if (!r.title.trim()) return (dropped.push(`${r.key}: empty title`), false);
        if (!r.sourceQuote.trim())
          return (dropped.push(`${r.key} "${r.title}": no source quote`), false);
        return true;
      })
      .map((r) => {
        // Hierarchy: parent must exist and rank higher; otherwise make it top-level.
        const parent = r.parentKey ? byKey.get(r.parentKey) : undefined;
        const parentKey =
          r.parentKey && keys.has(r.parentKey) && parent && RANK[parent.type] < RANK[r.type]
            ? r.parentKey
            : null;
        return {
          ...r,
          parentKey,
          clarityScore: Math.max(0, Math.min(100, Math.round(r.clarityScore))),
          // For text sources we can verify the citation; PDFs/images are checked by the reviewer.
          quoteVerified: haystack
            ? haystack.includes(normalize(r.sourceQuote).slice(0, 120))
            : null,
        };
      });
    return { output: { ...out, requirements }, dropped };
  },
};
