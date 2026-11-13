import { Injectable } from '@nestjs/common';
import { decryptJson, encryptJson, Prisma } from '@qaforge/db';
import {
  DEFAULT_AI_MODEL,
  type AgentId,
  type AiSettingsInput,
  type AiSettingsView,
} from '@qaforge/shared';
import { AuditService, type Actor } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.module';

/** Stored under organization.settings.ai. The API key is encrypted and never returned. */
export interface StoredAiSettings {
  model?: string;
  apiKeyEnc?: string | null;
  monthlyBudgetUsd?: number | null;
  disabledAgents?: AgentId[];
}

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stored(orgId: string): Promise<StoredAiSettings> {
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { settings: true },
    });
    return ((org.settings as { ai?: StoredAiSettings }).ai ?? {}) as StoredAiSettings;
  }

  view(s: StoredAiSettings): AiSettingsView {
    return {
      provider: 'anthropic',
      model: s.model ?? process.env.AI_DEFAULT_MODEL ?? DEFAULT_AI_MODEL,
      hasApiKey: !!s.apiKeyEnc,
      usingServerKey: !s.apiKeyEnc && !!process.env.ANTHROPIC_API_KEY,
      monthlyBudgetUsd: s.monthlyBudgetUsd ?? null,
      disabledAgents: s.disabledAgents ?? [],
    };
  }

  /** True when agents can call a model (org key, server key, or the offline fake provider). */
  isConfigured(s: StoredAiSettings) {
    return (
      !!s.apiKeyEnc || !!process.env.ANTHROPIC_API_KEY || process.env.QAFORGE_AI_PROVIDER === 'fake'
    );
  }

  apiKey(s: StoredAiSettings): string | undefined {
    return s.apiKeyEnc ? decryptJson<string>(s.apiKeyEnc) : process.env.ANTHROPIC_API_KEY;
  }

  async update(actor: Actor, orgId: string, input: AiSettingsInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { settings: true },
      });
      const settings = (org.settings ?? {}) as { ai?: StoredAiSettings };
      const before = settings.ai ?? {};
      const next: StoredAiSettings = {
        model: input.model,
        monthlyBudgetUsd: input.monthlyBudgetUsd,
        disabledAgents: input.disabledAgents,
        apiKeyEnc:
          input.apiKey === undefined
            ? (before.apiKeyEnc ?? null)
            : input.apiKey === null
              ? null
              : encryptJson(input.apiKey),
      };
      await tx.organization.update({
        where: { id: orgId },
        data: { settings: { ...settings, ai: next } as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(tx, actor, {
        organizationId: orgId,
        entityType: 'ai_settings',
        entityId: orgId,
        action: 'update',
        before: {
          model: before.model,
          monthlyBudgetUsd: before.monthlyBudgetUsd,
          disabledAgents: before.disabledAgents,
          apiKey: before.apiKeyEnc ? 'set' : 'not set',
        },
        // The key itself is never written to the audit log.
        after: {
          model: next.model,
          monthlyBudgetUsd: next.monthlyBudgetUsd,
          disabledAgents: next.disabledAgents,
          apiKey: next.apiKeyEnc ? 'set' : 'not set',
        },
      });
      return this.view(next);
    });
  }

  monthStart(d = new Date()) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  async monthSpend(orgId: string): Promise<number> {
    const agg = await this.prisma.client.aiUsage.aggregate({
      where: { organizationId: orgId, createdAt: { gte: this.monthStart() } },
      _sum: { costUsd: true },
    });
    return Number(agg._sum.costUsd ?? 0);
  }

  /** Usage dashboard: this month's totals by agent, model and day. */
  async usage(orgId: string) {
    const since = this.monthStart();
    const where = { organizationId: orgId, createdAt: { gte: since } };
    const sum = {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      costUsd: true,
    } as const;
    const [byAgent, byModel, daily, jobs, stored] = await Promise.all([
      this.prisma.client.aiUsage.groupBy({ by: ['agent'], where, _sum: sum, _count: true }),
      this.prisma.client.aiUsage.groupBy({ by: ['model'], where, _sum: sum, _count: true }),
      this.prisma.client.$queryRaw<{ day: Date; cost: Prisma.Decimal; calls: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, SUM("costUsd") AS cost, COUNT(*) AS calls
        FROM ai_usage WHERE "organizationId" = ${orgId}::uuid AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.client.agentJob.groupBy({ by: ['status'], where, _count: true }),
      this.stored(orgId),
    ]);
    const row = (g: {
      _sum: {
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        costUsd: Prisma.Decimal | null;
      };
      _count: number;
    }) => ({
      calls: g._count,
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
      cacheReadTokens: g._sum.cacheReadTokens ?? 0,
      costUsd: Number(g._sum.costUsd ?? 0),
    });
    const totalCost = byAgent.reduce((a, g) => a + Number(g._sum.costUsd ?? 0), 0);
    return {
      since: since.toISOString(),
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      monthlyBudgetUsd: stored.monthlyBudgetUsd ?? null,
      byAgent: byAgent.map((g) => ({ agent: g.agent, ...row(g) })),
      byModel: byModel.map((g) => ({ model: g.model, ...row(g) })),
      daily: daily.map((d) => ({
        day: d.day.toISOString().slice(0, 10),
        costUsd: Number(d.cost),
        calls: Number(d.calls),
      })),
      jobs: Object.fromEntries(jobs.map((j) => [j.status, j._count])),
    };
  }
}
