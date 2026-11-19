import { z } from 'zod';
import { FAILURE_CLASSES } from '@qaforge/shared';
import { tagSafe, type AgentDefinition } from './types';

export const failureAnalysisInput = z.object({
  kind: z.enum(['ui', 'api']),
  name: z.string(),
  error: z.string(),
  log: z.string().default(''),
  /** API: request/response summary (already redacted) */
  exchange: z.string().default(''),
  /** UI: passed on retry */
  flaky: z.boolean().default(false),
  attempts: z.number().default(1),
  /** Recent statuses of this test, newest first, e.g. ["PASSED","FAILED","PASSED"] */
  history: z.array(z.string()).default([]),
  code: z.string().default(''),
});
export type FailureAnalysisInput = z.infer<typeof failureAnalysisInput>;

export const failureAnalysisOutput = z.object({
  failureClass: z.enum(FAILURE_CLASSES),
  confidence: z.number(),
  reasoning: z.string(),
  evidence: z.string(),
  suggestedAction: z.string(),
  locatorIssue: z.boolean(),
});
export type FailureAnalysisOutput = z.infer<typeof failureAnalysisOutput>;

export const failureAnalysisAgent: AgentDefinition<
  typeof failureAnalysisInput,
  typeof failureAnalysisOutput
> = {
  id: 'failure-analysis',
  name: 'Failure Analysis Agent',
  description: 'Classifies an automated test failure and suggests who should act.',
  promptVersion: 'v1',
  effort: 'low',
  input: failureAnalysisInput,
  output: failureAnalysisOutput,
  buildContent(input) {
    return [
      {
        type: 'text',
        text: `<failure kind="${input.kind}" attempts="${input.attempts}" passed_on_retry="${input.flaky}">\nName: ${tagSafe(input.name)}\nRecent results (newest first): ${input.history.join(', ') || '(none)'}\n\nError:\n${tagSafe(input.error.slice(0, 6000))}\n\nLog (end):\n${tagSafe(input.log.slice(-4000)) || '(none)'}\n\nExchange:\n${tagSafe(input.exchange.slice(0, 6000)) || '(none)'}\n</failure>${
          input.code ? `\n\n<test_code>\n${tagSafe(input.code.slice(0, 12000))}\n</test_code>` : ''
        }`,
      },
    ];
  },
  postprocess(input, out) {
    const dropped: string[] = [];
    let confidence = Math.max(0, Math.min(1, out.confidence));
    let failureClass = out.failureClass;
    // Passing on retry is direct evidence of flakiness.
    if (input.flaky && failureClass !== 'FLAKY') {
      dropped.push(`changed ${failureClass} to FLAKY: the test passed on retry`);
      failureClass = 'FLAKY';
    }
    // Evidence must come from the input; otherwise the classification is a guess.
    const haystack = `${input.error}\n${input.log}\n${input.exchange}`;
    const quote = out.evidence.trim().replace(/^["']|["']$/g, '');
    if (quote && !haystack.includes(quote.slice(0, 80))) {
      dropped.push('the quoted evidence was not found in the failure details');
      confidence = Math.min(confidence, 0.5);
    }
    return {
      output: {
        ...out,
        failureClass,
        confidence: Math.round(confidence * 100) / 100,
        locatorIssue: out.locatorIssue && input.kind === 'ui',
      },
      dropped,
    };
  },
};
