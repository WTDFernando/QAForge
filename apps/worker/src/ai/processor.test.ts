import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { ConfigError, OutputError, RefusalError } from '@qaforge/ai';
import { createStorage, getPrisma, type Prisma } from '@qaforge/db';
import type { StartAgentJobInput } from '@qaforge/shared';
import { JobError } from './context';
import { extractDocument, UnsupportedDocumentError } from './documents';
import { createAiProcessor, friendlyError } from './processor';

const prisma = getPrisma();
const redis = { publish: vi.fn().mockResolvedValue(1) } as unknown as IORedis;
const process_ = createAiProcessor(redis);
const bull = (jobId: string, attemptsMade = 0) =>
  ({ data: { jobId }, attemptsMade, opts: { attempts: 3 } }) as unknown as Job<{ jobId: string }>;

let orgId: string;
let projectId: string;
let userId: string;

async function newJob(input: StartAgentJobInput, agent: string, sourceIds: string[]) {
  return prisma.agentJob.create({
    data: {
      organizationId: orgId,
      projectId,
      agent,
      input: input as Prisma.InputJsonValue,
      sourceIds,
      createdById: userId,
    },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: 'Requester', email: `w${Date.now()}@test.dev` },
  });
  userId = user.id;
  const org = await prisma.organization.create({
    data: { name: 'W Org', slug: `w-org-${Date.now()}` },
  });
  orgId = org.id;
  projectId = (
    await prisma.project.create({
      data: { organizationId: orgId, name: 'Shop', key: 'SHOP', createdById: userId },
    })
  ).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('analyze-source', () => {
  it('turns a Markdown document into draft requirements attributed to the agent', async () => {
    const storageKey = `${orgId}/${projectId}/${randomUUID()}/spec.md`;
    await createStorage().put(
      storageKey,
      Buffer.from(
        '# Checkout\n- Shoppers can pay with a saved credit card\n- A declined card shows the reason to the shopper',
      ),
      'text/markdown',
    );
    const att = await prisma.attachment.create({
      data: {
        projectId,
        storageKey,
        fileName: 'spec.md',
        contentType: 'text/markdown',
        size: 100,
        createdById: userId,
      },
    });
    const src = await prisma.requirementSource.create({
      data: { projectId, kind: 'FILE', name: 'spec.md', attachmentId: att.id, createdById: userId },
    });
    const job = await newJob({ kind: 'analyze-source', sourceId: src.id }, 'requirement', [src.id]);

    await process_(bull(job.id));

    const done = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: 'SUCCEEDED', progress: 100, model: 'fake-model' });
    expect(done.summary).toMatch(/Found 2 draft requirements in spec\.md/);
    const reqs = await prisma.requirement.findMany({
      where: { sourceId: src.id },
      orderBy: { seq: 'asc' },
    });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ status: 'DRAFT', aiGenerated: true, aiJobId: job.id, seq: 1 });
    expect(reqs[0]!.aiAnalysis as { quoteVerified: boolean; questions: string[] }).toMatchObject({
      quoteVerified: true,
      questions: [expect.any(String)],
    });
    expect(
      (await prisma.requirementSource.findUniqueOrThrow({ where: { id: src.id } })).status,
    ).toBe('PROCESSED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: reqs[0]!.id } });
    expect(audit).toMatchObject({ actorType: 'AI_AGENT', actorId: null, action: 'create' });
    expect(audit.metadata).toMatchObject({
      jobId: job.id,
      requestedBy: userId,
      agent: 'requirement',
    });
    expect(await prisma.aiUsage.count({ where: { agentJobId: job.id, provider: 'fake' } })).toBe(1);
    expect((redis.publish as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('fails cleanly on an unreadable document and marks the source failed', async () => {
    const storageKey = `${orgId}/${projectId}/${randomUUID()}/empty.md`;
    await createStorage().put(storageKey, Buffer.from('   '), 'text/markdown');
    const att = await prisma.attachment.create({
      data: {
        projectId,
        storageKey,
        fileName: 'empty.md',
        contentType: 'text/markdown',
        size: 3,
        createdById: userId,
      },
    });
    const src = await prisma.requirementSource.create({
      data: {
        projectId,
        kind: 'FILE',
        name: 'empty.md',
        attachmentId: att.id,
        createdById: userId,
      },
    });
    const job = await newJob({ kind: 'analyze-source', sourceId: src.id }, 'requirement', [src.id]);
    await expect(process_(bull(job.id))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED',
      error: '"empty.md" has no readable text',
    });
    expect(
      (await prisma.requirementSource.findUniqueOrThrow({ where: { id: src.id } })).status,
    ).toBe('FAILED');
  });
});

describe('test case jobs', () => {
  let reqId: string;

  beforeAll(async () => {
    const r = await prisma.requirement.create({
      data: {
        projectId,
        seq: 100,
        title: 'Apply discount code',
        acceptanceCriteria: ['A valid code reduces the total by its percentage'],
        priority: 'HIGH',
        createdById: userId,
        updatedById: userId,
      },
    });
    reqId = r.id;
    // An existing, similar case so duplicate detection has something to find.
    await prisma.testCase.create({
      data: {
        projectId,
        seq: 50,
        title: 'Apply discount code – happy path',
        createdById: userId,
        updatedById: userId,
      },
    });
    await prisma.projectCounter.create({ data: { projectId, kind: 'testCase', value: 50 } });
  });

  it('drafts linked test cases and flags likely duplicates', async () => {
    const job = await newJob(
      { kind: 'generate-test-cases', requirementIds: [reqId], maxCasesPerRequirement: 6 },
      'test-case-writer',
      [reqId],
    );
    await process_(bull(job.id));
    const done = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.summary).toBe('Drafted 2 test cases for REQ-0100');
    const drafts = await prisma.testCase.findMany({
      where: { aiJobId: job.id },
      include: { steps: true, requirements: true },
      orderBy: { seq: 'asc' },
    });
    expect(drafts.map((d) => d.seq)).toEqual([51, 52]);
    expect(drafts[0]).toMatchObject({
      status: 'DRAFT',
      aiGenerated: true,
      aiConfidence: 0.82,
      technique: 'POSITIVE',
    });
    expect(drafts[0]!.requirements[0]!.requirementId).toBe(reqId);
    expect(drafts[0]!.steps).toHaveLength(2);
    expect((drafts[0]!.aiNotes as { duplicates: { ref: string }[] }).duplicates[0]!.ref).toBe(
      'TC-0050',
    );
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: drafts[0]!.id } })).toBe(1);
  });

  it('stores review suggestions without changing the test case', async () => {
    const tc = await prisma.testCase.findFirstOrThrow({ where: { seq: 50, projectId } });
    const job = await newJob(
      { kind: 'review-test-case', testCaseId: tc.id },
      'test-case-reviewer',
      [tc.id],
    );
    await process_(bull(job.id));
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(after.version).toBe(tc.version);
    expect((after.aiNotes as { review: { verdict: string; jobId: string } }).review).toMatchObject({
      verdict: 'needs_changes',
      jobId: job.id,
    });
    // The fake reviewer flags "step 1", but TC-0050 has no steps: the agent's post-check drops it.
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).summary).toBe(
      'TC-0050: 0 issues found (score 72)',
    );
  });

  it('scores a requirement without changing its content', async () => {
    const job = await newJob({ kind: 'analyze-requirement', requirementId: reqId }, 'requirement', [
      reqId,
    ]);
    await process_(bull(job.id));
    const r = await prisma.requirement.findUniqueOrThrow({ where: { id: reqId } });
    expect(r.title).toBe('Apply discount code');
    expect(r.clarityScore).toBeGreaterThan(0);
    expect(
      (r.aiAnalysis as { suggestedCriteria: string[] }).suggestedCriteria.length,
    ).toBeGreaterThan(0);
  });
});

describe('job guards', () => {
  it('skips cancelled jobs', async () => {
    const job = await newJob(
      { kind: 'analyze-requirement', requirementId: randomUUID() },
      'requirement',
      [],
    );
    await prisma.agentJob.update({ where: { id: job.id }, data: { status: 'CANCELLED' } });
    expect(await process_(bull(job.id))).toEqual({ skipped: true });
  });

  it('fails without retrying when the agent is disabled', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ai: { disabledAgents: ['requirement'] } } },
    });
    const job = await newJob(
      { kind: 'analyze-requirement', requirementId: randomUUID() },
      'requirement',
      [],
    );
    await expect(process_(bull(job.id))).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).error).toBe(
      'This agent was disabled by an Admin.',
    );
    await prisma.organization.update({ where: { id: orgId }, data: { settings: {} } });
  });

  it('fails with a clear message when no API key is configured', async () => {
    const prev = process.env.QAFORGE_AI_PROVIDER;
    process.env.QAFORGE_AI_PROVIDER = '';
    try {
      const job = await newJob(
        { kind: 'analyze-requirement', requirementId: randomUUID() },
        'requirement',
        [],
      );
      await expect(process_(bull(job.id))).rejects.toBeInstanceOf(UnrecoverableError);
      expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).error).toMatch(
        /No Anthropic API key/,
      );
    } finally {
      process.env.QAFORGE_AI_PROVIDER = prev;
    }
  });

  it('stops at the monthly budget', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ai: { monthlyBudgetUsd: 0.5 } } },
    });
    await prisma.aiUsage.create({
      data: {
        organizationId: orgId,
        agent: 'copilot',
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.6,
      },
    });
    const job = await newJob(
      { kind: 'analyze-requirement', requirementId: randomUUID() },
      'requirement',
      [],
    );
    await expect(process_(bull(job.id))).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).error).toMatch(
      /budget/,
    );
    await prisma.organization.update({ where: { id: orgId }, data: { settings: {} } });
  });

  it('keeps retrying transient errors until the last attempt', async () => {
    const job = await newJob(
      { kind: 'analyze-requirement', requirementId: randomUUID() },
      'requirement',
      [],
    );
    // Missing requirement -> JobError (not retried)
    await expect(process_(bull(job.id))).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).error).toBe(
      'The requirement was deleted',
    );
  });
});

describe('friendlyError', () => {
  it('maps errors to actionable messages and retry decisions', () => {
    expect(friendlyError(new JobError('x'))).toEqual({ message: 'x', retry: false });
    expect(friendlyError(new ConfigError('bad key'))).toEqual({ message: 'bad key', retry: false });
    expect(friendlyError(new RefusalError('cyber')).message).toMatch(/declined.*\(cyber\)/);
    expect(friendlyError(new OutputError('cut off')).retry).toBe(true);
    expect(friendlyError(Object.assign(new Error('x'), { status: 529 })).retry).toBe(true);
    expect(friendlyError(Object.assign(new Error('x'), { status: 400 }))).toEqual({
      message: 'Unexpected error while running the agent.',
      retry: false,
    });
  });
});

describe('document extraction', () => {
  it('reads text, passes PDFs and images through, flattens spreadsheets', async () => {
    expect(await extractDocument(Buffer.from('hello world'), 'text/plain', 'a.txt')).toEqual({
      kind: 'text',
      text: 'hello world',
    });
    expect(await extractDocument(Buffer.from('%PDF'), 'application/pdf', 'a.pdf')).toEqual({
      kind: 'pdf',
      base64: Buffer.from('%PDF').toString('base64'),
    });
    expect((await extractDocument(Buffer.from('x'), 'image/png', 'a.png')).kind).toBe('image');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reqs');
    ws.addRow(['ID', 'Requirement']);
    ws.addRow(['R1', { richText: [{ text: 'Users can ' }, { text: 'log in' }] }]);
    const doc = await extractDocument(
      Buffer.from(await wb.xlsx.writeBuffer()),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'r.xlsx',
    );
    expect(doc).toEqual({
      kind: 'text',
      text: '## Sheet: Reqs\nID | Requirement\nR1 | Users can log in',
    });
  });
  it('rejects unsupported, empty and oversized documents', async () => {
    await expect(
      extractDocument(Buffer.from('x'), 'application/zip', 'a.zip'),
    ).rejects.toBeInstanceOf(UnsupportedDocumentError);
    await expect(
      extractDocument(Buffer.from('x'.repeat(500_000)), 'text/plain', 'big.txt'),
    ).rejects.toThrow('too long');
  });
});
