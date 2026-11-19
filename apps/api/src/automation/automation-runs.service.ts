import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { generateProjectToken, hashToken, insertAutomationRun, Prisma } from '@qaforge/db';
import { nextCronRun, validateCron } from '@qaforge/runner';
import {
  formatRef,
  QUEUES,
  type AutomationJob,
  type AutomationScheduleInput,
  type AutomationSelection,
  type CiTriggerInput,
  type StartAutomationRunInput,
} from '@qaforge/shared';
import { AuditService } from '../audit/audit.service';
import type { ProjectCtx } from '../common/project-scope';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.module';

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const withRef = <T extends { seq: number }>(r: T) => ({
  ...r,
  ref: formatRef('automationRun', r.seq),
});

@Injectable()
export class AutomationRunsService implements OnModuleDestroy {
  private readonly connection = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  private readonly queue = new Queue<AutomationJob>(QUEUES.automation, {
    connection: this.connection,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.connection.on('error', () => undefined);
  }

  async onModuleDestroy() {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }

  private enqueue(runId: string) {
    return this.queue.add(
      'run',
      { automationRunId: runId },
      { jobId: runId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }

  /** Every id in the selection must exist in this project. */
  private async assertSelection(tx: Tx, projectId: string, s: AutomationSelection) {
    if (s.kind === 'tests') {
      const n = await tx.automationTest.count({
        where: { id: { in: s.testIds }, projectId, deletedAt: null },
      });
      if (n !== new Set(s.testIds).size) throw new BadRequestException('Some tests were not found');
    } else if (s.kind === 'collections') {
      const n = await tx.apiCollection.count({ where: { id: { in: s.collectionIds }, projectId } });
      if (n !== new Set(s.collectionIds).size)
        throw new BadRequestException('Some collections were not found');
    }
  }

  private async assertEnv(tx: Tx, projectId: string, environmentId: string | null | undefined) {
    if (
      environmentId &&
      !(await tx.environment.findFirst({ where: { id: environmentId, projectId } }))
    )
      throw new BadRequestException('Environment not found');
  }

  async start(ctx: ProjectCtx, input: StartAutomationRunInput) {
    const run = await this.prisma.client.$transaction(async (tx) => {
      await this.assertSelection(tx, ctx.projectId, input.selection);
      await this.assertEnv(tx, ctx.projectId, input.environmentId);
      const r = await insertAutomationRun(tx, {
        projectId: ctx.projectId,
        trigger: 'MANUAL',
        triggerRef: ctx.actor.id,
        selection: json(input.selection),
        environmentId: input.environmentId ?? null,
        build: input.build ?? null,
        retries: input.retries,
        createdById: ctx.actor.id,
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_run',
        entityId: r.id,
        action: 'start',
        after: { ref: formatRef('automationRun', r.seq), selection: input.selection },
      });
      return r;
    });
    await this.enqueue(run.id);
    return withRef(run);
  }

  async list(projectId: string, limit = 50) {
    const rows = await this.prisma.client.automationRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        environment: { select: { id: true, name: true } },
        schedule: { select: { id: true, name: true } },
        testRun: { select: { id: true, seq: true } },
      },
    });
    return rows.map((r) => ({
      ...withRef(r),
      testRun: r.testRun ? { ...r.testRun, ref: formatRef('testRun', r.testRun.seq) } : null,
    }));
  }

  async get(projectId: string, idOrRef: string) {
    const seq = /^AUT-(\d+)$/i.exec(idOrRef)?.[1];
    const run = await this.prisma.client.automationRun.findFirst({
      where: seq ? { projectId, seq: Number(seq) } : { projectId, id: idOrRef },
      include: {
        environment: { select: { id: true, name: true, baseUrl: true } },
        schedule: { select: { id: true, name: true } },
        testRun: { select: { id: true, seq: true } },
        results: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            status: true,
            flaky: true,
            attempts: true,
            durationMs: true,
            error: true,
            failureClass: true,
            analysis: true,
            automationTestId: true,
            apiRequestId: true,
            position: true,
            runResult: { select: { id: true } },
            automationTest: { select: { id: true, path: true, status: true, testCaseId: true } },
            apiRequest: { select: { id: true, method: true, testCaseId: true } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Automation run not found');
    const files = await this.prisma.client.attachment.groupBy({
      by: ['entityId'],
      where: {
        projectId,
        entityType: 'automation_result',
        entityId: { in: run.results.map((r) => r.id) },
      },
      _count: true,
    });
    const counts = new Map(files.map((f) => [f.entityId, f._count]));
    return {
      ...withRef(run),
      testRun: run.testRun ? { ...run.testRun, ref: formatRef('testRun', run.testRun.seq) } : null,
      results: run.results.map((r) => ({ ...r, attachmentCount: counts.get(r.id) ?? 0 })),
    };
  }

  async result(projectId: string, id: string) {
    const r = await this.prisma.client.automationResult.findFirst({
      where: { id, automationRun: { projectId } },
      include: {
        automationRun: { select: { id: true, seq: true, build: true, environmentId: true } },
        runResult: { select: { id: true, testRunId: true } },
      },
    });
    if (!r) throw new NotFoundException('Result not found');
    const attachments = await this.prisma.client.attachment.findMany({
      where: { projectId, entityType: 'automation_result', entityId: id },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        size: true,
        scanStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { ...r, attachments };
  }

  async cancel(ctx: ProjectCtx, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const run = await tx.automationRun.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!run) throw new NotFoundException('Automation run not found');
      if (run.status !== 'QUEUED' && run.status !== 'RUNNING') return withRef(run);
      const r = await tx.automationRun.update({
        where: { id },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_run',
        entityId: id,
        action: 'cancel',
      });
      await this.queue.remove(id).catch(() => undefined);
      return withRef(r);
    });
  }

  /** Pre-fill for "Report bug" from a failed automation result (the tester reviews and submits). */
  async bugDraft(projectId: string, resultId: string) {
    const r = await this.result(projectId, resultId);
    const run = r.automationRun;
    const exchange = r.exchange as {
      request?: { method: string; url: string };
      response?: { status: number; body: string };
    } | null;
    const steps = exchange?.request
      ? [`Send ${exchange.request.method} ${exchange.request.url}`]
      : [`Run the automated test "${r.name}"`];
    return {
      title: `${r.name} fails in ${formatRef('automationRun', run.seq)}`,
      stepsToReproduce: steps,
      expectedResult: 'The test passes.',
      actualResult: [
        r.error,
        exchange?.response
          ? `Response ${exchange.response.status}: ${exchange.response.body.slice(0, 500)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 4000),
      severity: 'MAJOR' as const,
      priority: 'MEDIUM' as const,
      environmentId: run.environmentId,
      envDetails: run.build ? { build: run.build } : {},
      testRunResultId: r.runResult?.id ?? null,
    };
  }

  // ---- schedules -------------------------------------------------------------------

  schedules(projectId: string) {
    return this.prisma.client.automationSchedule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { environment: { select: { id: true, name: true } } },
    });
  }

  private checkCron(cron: string, tz: string) {
    try {
      validateCron(cron, tz);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  async createSchedule(ctx: ProjectCtx, input: AutomationScheduleInput) {
    this.checkCron(input.cron, input.timezone);
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertSelection(tx, ctx.projectId, input.selection);
      await this.assertEnv(tx, ctx.projectId, input.environmentId);
      const s = await tx.automationSchedule.create({
        data: {
          projectId: ctx.projectId,
          name: input.name,
          cron: input.cron,
          timezone: input.timezone,
          selection: json(input.selection),
          environmentId: input.environmentId ?? null,
          enabled: input.enabled,
          nextRunAt: input.enabled ? nextCronRun(input.cron, input.timezone) : null,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_schedule',
        entityId: s.id,
        action: 'create',
        after: { name: s.name, cron: s.cron, timezone: s.timezone },
      });
      return s;
    });
  }

  async updateSchedule(ctx: ProjectCtx, id: string, input: Partial<AutomationScheduleInput>) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.automationSchedule.findFirst({
        where: { id, projectId: ctx.projectId },
      });
      if (!before) throw new NotFoundException('Schedule not found');
      const cron = input.cron ?? before.cron;
      const tz = input.timezone ?? before.timezone;
      this.checkCron(cron, tz);
      if (input.selection) await this.assertSelection(tx, ctx.projectId, input.selection);
      if (input.environmentId !== undefined)
        await this.assertEnv(tx, ctx.projectId, input.environmentId);
      const enabled = input.enabled ?? before.enabled;
      const s = await tx.automationSchedule.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          cron,
          timezone: tz,
          ...(input.selection && { selection: json(input.selection) }),
          ...(input.environmentId !== undefined && { environmentId: input.environmentId }),
          enabled,
          nextRunAt: enabled ? nextCronRun(cron, tz) : null,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_schedule',
        entityId: id,
        action: 'update',
        before: {
          name: before.name,
          cron: before.cron,
          timezone: before.timezone,
          enabled: before.enabled,
        },
        after: { name: s.name, cron: s.cron, timezone: s.timezone, enabled: s.enabled },
      });
      return s;
    });
  }

  async deleteSchedule(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const s = await tx.automationSchedule.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!s) throw new NotFoundException('Schedule not found');
      await tx.automationSchedule.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'automation_schedule',
        entityId: id,
        action: 'delete',
        before: { name: s.name },
      });
    });
  }

  // ---- CI tokens + webhook -------------------------------------------------------------

  tokens(projectId: string) {
    return this.prisma.client.projectToken.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createToken(ctx: ProjectCtx, input: { name: string; expiresInDays: number | null }) {
    const { token, prefix, hash } = generateProjectToken();
    const row = await this.prisma.client.$transaction(async (tx) => {
      const t = await tx.projectToken.create({
        data: {
          projectId: ctx.projectId,
          name: input.name,
          prefix,
          tokenHash: hash,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86_400_000)
            : null,
          createdById: ctx.actor.id,
        },
      });
      // The token itself is never written to the audit log.
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'project_token',
        entityId: t.id,
        action: 'create',
        after: { name: t.name, prefix },
      });
      return t;
    });
    return { id: row.id, name: row.name, prefix, expiresAt: row.expiresAt, token };
  }

  async revokeToken(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const t = await tx.projectToken.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!t) throw new NotFoundException('Token not found');
      await tx.projectToken.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'project_token',
        entityId: id,
        action: 'revoke',
      });
    });
  }

  /** Resolve a CI bearer token to its project (401 for missing, unknown, revoked or expired). */
  async authenticateToken(authorization: string | undefined) {
    const raw = /^Bearer\s+(qaf_ci_[\w-]+)$/i.exec(authorization ?? '')?.[1];
    if (!raw)
      throw new UnauthorizedException('Send a project token: Authorization: Bearer qaf_ci_…');
    const t = await this.prisma.client.projectToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: {
        project: {
          select: {
            id: true,
            organizationId: true,
            key: true,
            organization: { select: { slug: true } },
          },
        },
      },
    });
    if (
      !t ||
      t.revokedAt ||
      (t.expiresAt && t.expiresAt < new Date()) ||
      !t.scopes.includes('automation:run')
    )
      throw new UnauthorizedException('This token is not valid (revoked, expired or unknown)');
    await this.prisma.client.projectToken.update({
      where: { id: t.id },
      data: { lastUsedAt: new Date() },
    });
    return t;
  }

  private runUrl(t: { project: { key: string; organization: { slug: string } } }, ref: string) {
    const base = env().PUBLIC_APP_URL ?? env().WEB_URL;
    return `${base}/${t.project.organization.slug}/p/${t.project.key}/automation/runs/${ref}`;
  }

  /** CI webhook. The same Idempotency-Key returns the same run, so CI retries never double-run. */
  async ciTrigger(
    authorization: string | undefined,
    idempotencyKey: string | undefined,
    input: CiTriggerInput,
  ) {
    const t = await this.authenticateToken(authorization);
    const projectId = t.project.id;
    const key = idempotencyKey?.trim().slice(0, 200) || null;
    if (key) {
      const existing = await this.prisma.client.automationRun.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey: key } },
      });
      if (existing) return { ...this.ciView(t, existing), duplicate: true };
    }
    try {
      const run = await this.prisma.client.$transaction(async (tx) => {
        await this.assertSelection(tx, projectId, input.selection);
        const envRow = input.environment
          ? await tx.environment.findFirst({
              where: { projectId, name: { equals: input.environment, mode: 'insensitive' } },
            })
          : null;
        if (input.environment && !envRow)
          throw new BadRequestException(`Environment "${input.environment}" not found`);
        const r = await insertAutomationRun(tx, {
          projectId,
          trigger: 'CI_WEBHOOK',
          triggerRef: input.ref ?? `token:${t.prefix}`,
          idempotencyKey: key,
          selection: json(input.selection),
          environmentId: envRow?.id ?? null,
          build: input.build ?? null,
          createdById: t.createdById,
        });
        await this.audit.record(
          tx,
          { type: 'API_TOKEN', id: t.id },
          {
            organizationId: t.project.organizationId,
            projectId,
            entityType: 'automation_run',
            entityId: r.id,
            action: 'start',
            metadata: { trigger: 'CI_WEBHOOK', token: t.prefix, ref: input.ref ?? null },
          },
        );
        return r;
      });
      await this.enqueue(run.id);
      return { ...this.ciView(t, run), duplicate: false };
    } catch (e) {
      // Two concurrent retries with the same key: the loser returns the winner's run.
      if (key && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.client.automationRun.findUniqueOrThrow({
          where: { projectId_idempotencyKey: { projectId, idempotencyKey: key } },
        });
        return { ...this.ciView(t, existing), duplicate: true };
      }
      throw e;
    }
  }

  async ciStatus(authorization: string | undefined, ref: string) {
    const t = await this.authenticateToken(authorization);
    const seq = Number(/^AUT-(\d+)$/i.exec(ref)?.[1]);
    const run = seq
      ? await this.prisma.client.automationRun.findFirst({
          where: { projectId: t.project.id, seq },
        })
      : null;
    if (!run) throw new NotFoundException('Automation run not found');
    return this.ciView(t, run);
  }

  private ciView(
    t: Parameters<AutomationRunsService['runUrl']>[0],
    run: {
      id: string;
      seq: number;
      status: string;
      totals: Prisma.JsonValue;
      createdAt: Date;
      finishedAt: Date | null;
    },
  ) {
    const ref = formatRef('automationRun', run.seq);
    return {
      id: run.id,
      ref,
      status: run.status,
      totals: run.totals,
      url: this.runUrl(t, ref),
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      done: !['QUEUED', 'RUNNING'].includes(run.status),
    };
  }
}
