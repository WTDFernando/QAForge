import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { formatRef, TEST_CASE_STATUSES } from '@qaforge/shared';
import { RequirePermission } from '../auth/decorators';
import { Ctx } from '../common/project-ctx.decorator';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';

/** All numbers come straight from the database. Metrics for modules not built yet are null. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(projectId: string) {
    const db = this.prisma.client;
    const liveReq = { projectId, deletedAt: null, status: { not: 'OBSOLETE' as const } };
    const covered = {
      testCases: {
        some: { testCase: { deletedAt: null, status: { not: 'DEPRECATED' as const } } },
      },
    };
    const [reqTotal, reqCovered, hiTotal, hiCovered, byStatus, aiDrafts, toReview, uncovered] =
      await Promise.all([
        db.requirement.count({ where: liveReq }),
        db.requirement.count({ where: { ...liveReq, ...covered } }),
        db.requirement.count({ where: { ...liveReq, priority: { in: ['HIGH', 'CRITICAL'] } } }),
        db.requirement.count({
          where: { ...liveReq, priority: { in: ['HIGH', 'CRITICAL'] }, ...covered },
        }),
        db.testCase.groupBy({
          by: ['status'],
          where: { projectId, deletedAt: null },
          _count: true,
        }),
        db.testCase.count({
          where: { projectId, deletedAt: null, status: 'DRAFT', aiGenerated: true },
        }),
        db.testCase.findMany({
          where: {
            projectId,
            deletedAt: null,
            OR: [{ status: 'IN_REVIEW' }, { status: 'DRAFT', aiGenerated: true }],
          },
          select: {
            id: true,
            seq: true,
            title: true,
            status: true,
            aiGenerated: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 6,
        }),
        db.requirement.findMany({
          where: { ...liveReq, priority: { in: ['HIGH', 'CRITICAL'] }, NOT: covered },
          select: { id: true, seq: true, title: true, priority: true },
          orderBy: [{ priority: 'desc' }, { seq: 'asc' }],
          take: 6,
        }),
      ]);
    const counts = Object.fromEntries(
      TEST_CASE_STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count ?? 0]),
    );
    const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 100));
    return {
      requirements: {
        total: reqTotal,
        covered: reqCovered,
        coveragePct: pct(reqCovered, reqTotal),
        highPriorityCoveragePct: pct(hiCovered, hiTotal),
      },
      testCases: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        byStatus: counts,
        aiDraftsToReview: aiDrafts,
      },
      lastRun: null,
      openBugsBySeverity: null,
      releaseReadiness: null,
      attention: {
        toReview: toReview.map((t) => ({ ...t, ref: formatRef('testCase', t.seq) })),
        uncoveredHighPriority: uncovered.map((r) => ({
          ...r,
          ref: formatRef('requirement', r.seq),
        })),
      },
    };
  }
}

@ApiTags('dashboard')
@Controller('v1/projects/:projectId/dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}
  @Get() @RequirePermission('project:read') get(@Ctx() ctx: ProjectCtx) {
    return this.svc.get(ctx.projectId);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
