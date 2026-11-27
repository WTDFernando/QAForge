'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ApprovalDecisionInput,
  CreateReportInput,
  GateInput,
  GateResult,
  ReadinessBand,
  ReleaseInput,
  ReleaseMetrics,
  ReleaseScopeInput,
  ReleaseStatus,
  ReportDoc,
  ReportNarrative,
  ReportScheduleInput,
  ReportType,
  ExportFormat,
} from '@qaforge/shared';
import { api } from '@/lib/api';

const p = (pid: string) => `/v1/projects/${pid}`;
const onError = (e: Error) => toast.error(e.message);

export const relKeys = {
  all: (pid: string) => ['project', pid, 'releases'] as const,
  one: (pid: string, ref: string) => ['project', pid, 'releases', ref] as const,
  reports: (pid: string) => ['project', pid, 'reports'] as const,
  report: (pid: string, id: string) => ['project', pid, 'reports', id] as const,
  schedules: (pid: string) => ['project', pid, 'report-schedules'] as const,
};

export interface Readiness {
  score: number;
  band: ReadinessBand;
  parts: { key: string; weight: number; value: number }[];
  blockingFailed: number;
}

export interface ReleaseRow {
  id: string;
  ref: string;
  seq: number;
  name: string;
  version: string;
  description: string;
  status: ReleaseStatus;
  targetDate: string | null;
  releasedAt: string | null;
  requestedAt: string | null;
  readiness: Readiness | null;
  gatesPassed: number | null;
  gatesTotal: number | null;
  approvals: { status: 'PENDING' | 'APPROVED' | 'REJECTED' }[];
  _count: { items: number; testRuns: number };
}

export interface ReleaseDetail extends Omit<ReleaseRow, 'approvals' | '_count'> {
  createdById: string;
  requirements: {
    id: string;
    ref: string;
    title: string;
    priority: string;
    status: string;
    _count: { testCases: number };
  }[];
  bugs: {
    id: string;
    ref: string;
    title: string;
    status: string;
    severity: string;
    inScope: boolean;
  }[];
  testRuns: {
    id: string;
    ref: string;
    name: string;
    status: string;
    source: string;
    build: string | null;
    environment: { name: string } | null;
    _count: { results: number };
  }[];
  approvals: {
    id: string;
    roleLabel: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    comment: string;
    decidedAt: string | null;
    approver: { id: string; name: string; email: string; image: string | null };
  }[];
  metrics: ReleaseMetrics;
  gates: (GateResult & { id: string })[];
  readiness: Readiness;
}

export function useReleases(pid?: string) {
  return useQuery({
    queryKey: relKeys.all(pid ?? ''),
    queryFn: () => api.get<ReleaseRow[]>(`${p(pid!)}/releases`),
    enabled: !!pid,
  });
}

export function useRelease(pid?: string, ref?: string) {
  return useQuery({
    queryKey: relKeys.one(pid ?? '', ref ?? ''),
    queryFn: () => api.get<ReleaseDetail>(`${p(pid!)}/releases/${ref}`),
    enabled: !!pid && !!ref,
  });
}

/** Every release mutation refreshes the release list and details. */
function useReleaseMutation<T, R = unknown>(
  pid: string,
  fn: (input: T) => Promise<R>,
  ok?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (ok) toast.success(ok);
      void qc.invalidateQueries({ queryKey: relKeys.all(pid) });
    },
    onError,
  });
}

export const useCreateRelease = (pid: string) =>
  useReleaseMutation(pid, (input: ReleaseInput) =>
    api.post<ReleaseRow>(`${p(pid)}/releases`, input),
  );
export const useUpdateRelease = (pid: string, id: string) =>
  useReleaseMutation(
    pid,
    (input: Partial<ReleaseInput>) => api.patch(`${p(pid)}/releases/${id}`, input),
    'Release updated',
  );
export const useDeleteRelease = (pid: string) =>
  useReleaseMutation(
    pid,
    (id: string) => api.delete(`${p(pid)}/releases/${id}`),
    'Release deleted',
  );
export const useReleaseScope = (pid: string, id: string) =>
  useReleaseMutation(pid, (input: Partial<ReleaseScopeInput>) =>
    api.post(`${p(pid)}/releases/${id}/scope`, input),
  );
export const useSetGates = (pid: string, id: string) =>
  useReleaseMutation(
    pid,
    (gates: GateInput[]) => api.put(`${p(pid)}/releases/${id}/gates`, { gates }),
    'Quality gates saved',
  );
export const useSetApprovers = (pid: string, id: string) =>
  useReleaseMutation(
    pid,
    (approvers: { userId: string; roleLabel: string }[]) =>
      api.put(`${p(pid)}/releases/${id}/approvers`, { approvers }),
    'Approvers saved',
  );
export const useRequestApproval = (pid: string, id: string) =>
  useReleaseMutation(
    pid,
    () => api.post(`${p(pid)}/releases/${id}/request-approval`),
    'Approval requested. Approvers have been notified.',
  );
export const useDecide = (pid: string, id: string) =>
  useReleaseMutation(pid, (input: ApprovalDecisionInput) =>
    api.post<{ status: ReleaseStatus }>(`${p(pid)}/releases/${id}/decision`, input),
  );
export const useReopenRelease = (pid: string, id: string) =>
  useReleaseMutation(pid, () => api.post(`${p(pid)}/releases/${id}/reopen`), 'Back to draft');
export const useMarkReleased = (pid: string, id: string) =>
  useReleaseMutation(pid, () => api.post(`${p(pid)}/releases/${id}/release`), 'Marked as released');

// ---- reports ------------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  type: ReportType;
  title: string;
  status: 'QUEUED' | 'READY' | 'FAILED';
  error: string | null;
  createdAt: string;
  createdBy: string | null;
  shared: boolean;
  shareExpiresAt: string | null;
  hasNarrative: boolean;
  release: { id: string; ref: string; name: string; version: string } | null;
  schedule: { id: string; name: string } | null;
  exports: { id: string; format: ExportFormat; size: number }[];
}

export interface ReportDetail {
  id: string;
  type: ReportType;
  title: string;
  status: 'QUEUED' | 'READY' | 'FAILED';
  error: string | null;
  createdAt: string;
  params: Record<string, unknown>;
  data: ReportDoc | null;
  narrative: ReportNarrative | null;
  narrativeJob: {
    id: string;
    status: string;
    error: string | null;
    progressMessage: string | null;
  } | null;
  shared: boolean;
  shareExpiresAt: string | null;
  release: { id: string; ref: string; name: string; version: string } | null;
  schedule: { id: string; name: string } | null;
  exports: { id: string; format: ExportFormat; fileName: string; size: number }[];
}

const busy = (s?: string) => s === 'QUEUED';

export function useReports(pid?: string) {
  return useQuery({
    queryKey: relKeys.reports(pid ?? ''),
    queryFn: () => api.get<ReportRow[]>(`${p(pid!)}/reports`),
    enabled: !!pid,
    // Reports are built by the worker; refresh while any is in the queue.
    refetchInterval: (q) => (q.state.data?.some((r) => busy(r.status)) ? 2000 : false),
  });
}

export function useReport(pid?: string, id?: string) {
  return useQuery({
    queryKey: relKeys.report(pid ?? '', id ?? ''),
    queryFn: () => api.get<ReportDetail>(`${p(pid!)}/reports/${id}`),
    enabled: !!pid && !!id,
    refetchInterval: (q) => {
      const d = q.state.data;
      const narrating = d?.narrativeJob && ['QUEUED', 'RUNNING'].includes(d.narrativeJob.status);
      return busy(d?.status) || narrating || (d?.status === 'READY' && !d.exports.length)
        ? 2000
        : false;
    },
  });
}

export function useCreateReport(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportInput) => api.post<{ id: string }>(`${p(pid)}/reports`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: relKeys.reports(pid) }),
    onError,
  });
}

export function useDeleteReport(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/reports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: relKeys.reports(pid) }),
    onError,
  });
}

export function useShareReport(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expiresInDays: number) =>
      api.post<{ token: string; path: string; expiresAt: string }>(
        `${p(pid)}/reports/${id}/share`,
        {
          expiresInDays,
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: relKeys.reports(pid) }),
    onError,
  });
}

export function useUnshareReport(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`${p(pid)}/reports/${id}/share`),
    onSuccess: () => {
      toast.success('Link turned off');
      void qc.invalidateQueries({ queryKey: relKeys.reports(pid) });
    },
    onError,
  });
}

export interface ScheduleRow extends ReportScheduleInput {
  id: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export function useReportSchedules(pid?: string) {
  return useQuery({
    queryKey: relKeys.schedules(pid ?? ''),
    queryFn: () => api.get<ScheduleRow[]>(`${p(pid!)}/report-schedules`),
    enabled: !!pid,
  });
}

export function useSaveReportSchedule(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ReportScheduleInput> & { id?: string }) =>
      id
        ? api.patch<ScheduleRow>(`${p(pid)}/report-schedules/${id}`, input)
        : api.post<ScheduleRow>(`${p(pid)}/report-schedules`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: relKeys.schedules(pid) }),
  });
}

export function useDeleteReportSchedule(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/report-schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: relKeys.schedules(pid) }),
    onError,
  });
}
