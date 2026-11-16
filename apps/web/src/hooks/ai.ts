'use client';
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AgentJobEvent,
  AiSettingsInput,
  AiSettingsView,
  StartAgentJobInput,
} from '@qaforge/shared';
import { api } from '@/lib/api';
import { qaKeys } from './qa';
import { useMe } from './queries';

export const aiKeys = {
  settings: (orgId: string) => ['orgs', orgId, 'ai-settings'] as const,
  usage: (orgId: string) => ['orgs', orgId, 'ai-usage'] as const,
  orgJobs: (orgId: string) => ['orgs', orgId, 'agent-jobs'] as const,
  projectJobs: (pid: string, sourceId?: string) =>
    ['project', pid, 'agent-jobs', sourceId ?? 'all'] as const,
};

export interface AiUsageSummary {
  since: string;
  totalCostUsd: number;
  monthlyBudgetUsd: number | null;
  byAgent: {
    agent: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  }[];
  byModel: {
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
  }[];
  daily: { day: string; costUsd: number; calls: number }[];
  jobs: Record<string, number>;
}

export function useAiSettings(orgId?: string) {
  return useQuery({
    queryKey: aiKeys.settings(orgId ?? ''),
    queryFn: () => api.get<AiSettingsView>(`/v1/orgs/${orgId}/ai-settings`),
    enabled: !!orgId,
  });
}

export function useSaveAiSettings(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiSettingsInput) =>
      api.put<AiSettingsView>(`/v1/orgs/${orgId}/ai-settings`, input),
    onSuccess: (data) => qc.setQueryData(aiKeys.settings(orgId), data),
  });
}

export function useAiUsage(orgId?: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.usage(orgId ?? ''),
    queryFn: () => api.get<AiUsageSummary>(`/v1/orgs/${orgId}/ai-usage`),
    enabled: !!orgId && enabled,
  });
}

export function useOrgAgentJobs(orgId?: string) {
  return useQuery({
    queryKey: aiKeys.orgJobs(orgId ?? ''),
    queryFn: () => api.get<AgentJobEvent[]>(`/v1/orgs/${orgId}/agent-jobs`),
    enabled: !!orgId,
  });
}

export function useProjectAgentJobs(pid?: string, sourceId?: string) {
  return useQuery({
    queryKey: aiKeys.projectJobs(pid ?? '', sourceId),
    queryFn: () =>
      api.get<AgentJobEvent[]>(
        `/v1/projects/${pid}/agent-jobs?limit=10${sourceId ? `&sourceId=${sourceId}` : ''}`,
      ),
    enabled: !!pid,
  });
}

/** Latest job for an item (e.g. a requirement or source), kept live by the SSE feed. */
export function useLatestJob(
  pid: string | undefined,
  sourceId: string | undefined,
  kind?: StartAgentJobInput['kind'],
) {
  const jobs = useProjectAgentJobs(pid, sourceId);
  return jobs.data?.find((j) => !kind || j.kind === kind);
}

export function useStartAgentJob(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartAgentJobInput) =>
      api.post<AgentJobEvent>(`/v1/projects/${pid}/agent-jobs`, input),
    onSuccess: (job) => applyJobEvent(qc, job),
    onError: (e) => toast.error(e.message),
  });
}

export function useCancelAgentJob(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<AgentJobEvent>(`/v1/projects/${pid}/agent-jobs/${id}/cancel`),
    onSuccess: (job) => applyJobEvent(qc, job),
  });
}

/** Merge a job event into every cached job list. */
function applyJobEvent(qc: ReturnType<typeof useQueryClient>, job: AgentJobEvent) {
  const upsert = (list: AgentJobEvent[] | undefined) => {
    if (!list) return list;
    const i = list.findIndex((j) => j.id === job.id);
    if (i === -1) return [job, ...list];
    const next = [...list];
    next[i] = job;
    return next;
  };
  qc.setQueryData<AgentJobEvent[]>(aiKeys.orgJobs(job.organizationId), (l) => upsert(l ?? []));
  if (job.projectId) {
    qc.setQueriesData<AgentJobEvent[]>(
      { queryKey: ['project', job.projectId, 'agent-jobs'] },
      (l) => (l ? upsert(l) : l),
    );
    for (const sid of job.sourceIds) {
      qc.setQueryData<AgentJobEvent[]>(aiKeys.projectJobs(job.projectId, sid), (l) =>
        upsert(l ?? []),
      );
    }
  }
}

const KIND_DONE: Record<StartAgentJobInput['kind'], string> = {
  'analyze-source': 'Requirements ready for review',
  'analyze-requirement': 'Clarity assessment ready',
  'generate-test-cases': 'Test case drafts ready for review',
  'review-test-case': 'AI review ready',
  'draft-bug': 'Bug report draft ready',
};

/**
 * Subscribe to live agent job events for the organization (Server-Sent Events).
 * Updates caches, refreshes affected data when a job finishes, and toasts the requester.
 */
export function useAgentJobFeed(orgId?: string) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    if (!orgId || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/v1/orgs/${orgId}/agent-jobs/stream`, { withCredentials: true });
    es.onmessage = (msg) => {
      const job = JSON.parse(msg.data) as AgentJobEvent | { type: 'ping' };
      if ('type' in job) return;
      const prev = seen.current.get(job.id);
      seen.current.set(job.id, job.status);
      applyJobEvent(qc, job);
      const finished =
        (job.status === 'SUCCEEDED' || job.status === 'FAILED') && prev !== job.status;
      if (!finished || !job.projectId) return;
      void qc.invalidateQueries({ queryKey: qaKeys.all(job.projectId) });
      void qc.invalidateQueries({ queryKey: aiKeys.usage(orgId) });
      if (job.createdById === me?.user.id) {
        if (job.status === 'SUCCEEDED')
          toast.success(KIND_DONE[job.kind], { description: job.summary ?? undefined });
        else toast.error('AI job failed', { description: job.error ?? undefined });
      }
    };
    return () => es.close();
  }, [orgId, qc, me?.user.id]);
}
