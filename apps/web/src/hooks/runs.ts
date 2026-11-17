'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTestRunInput,
  RecordResultInput,
  ResultStatus,
  UpdateTestRunInput,
} from '@qaforge/shared';
import { api } from '@/lib/api';
import type { AttachmentRow, RunResultDetail, RunResultRow, TestRunRow } from '@/lib/types';

const p = (pid: string) => `/v1/projects/${pid}`;

export const runKeys = {
  all: (pid: string) => ['project', pid, 'runs'] as const,
  list: (pid: string, qs: string) => ['project', pid, 'runs', 'list', qs] as const,
  byRef: (pid: string, ref: string) => ['project', pid, 'runs', 'ref', ref] as const,
  results: (pid: string, runId: string) => ['project', pid, 'runs', runId, 'results'] as const,
  result: (pid: string, id: string) => ['project', pid, 'run-results', id] as const,
};

export function useTestRuns(pid: string | undefined, q: { status?: string; q?: string } = {}) {
  const qs = new URLSearchParams(
    Object.entries(q).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return useQuery({
    queryKey: runKeys.list(pid ?? '', qs),
    queryFn: () =>
      api.get<{ items: TestRunRow[]; total: number }>(`${p(pid!)}/test-runs?pageSize=200&${qs}`),
    enabled: !!pid,
    placeholderData: keepPreviousData,
  });
}

export function useTestRunByRef(pid: string | undefined, ref: string | undefined) {
  const seq = Number(/(\d+)$/.exec(ref ?? '')?.[1]);
  return useQuery({
    queryKey: runKeys.byRef(pid ?? '', ref ?? ''),
    queryFn: () => api.get<TestRunRow>(`${p(pid!)}/test-runs/by-ref/${seq}`),
    enabled: !!pid && Number.isFinite(seq),
  });
}

export function useRunResults(pid: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: runKeys.results(pid ?? '', runId ?? ''),
    queryFn: () => api.get<RunResultRow[]>(`${p(pid!)}/test-runs/${runId}/results`),
    enabled: !!pid && !!runId,
  });
}

export function useRunResult(pid: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: runKeys.result(pid ?? '', id ?? ''),
    queryFn: () => api.get<RunResultDetail>(`${p(pid!)}/run-results/${id}`),
    enabled: !!pid && !!id,
  });
}

export function useCreateTestRun(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTestRunInput) => api.post<TestRunRow>(`${p(pid)}/test-runs`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.all(pid) }),
  });
}

export function useUpdateTestRun(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTestRunInput) =>
      api.patch<TestRunRow>(`${p(pid)}/test-runs/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.all(pid) }),
  });
}

/**
 * Record a result. Optimistic: the case list and counters update instantly so testers can
 * keep pressing P/F/B/S; the server response then replaces the cached detail.
 */
export function useRecordResult(pid: string, runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: RecordResultInput & { id: string }) =>
      api.patch<RunResultDetail>(`${p(pid)}/run-results/${id}`, input),
    onMutate: async ({ id, status }) => {
      if (!status) return;
      const key = runKeys.results(pid, runId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RunResultRow[]>(key);
      qc.setQueryData<RunResultRow[]>(key, (rows) =>
        rows?.map((r) => (r.id === id ? { ...r, status: status as ResultStatus } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(runKeys.results(pid, runId), ctx.prev);
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: runKeys.result(pid, id) });
      void qc.invalidateQueries({ queryKey: runKeys.all(pid) });
    },
  });
}

export function useUploadEvidence(pid: string, resultId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api.upload<AttachmentRow>(`${p(pid)}/run-results/${resultId}/attachments`, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: runKeys.result(pid, resultId) }),
  });
}
