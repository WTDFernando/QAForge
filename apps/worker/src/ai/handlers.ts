import {
  formatRef,
  richTextToPlain,
  type RichTextNode,
  type StartAgentJobInput,
} from '@qaforge/shared';
import {
  requirementAgent,
  runAgent,
  testCaseReviewerAgent,
  testCaseWriterAgent,
  type ModelProvider,
  type ProgressUpdate,
  type RequirementAgentOutput,
} from '@qaforge/ai';
import { createStorage, nextSeq, Prisma, type AgentJob } from '@qaforge/db';
import { auditAi, JobError, prisma, recordUsage } from './context';
import { extractDocument, UnsupportedDocumentError } from './documents';

export interface HandlerCtx {
  job: AgentJob;
  provider: ModelProvider;
  model: string;
  /** Map raw model progress to a 10-90% bar; message is shown in the agent indicator. */
  progress: (p: ProgressUpdate, expectedChars: number, message: string) => void;
  signal: AbortSignal;
}

export interface HandlerResult {
  summary: string;
  output: unknown;
}

const RANK = { EPIC: 0, FEATURE: 1, STORY: 2 } as const;

/** Plain text -> minimal Tiptap document (one paragraph per line). */
function textDoc(text: string): RichTextNode | undefined {
  const paras = text
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!paras.length) return undefined;
  return {
    type: 'doc',
    content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
  };
}

function analysisOf(
  r: RequirementAgentOutput['requirements'][number] & { quoteVerified?: boolean | null },
  jobId: string,
) {
  return {
    ambiguities: r.ambiguities,
    missingCriteria: r.missingCriteria,
    questions: r.questions,
    sourceQuote: r.sourceQuote,
    quoteVerified: r.quoteVerified ?? null,
    jobId,
    at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------

async function analyzeSource(
  ctx: HandlerCtx,
  input: Extract<StartAgentJobInput, { kind: 'analyze-source' }>,
): Promise<HandlerResult> {
  const { job } = ctx;
  const db = prisma();
  const source = await db.requirementSource.findFirst({
    where: { id: input.sourceId, projectId: job.projectId! },
    include: { attachment: true, project: true },
  });
  if (!source) throw new JobError('The source was deleted');
  if (!source.attachment)
    throw new JobError('Links can’t be analyzed yet. Upload the document instead.');
  await db.requirementSource.update({ where: { id: source.id }, data: { status: 'PROCESSING' } });

  let doc;
  try {
    doc = await extractDocument(
      await createStorage().read(source.attachment.storageKey),
      source.attachment.contentType,
      source.attachment.fileName,
    );
  } catch (e) {
    await db.requirementSource.update({ where: { id: source.id }, data: { status: 'FAILED' } });
    throw e instanceof UnsupportedDocumentError ? new JobError(e.message) : e;
  }
  const existing = await db.requirement.findMany({
    where: { projectId: job.projectId!, deletedAt: null },
    select: { title: true },
    take: 500,
  });
  const run = await runAgent(
    requirementAgent,
    {
      mode: 'split',
      projectName: source.project.name,
      sourceName: source.name,
      existingTitles: existing.map((r) => r.title),
      ...(doc.kind === 'text'
        ? { text: doc.text }
        : doc.kind === 'pdf'
          ? { pdfBase64: doc.base64 }
          : { image: { mediaType: doc.mediaType, base64: doc.base64 } }),
    },
    {
      provider: ctx.provider,
      model: ctx.model,
      signal: ctx.signal,
      onProgress: (p) => ctx.progress(p, 12000, 'Reading the document'),
    },
  );
  await recordUsage(job, ctx.provider, run.call);
  if (await cancelled(job.id)) return { summary: 'Cancelled', output: null };

  // Parents first so children can reference them.
  const items = [...run.output.requirements].sort((a, b) => RANK[a.type] - RANK[b.type]);
  const created = await db.$transaction(async (tx) => {
    const firstSeq = items.length
      ? await nextSeq(tx, job.projectId!, 'requirement', items.length)
      : 0;
    const idByKey = new Map<string, string>();
    const positions = new Map<string | null, number>();
    const out: { id: string; ref: string }[] = [];
    for (const [i, r] of items.entries()) {
      const parentId = r.parentKey ? (idByKey.get(r.parentKey) ?? null) : null;
      if (!positions.has(parentId)) {
        const max = await tx.requirement.aggregate({
          where: { projectId: job.projectId!, parentId },
          _max: { position: true },
        });
        positions.set(parentId, (max._max.position ?? -1) + 1);
      }
      const position = positions.get(parentId)!;
      positions.set(parentId, position + 1);
      const description = textDoc(r.description);
      const row = await tx.requirement.create({
        data: {
          projectId: job.projectId!,
          seq: firstSeq + i,
          type: r.type,
          title: r.title.slice(0, 300),
          description: description as Prisma.InputJsonValue | undefined,
          descriptionText: richTextToPlain(description),
          acceptanceCriteria: r.acceptanceCriteria.slice(0, 100),
          priority: r.priority,
          status: 'DRAFT',
          parentId,
          position,
          sourceId: source.id,
          clarityScore: r.clarityScore,
          aiAnalysis: analysisOf(r, job.id) as Prisma.InputJsonValue,
          aiGenerated: true,
          aiJobId: job.id,
          createdById: job.createdById,
          updatedById: job.createdById,
        },
      });
      idByKey.set(r.key, row.id);
      await tx.requirementVersion.create({
        data: {
          requirementId: row.id,
          version: 1,
          snapshot: { title: row.title, type: row.type, aiGenerated: true },
          createdById: job.createdById,
        },
      });
      await auditAi(tx, job, {
        entityType: 'requirement',
        entityId: row.id,
        action: 'create',
        after: { ref: formatRef('requirement', row.seq), title: row.title },
        metadata: { sourceId: source.id },
      });
      out.push({ id: row.id, ref: formatRef('requirement', row.seq) });
    }
    await tx.requirementSource.update({
      where: { id: source.id },
      data: {
        status: 'PROCESSED',
        analysis: {
          summary: run.output.summary,
          documentQuestions: run.output.documentQuestions,
          requirementCount: out.length,
          dropped: run.dropped,
          jobId: job.id,
        },
      },
    });
    return out;
  });
  return {
    summary: `Found ${created.length} draft requirement${created.length === 1 ? '' : 's'} in ${source.name}`,
    output: { ...run.output, created, dropped: run.dropped },
  };
}

async function analyzeRequirement(
  ctx: HandlerCtx,
  input: Extract<StartAgentJobInput, { kind: 'analyze-requirement' }>,
): Promise<HandlerResult> {
  const { job } = ctx;
  const db = prisma();
  const r = await db.requirement.findFirst({
    where: { id: input.requirementId, projectId: job.projectId!, deletedAt: null },
    include: { project: true },
  });
  if (!r) throw new JobError('The requirement was deleted');
  const text = [
    `${r.type}: ${r.title}`,
    r.descriptionText,
    r.acceptanceCriteria.length
      ? `Acceptance criteria:\n${r.acceptanceCriteria.map((c, i) => `AC${i + 1}: ${c}`).join('\n')}`
      : 'No acceptance criteria.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const run = await runAgent(
    requirementAgent,
    {
      mode: 'analyze',
      projectName: r.project.name,
      sourceName: formatRef('requirement', r.seq),
      text,
      existingTitles: [],
    },
    {
      provider: ctx.provider,
      model: ctx.model,
      signal: ctx.signal,
      onProgress: (p) => ctx.progress(p, 1500, 'Assessing clarity'),
    },
  );
  await recordUsage(job, ctx.provider, run.call);
  const item = run.output.requirements[0];
  if (!item) throw new JobError('The agent returned no assessment');
  if (await cancelled(job.id)) return { summary: 'Cancelled', output: null };
  await db.$transaction(async (tx) => {
    await tx.requirement.update({
      where: { id: r.id },
      data: {
        clarityScore: item.clarityScore,
        aiAnalysis: {
          ...analysisOf(item, job.id),
          suggestedCriteria: item.acceptanceCriteria,
        } as Prisma.InputJsonValue,
        aiJobId: job.id,
      },
    });
    await auditAi(tx, job, {
      entityType: 'requirement',
      entityId: r.id,
      action: 'analyze',
      after: { clarityScore: item.clarityScore },
    });
  });
  const ref = formatRef('requirement', r.seq);
  return {
    summary: `${ref} clarity ${item.clarityScore}/100 · ${item.questions.length} question${item.questions.length === 1 ? '' : 's'}`,
    output: run.output,
  };
}

async function generateTestCases(
  ctx: HandlerCtx,
  input: Extract<StartAgentJobInput, { kind: 'generate-test-cases' }>,
): Promise<HandlerResult> {
  const { job } = ctx;
  const db = prisma();
  const reqs = await db.requirement.findMany({
    where: { id: { in: input.requirementIds }, projectId: job.projectId!, deletedAt: null },
    include: {
      project: true,
      testCases: {
        where: { testCase: { deletedAt: null } },
        select: { testCase: { select: { seq: true, title: true } } },
      },
    },
    orderBy: { seq: 'asc' },
  });
  if (!reqs.length) throw new JobError('The requirements were deleted');
  const projectTitles = await db.testCase.findMany({
    where: { projectId: job.projectId!, deletedAt: null },
    select: { title: true },
    orderBy: { seq: 'desc' },
    take: 300,
  });
  const refToId = new Map(reqs.map((r) => [formatRef('requirement', r.seq), r.id]));
  const run = await runAgent(
    testCaseWriterAgent,
    {
      projectName: reqs[0]!.project.name,
      maxCasesPerRequirement: input.maxCasesPerRequirement,
      projectTestCaseTitles: projectTitles.map((t) => t.title),
      requirements: reqs.map((r) => ({
        ref: formatRef('requirement', r.seq),
        type: r.type,
        title: r.title,
        description: r.descriptionText,
        acceptanceCriteria: r.acceptanceCriteria,
        priority: r.priority,
        existingTestCases: r.testCases.map((l) => ({
          ref: formatRef('testCase', l.testCase.seq),
          title: l.testCase.title,
        })),
      })),
    },
    {
      provider: ctx.provider,
      model: ctx.model,
      signal: ctx.signal,
      onProgress: (p) =>
        ctx.progress(
          p,
          2500 * input.maxCasesPerRequirement * reqs.length * 0.6,
          'Drafting test cases',
        ),
    },
  );
  await recordUsage(job, ctx.provider, run.call);
  if (await cancelled(job.id)) return { summary: 'Cancelled', output: null };

  // Possible duplicates: trigram similarity against existing titles in the project (no embeddings needed).
  const duplicates = new Map<string, { ref: string; title: string; similarity: number }[]>();
  for (const tc of run.output.testCases) {
    const rows = await db.$queryRaw<{ seq: number; title: string; similarity: number }[]>`
      SELECT seq, title, similarity(title, ${tc.title})::float AS similarity FROM test_case
      WHERE "projectId" = ${job.projectId}::uuid AND "deletedAt" IS NULL AND similarity(title, ${tc.title}) > 0.5
      ORDER BY similarity DESC LIMIT 3`;
    duplicates.set(
      tc.title,
      rows.map((d) => ({
        ref: formatRef('testCase', d.seq),
        title: d.title,
        similarity: Math.round(d.similarity * 100) / 100,
      })),
    );
  }

  const created = await db.$transaction(async (tx) => {
    const n = run.output.testCases.length;
    const firstSeq = n ? await nextSeq(tx, job.projectId!, 'testCase', n) : 0;
    const out: { id: string; ref: string; duplicates: number }[] = [];
    for (const [i, tc] of run.output.testCases.entries()) {
      const requirementIds = tc.requirementRefs
        .map((ref) => refToId.get(ref))
        .filter((x): x is string => !!x);
      const dupes = duplicates.get(tc.title) ?? [];
      const row = await tx.testCase.create({
        data: {
          projectId: job.projectId!,
          seq: firstSeq + i,
          title: tc.title.slice(0, 300),
          preconditions: tc.preconditions,
          testData: (tc.testData ?? undefined) as Prisma.InputJsonValue | undefined,
          priority: tc.priority,
          type: tc.type,
          technique: tc.technique,
          status: 'DRAFT',
          tags: tc.tags,
          aiGenerated: true,
          aiConfidence: tc.confidence,
          aiNotes: {
            rationale: tc.rationale,
            coversCriteria: tc.coversCriteria,
            duplicates: dupes,
            jobId: job.id,
            model: job.model,
          } as Prisma.InputJsonValue,
          aiJobId: job.id,
          createdById: job.createdById,
          updatedById: job.createdById,
          steps: {
            create: tc.steps.map((s, position) => ({
              position,
              action: s.action,
              expected: s.expected,
            })),
          },
          requirements: {
            create: requirementIds.map((requirementId) => ({
              requirementId,
              createdById: job.createdById,
            })),
          },
        },
      });
      await tx.testCaseVersion.create({
        data: {
          testCaseId: row.id,
          version: 1,
          snapshot: {
            title: row.title,
            status: 'DRAFT',
            aiGenerated: true,
            steps: tc.steps,
            requirementIds,
          },
          createdById: job.createdById,
        },
      });
      await auditAi(tx, job, {
        entityType: 'test_case',
        entityId: row.id,
        action: 'create',
        after: { ref: formatRef('testCase', row.seq), title: row.title, status: 'DRAFT' },
      });
      out.push({ id: row.id, ref: formatRef('testCase', row.seq), duplicates: dupes.length });
    }
    return out;
  });
  const refs = reqs.map((r) => formatRef('requirement', r.seq));
  const skipped = run.output.skipped.length
    ? ` · ${run.output.skipped.length} requirement${run.output.skipped.length === 1 ? '' : 's'} too vague to test`
    : '';
  return {
    summary: `Drafted ${created.length} test case${created.length === 1 ? '' : 's'} for ${refs.length > 2 ? `${refs.length} requirements` : refs.join(', ')}${skipped}`,
    output: { ...run.output, created, dropped: run.dropped },
  };
}

async function reviewTestCase(
  ctx: HandlerCtx,
  input: Extract<StartAgentJobInput, { kind: 'review-test-case' }>,
): Promise<HandlerResult> {
  const { job } = ctx;
  const db = prisma();
  const tc = await db.testCase.findFirst({
    where: { id: input.testCaseId, projectId: job.projectId!, deletedAt: null },
    include: {
      steps: { orderBy: { position: 'asc' }, include: { sharedStep: true } },
      requirements: {
        where: { requirement: { deletedAt: null } },
        select: { requirement: { select: { seq: true, title: true, acceptanceCriteria: true } } },
      },
    },
  });
  if (!tc) throw new JobError('The test case was deleted');
  const steps = tc.steps.flatMap((s) =>
    s.sharedStep
      ? (s.sharedStep.steps as { action: string; expected: string }[])
      : [{ action: s.action, expected: s.expected }],
  );
  const siblings = await db.testCase.findMany({
    where: { projectId: job.projectId!, deletedAt: null, suiteId: tc.suiteId, id: { not: tc.id } },
    select: { title: true },
    take: 100,
  });
  const ref = formatRef('testCase', tc.seq);
  const run = await runAgent(
    testCaseReviewerAgent,
    {
      testCase: {
        ref,
        title: tc.title,
        preconditions: tc.preconditions,
        steps,
        testData: (tc.testData as never) ?? null,
        type: tc.type,
        technique: tc.technique,
      },
      requirements: tc.requirements.map((l) => ({
        ref: formatRef('requirement', l.requirement.seq),
        title: l.requirement.title,
        acceptanceCriteria: l.requirement.acceptanceCriteria,
      })),
      siblingTitles: siblings.map((s) => s.title),
    },
    {
      provider: ctx.provider,
      model: ctx.model,
      signal: ctx.signal,
      onProgress: (p) => ctx.progress(p, 2000, 'Reviewing'),
    },
  );
  await recordUsage(job, ctx.provider, run.call);
  if (await cancelled(job.id)) return { summary: 'Cancelled', output: null };
  await db.$transaction(async (tx) => {
    const notes = (tc.aiNotes as Record<string, unknown> | null) ?? {};
    // Suggestions are stored, never applied: a human decides (content changes go through the editor).
    await tx.testCase.update({
      where: { id: tc.id },
      data: {
        aiNotes: {
          ...notes,
          review: {
            ...run.output,
            jobId: job.id,
            version: tc.version,
            at: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
    await auditAi(tx, job, {
      entityType: 'test_case',
      entityId: tc.id,
      action: 'review',
      after: { score: run.output.score, verdict: run.output.verdict },
    });
  });
  const n = run.output.issues.length;
  return {
    summary: `${ref}: ${run.output.verdict === 'good' ? 'looks good' : `${n} issue${n === 1 ? '' : 's'} found`} (score ${run.output.score})`,
    output: run.output,
  };
}

async function cancelled(jobId: string) {
  const j = await prisma().agentJob.findUnique({ where: { id: jobId }, select: { status: true } });
  return j?.status === 'CANCELLED';
}

export function handle(ctx: HandlerCtx): Promise<HandlerResult> {
  const input = ctx.job.input as StartAgentJobInput;
  switch (input.kind) {
    case 'analyze-source':
      return analyzeSource(ctx, input);
    case 'analyze-requirement':
      return analyzeRequirement(ctx, input);
    case 'generate-test-cases':
      return generateTestCases(ctx, input);
    case 'review-test-case':
      return reviewTestCase(ctx, input);
  }
}
