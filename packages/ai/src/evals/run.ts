/**
 * Agent evals against a real model. Costs money: roughly $0.50-$2 per full run on Claude Opus 5.5.
 *   pnpm --filter @qaforge/ai build && pnpm --filter @qaforge/ai eval            (uses ANTHROPIC_API_KEY)
 *   pnpm --filter @qaforge/ai eval -- --model claude-sonnet-5-5 --only writer
 *   pnpm --filter @qaforge/ai eval -- --fake      (harness self-check, no API calls)
 */
import {
  AnthropicProvider,
  costUsd,
  FakeProvider,
  automationRepairAgent,
  automationWriterAgent,
  bugAgent,
  failureAnalysisAgent,
  requirementAgent,
  runAgent,
  testCaseReviewerAgent,
  testCaseWriterAgent,
  type AgentDefinition,
  type ModelProvider,
} from '../index';
import type { z } from 'zod';
import {
  automationRepairCases,
  automationWriterCases,
  bugCases,
  failureAnalysisCases,
  requirementCases,
  reviewerCases,
  writerCases,
  type EvalCase,
} from './cases';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const fake = args.includes('--fake');
const model = arg('model') ?? 'claude-opus-5-5';
const only = arg('only');

// --fake: schema-valid empty outputs, so the harness (inputs, agents, checks, reporting) runs without API calls.
const EMPTY: Record<string, unknown> = {
  requirement: { summary: '', requirements: [], documentQuestions: [] },
  'test-case-writer': { testCases: [], skipped: [], coverageNotes: '' },
  'test-case-reviewer': {
    verdict: 'good',
    score: 100,
    summary: '',
    issues: [],
    missingCoverage: [],
    suggestedSteps: null,
  },
  bug: {
    title: '',
    summary: '',
    stepsToReproduce: [],
    expectedResult: '',
    actualResult: '',
    severity: 'MINOR',
    priority: 'LOW',
    component: null,
    environment: { browser: null, os: null, device: null, viewport: null },
    highlight: null,
    missingInfo: [],
    confidence: 0,
    rationale: '',
  },
};
Object.assign(EMPTY, {
  'automation-repair': {
    isTestProblem: false,
    summary: '',
    fixedCode: '',
    changes: [],
    confidence: 0,
  },
  automation: { fileName: 'x.spec.ts', code: '', envVars: [], assumptions: [], confidence: 0 },
  'failure-analysis': {
    failureClass: 'FLAKY',
    confidence: 0,
    reasoning: '',
    evidence: '',
    suggestedAction: '',
    locatorIssue: false,
  },
});
const MARKER: Record<string, string> = {
  'automation-repair': 'repairing a Playwright test',
  automation: 'Automation Agent',
  'failure-analysis': 'Failure Analysis Agent',
  requirement: 'Requirement Agent',
  'test-case-writer': 'Test Case Writer',
  'test-case-reviewer': 'Test Case Reviewer',
  bug: 'Bug Agent',
};
const provider: ModelProvider = fake
  ? new FakeProvider(
      (req) => EMPTY[Object.keys(EMPTY).find((k) => req.system.includes(MARKER[k]!))!],
    )
  : new AnthropicProvider();

async function suite<I extends z.ZodType, O extends z.ZodType>(
  agent: AgentDefinition<I, O>,
  cases: EvalCase<z.input<I>, z.infer<O>>[],
) {
  let pass = 0;
  let cost = 0;
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const run = await runAgent(agent, c.input, { provider, model });
      cost += fake ? 0 : costUsd(run.call.model, run.call.usage);
      const failures = c.checks(run.output, run.dropped);
      if (failures.length === 0) pass++;
      console.log(
        `${failures.length ? '✗' : '✓'} [${agent.id}] ${c.name} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${run.call.usage.outputTokens} out)`,
      );
      failures.forEach((f) => console.log(`    - ${f}`));
    } catch (e) {
      console.log(`✗ [${agent.id}] ${c.name}: ${(e as Error).message}`);
    }
  }
  return { pass, total: cases.length, cost };
}

async function main() {
  console.log(`QAForge agent evals · model ${fake ? 'fake (harness check)' : model}\n`);
  const results = [];
  if (!only || only === 'requirement')
    results.push(await suite(requirementAgent, requirementCases));
  if (!only || only === 'writer') results.push(await suite(testCaseWriterAgent, writerCases));
  if (!only || only === 'reviewer') results.push(await suite(testCaseReviewerAgent, reviewerCases));
  if (!only || only === 'bug') results.push(await suite(bugAgent, bugCases));
  if (!only || only === 'automation') {
    results.push(await suite(automationWriterAgent, automationWriterCases));
    results.push(await suite(automationRepairAgent, automationRepairCases));
  }
  if (!only || only === 'failure')
    results.push(await suite(failureAnalysisAgent, failureAnalysisCases));
  const pass = results.reduce((a, r) => a + r.pass, 0);
  const total = results.reduce((a, r) => a + r.total, 0);
  const cost = results.reduce((a, r) => a + r.cost, 0);
  console.log(`\n${pass}/${total} cases passed · estimated cost $${cost.toFixed(3)}`);
  if (!fake && pass < total) process.exitCode = 1;
}

void main();
