import { z } from 'zod';
import { BUG_SEVERITIES, PRIORITIES } from '@qaforge/shared';
import type { ContentPart } from '../provider';
import { redactText } from '../redact';
import { tagSafe, type AgentDefinition } from './types';

export const bugAgentInput = z.object({
  projectName: z.string(),
  note: z.string().min(1),
  pageUrl: z.string().nullable().default(null),
  /** Browser and OS parsed from the reporter's user agent (facts, not guesses). */
  browser: z.string().nullable().default(null),
  os: z.string().nullable().default(null),
  /** Test environment chosen by the reporter: name and base URL only, never credentials. */
  environment: z
    .object({ name: z.string(), baseUrl: z.string().nullable() })
    .nullable()
    .default(null),
  components: z.array(z.string()).default([]),
  image: z
    .object({
      mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      base64: z.string(),
    })
    .nullable()
    .default(null),
});
export type BugAgentInput = z.infer<typeof bugAgentInput>;

export const bugAgentOutput = z.object({
  title: z.string(),
  summary: z.string(),
  stepsToReproduce: z.array(z.string()),
  expectedResult: z.string(),
  actualResult: z.string(),
  severity: z.enum(BUG_SEVERITIES),
  priority: z.enum(PRIORITIES),
  component: z.string().nullable(),
  environment: z.object({
    browser: z.string().nullable(),
    os: z.string().nullable(),
    device: z.string().nullable(),
    viewport: z.string().nullable(),
  }),
  highlight: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), label: z.string() })
    .nullable(),
  missingInfo: z.array(z.string()),
  confidence: z.number(),
  rationale: z.string(),
});
export type BugAgentOutput = z.infer<typeof bugAgentOutput>;

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** Best-effort browser/OS from a user agent string (deterministic, no model needed). */
export function parseUserAgent(ua: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!ua) return { browser: null, os: null };
  const m = (re: RegExp) => re.exec(ua)?.[1];
  const browser = m(/Edg\/(\d+)/)
    ? `Edge ${m(/Edg\/(\d+)/)}`
    : m(/Firefox\/(\d+)/)
      ? `Firefox ${m(/Firefox\/(\d+)/)}`
      : m(/Chrome\/(\d+)/)
        ? `Chrome ${m(/Chrome\/(\d+)/)}`
        : m(/Version\/(\d+)[^ ]* Safari/)
          ? `Safari ${m(/Version\/(\d+)[^ ]* Safari/)}`
          : null;
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return { browser, os };
}

export const bugAgent: AgentDefinition<typeof bugAgentInput, typeof bugAgentOutput> = {
  id: 'bug',
  name: 'Bug Agent',
  description: 'Drafts a bug report from a screenshot and a one-line note.',
  promptVersion: 'v1',
  effort: 'medium',
  input: bugAgentInput,
  output: bugAgentOutput,

  buildContent(input) {
    const facts = [
      `Project: ${tagSafe(input.projectName)}`,
      `Page URL: ${input.pageUrl ? tagSafe(input.pageUrl) : '(not given)'}`,
      `Browser: ${input.browser ?? '(unknown)'}`,
      `OS: ${input.os ?? '(unknown)'}`,
      `Test environment: ${input.environment ? `${tagSafe(input.environment.name)}${input.environment.baseUrl ? ` (${tagSafe(input.environment.baseUrl)})` : ''}` : '(not given)'}`,
      `Components: ${input.components.length ? input.components.map(tagSafe).join(', ') : '(none defined)'}`,
      `Screenshot: ${input.image ? 'attached' : 'none'}`,
    ].join('\n');
    const parts: ContentPart[] = [];
    if (input.image) parts.push({ type: 'image', ...input.image });
    parts.push({
      type: 'text',
      text: `<facts>\n${facts}\n</facts>\n\n<note>\n${tagSafe(input.note)}\n</note>`,
    });
    return parts;
  },

  postprocess(input, out) {
    const dropped: string[] = [];
    let component = out.component?.trim() || null;
    if (component) {
      const match = input.components.find((c) => c.toLowerCase() === component!.toLowerCase());
      if (!match) dropped.push(`component "${component}" is not defined in the project`);
      component = match ?? null;
    }
    let highlight = out.highlight;
    if (highlight && !input.image) {
      dropped.push('highlight without a screenshot');
      highlight = null;
    }
    if (highlight) {
      const x = clamp01(highlight.x);
      const y = clamp01(highlight.y);
      const w = Math.min(clamp01(highlight.w), 1 - x);
      const h = Math.min(clamp01(highlight.h), 1 - y);
      if (w < 0.005 || h < 0.005) {
        dropped.push('empty highlight box');
        highlight = null;
      } else highlight = { x, y, w, h, label: highlight.label.slice(0, 200) };
    }
    const steps = out.stepsToReproduce
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    return {
      output: {
        ...out,
        title: out.title.trim().slice(0, 300) || redactText(input.note).slice(0, 120),
        stepsToReproduce: steps,
        component,
        highlight,
        // Facts from QAForge win over what the model read off the screenshot.
        environment: {
          ...out.environment,
          browser: input.browser ?? out.environment.browser,
          os: input.os ?? out.environment.os,
        },
        confidence: Math.round(clamp01(out.confidence) * 100) / 100,
      },
      dropped,
    };
  },
};
