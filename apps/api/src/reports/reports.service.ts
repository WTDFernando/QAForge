import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  EXPORT_FORMATS,
  formatRef,
  hasPermission,
  QUEUES,
  REPORT_TYPE_INFO,
  type CreateReportInput,
  type ExportFormat,
  type ReportJob,
  type ReportScheduleInput,
} from '@qaforge/shared';
import { Prisma } from '@qaforge/db';
import { nextCronRun, validateCron } from '@qaforge/runner';
import { AuditService } from '../audit/audit.service';
import { env } from '../config/env';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { AttachmentsService } from '../storage/attachments.service';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const formatOf = (fileName: string) => fileName.split('.').pop() as ExportFormat;

@Injectable()
export class ReportsService implements OnModuleDestroy {
  private readonly connection = new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  private readonly queue = new Queue<ReportJob>(QUEUES.reports, { connection: this.connection });

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attachments: AttachmentsService,
  ) {
    this.connection.on('error', () => undefined);
  }

  async onModuleDestroy() {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }

  private enqueue(reportId: string) {
    return this.queue.add(
      'generate',
      { kind: 'generate', reportId },
      { jobId: `report-${reportId}`, attempts: 2, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }

  /**
   * Current exports per report: newest file per format. (While a re-export runs, the old files
   * are still there for a moment.)
   */
  private async exportsOf(reportIds: string[]) {
    const files = await this.prisma.client.attachment.findMany({
      where: { entityType: 'report', entityId: { in: reportIds } },
      select: { id: true, entityId: true, fileName: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Set<string>();
    const order = (f: { fileName: string }) => EXPORT_FORMATS.indexOf(formatOf(f.fileName));
    return files
      .filter((f) => {
        const key = `${f.entityId}:${formatOf(f.fileName)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => order(a) - order(b));
  }

  async list(projectId: string, releaseId?: string) {
    const rows = await this.prisma.client.report.findMany({
      where: { projectId, ...(releaseId ? { releaseId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        error: true,
        createdAt: true,
        createdById: true,
        shareExpiresAt: true,
        shareTokenHash: true,
        narrative: true,
        release: { select: { id: true, seq: true, name: true, version: true } },
        schedule: { select: { id: true, name: true } },
      },
    });
    const users = await this.prisma.client.user.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.createdById).filter(Boolean) as string[])] },
      },
      select: { id: true, name: true },
    });
    const name = new Map(users.map((u) => [u.id, u.name]));
    const files = await this.exportsOf(rows.map((r) => r.id));
    return rows.map(({ shareTokenHash, narrative, ...r }) => ({
      ...r,
      createdBy: r.createdById ? (name.get(r.createdById) ?? null) : null,
      release: r.release ? { ...r.release, ref: formatRef('release', r.release.seq) } : null,
      shared: !!shareTokenHash && (!r.shareExpiresAt || r.shareExpiresAt > new Date()),
      hasNarrative: !!narrative,
      exports: files
        .filter((f) => f.entityId === r.id)
        .map((f) => ({ id: f.id, format: formatOf(f.fileName), size: f.size })),
    }));
  }

  async get(projectId: string, id: string) {
    const r = await this.prisma.client.report.findFirst({
      where: { id, projectId },
      include: {
        release: { select: { id: true, seq: true, name: true, version: true } },
        schedule: { select: { id: true, name: true } },
      },
    });
    if (!r) throw new NotFoundException('Report not found');
    const files = await this.exportsOf([r.id]);
    const { shareTokenHash, ...rest } = r;
    const job = r.aiJobId
      ? await this.prisma.client.agentJob.findUnique({
          where: { id: r.aiJobId },
          select: { id: true, status: true, error: true, progressMessage: true },
        })
      : null;
    return {
      ...rest,
      release: r.release ? { ...r.release, ref: formatRef('release', r.release.seq) } : null,
      shared: !!shareTokenHash && (!r.shareExpiresAt || r.shareExpiresAt > new Date()),
      narrativeJob: job,
      exports: files.map((f) => ({
        id: f.id,
        format: formatOf(f.fileName),
        fileName: f.fileName,
        size: f.size,
      })),
    };
  }

  /** Release and runs must belong to the project; the AI narrative needs the ai:use permission. */
  async create(ctx: ProjectCtx, input: CreateReportInput) {
    const db = this.prisma.client;
    const p = input.params;
    if (input.narrative && !hasPermission(ctx.role, 'ai:use'))
      throw new ForbiddenException('Your role can’t ask the Report Agent for a summary');
    const release = p.releaseId
      ? await db.release.findFirst({
          where: { id: p.releaseId, projectId: ctx.projectId, deletedAt: null },
        })
      : null;
    if (p.releaseId && !release) throw new BadRequestException('Release not found in this project');
    if (p.testRunIds?.length) {
      const n = await db.testRun.count({
        where: { id: { in: p.testRunIds }, projectId: ctx.projectId, deletedAt: null },
      });
      if (n !== new Set(p.testRunIds).size)
        throw new BadRequestException('Some test runs were not found');
    }
    const label = REPORT_TYPE_INFO[input.type].label;
    const title =
      input.title?.trim() ||
      (release ? `${label} · ${formatRef('release', release.seq)} ${release.name}` : label);
    const report = await db.$transaction(async (tx) => {
      const r = await tx.report.create({
        data: {
          projectId: ctx.projectId,
          releaseId: release?.id ?? null,
          type: input.type,
          title,
          params: json({
            ...p,
            from: p.from?.toISOString(),
            to: p.to?.toISOString(),
            narrative: input.narrative,
          }),
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report',
        entityId: r.id,
        action: 'create',
        after: { type: r.type, title: r.title },
      });
      return r;
    });
    await this.enqueue(report.id);
    return report;
  }

  async remove(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const r = await tx.report.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!r) throw new NotFoundException('Report not found');
      await tx.attachment.deleteMany({ where: { entityType: 'report', entityId: id } });
      await tx.report.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report',
        entityId: id,
        action: 'delete',
        before: { title: r.title },
      });
    });
  }

  // ---- read-only share links --------------------------------------------------------------

  /** The token is returned once; only its hash is stored. A new link replaces the old one. */
  async share(ctx: ProjectCtx, id: string, expiresInDays: number) {
    const token = `qaf_share_${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    await this.prisma.client.$transaction(async (tx) => {
      const r = await tx.report.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!r) throw new NotFoundException('Report not found');
      if (r.status !== 'READY') throw new BadRequestException('The report isn’t ready yet');
      await tx.report.update({
        where: { id },
        data: { shareTokenHash: hash(token), shareExpiresAt: expiresAt },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report',
        entityId: id,
        action: 'share',
        after: { expiresAt: expiresAt.toISOString() },
      });
    });
    return { token, path: `/share/${token}`, expiresAt };
  }

  async unshare(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const r = await tx.report.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!r) throw new NotFoundException('Report not found');
      await tx.report.update({
        where: { id },
        data: { shareTokenHash: null, shareExpiresAt: null },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report',
        entityId: id,
        action: 'unshare',
      });
    });
  }

  private async byToken(token: string) {
    const r = /^qaf_share_[\w-]{20,64}$/.test(token)
      ? await this.prisma.client.report.findUnique({ where: { shareTokenHash: hash(token) } })
      : null;
    // Same answer for unknown, revoked and expired links: nothing to probe.
    if (!r || r.status !== 'READY' || (r.shareExpiresAt && r.shareExpiresAt <= new Date()))
      throw new NotFoundException('This link has expired or was turned off. Ask for a new one.');
    return r;
  }

  /** What a person with the link sees: the frozen report only, no internal ids. */
  async publicView(token: string) {
    const r = await this.byToken(token);
    const files = await this.exportsOf([r.id]);
    return {
      title: r.title,
      type: r.type,
      data: r.data,
      narrative: r.narrative,
      createdAt: r.createdAt,
      expiresAt: r.shareExpiresAt,
      exports: EXPORT_FORMATS.filter((f) => files.some((x) => formatOf(x.fileName) === f)),
    };
  }

  async publicFile(token: string, format: string) {
    const r = await this.byToken(token);
    const files = await this.prisma.client.attachment.findMany({
      where: { entityType: 'report', entityId: r.id },
      orderBy: { createdAt: 'desc' },
    });
    const a = files.find((f) => formatOf(f.fileName) === format);
    if (!a) throw new NotFoundException('This export isn’t available');
    return this.attachments.signedUrl(a, 'attachment');
  }

  // ---- schedules --------------------------------------------------------------------------

  schedules(projectId: string) {
    return this.prisma.client.reportSchedule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private checkCron(cron: string, tz: string) {
    try {
      validateCron(cron, tz);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private async checkRelease(projectId: string, releaseId?: string) {
    if (!releaseId) return;
    const ok = await this.prisma.client.release.count({
      where: { id: releaseId, projectId, deletedAt: null },
    });
    if (!ok) throw new BadRequestException('Release not found in this project');
  }

  async createSchedule(ctx: ProjectCtx, input: ReportScheduleInput) {
    this.checkCron(input.cron, input.timezone);
    await this.checkRelease(ctx.projectId, input.params.releaseId);
    if (REPORT_TYPE_INFO[input.type].needs === 'release' && !input.params.releaseId)
      throw new BadRequestException('Choose a release for a Go / No-Go schedule');
    if (input.type === 'TEST_EXECUTION' && !input.params.releaseId)
      throw new BadRequestException('Choose a release: scheduled execution reports cover its runs');
    return this.prisma.client.$transaction(async (tx) => {
      const s = await tx.reportSchedule.create({
        data: {
          projectId: ctx.projectId,
          ...input,
          params: json(input.params),
          nextRunAt: input.enabled ? nextCronRun(input.cron, input.timezone) : null,
          createdById: ctx.actor.id,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report_schedule',
        entityId: s.id,
        action: 'create',
        after: { name: s.name, type: s.type, cron: s.cron, recipients: s.recipients },
      });
      return s;
    });
  }

  async updateSchedule(ctx: ProjectCtx, id: string, input: Partial<ReportScheduleInput>) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.reportSchedule.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!before) throw new NotFoundException('Schedule not found');
      const cron = input.cron ?? before.cron;
      const tz = input.timezone ?? before.timezone;
      this.checkCron(cron, tz);
      await this.checkRelease(ctx.projectId, input.params?.releaseId);
      const enabled = input.enabled ?? before.enabled;
      const s = await tx.reportSchedule.update({
        where: { id },
        data: {
          ...input,
          ...(input.params ? { params: json(input.params) } : {}),
          nextRunAt: enabled ? nextCronRun(cron, tz) : null,
        },
      });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report_schedule',
        entityId: id,
        action: 'update',
        before: { cron: before.cron, enabled: before.enabled, recipients: before.recipients },
        after: { cron: s.cron, enabled: s.enabled, recipients: s.recipients },
      });
      return s;
    });
  }

  async deleteSchedule(ctx: ProjectCtx, id: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const s = await tx.reportSchedule.findFirst({ where: { id, projectId: ctx.projectId } });
      if (!s) throw new NotFoundException('Schedule not found');
      await tx.reportSchedule.delete({ where: { id } });
      await this.audit.record(tx, ctx.actor, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        entityType: 'report_schedule',
        entityId: id,
        action: 'delete',
        before: { name: s.name },
      });
    });
  }
}
