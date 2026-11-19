'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ApiAuth,
  ApiBody,
  ApiCollectionInput,
  ApiRequestInput,
  Assertion,
  AutomationScheduleInput,
  AutomationSelection,
  AutomationTestInput,
  AutomationTestStatus,
  ExtractRule,
  FailureClass,
  HttpMethod,
  ImportCollectionInput,
  KeyValue,
  SendApiRequestInput,
  StartAutomationRunInput,
} from '@qaforge/shared';
import { api } from '@/lib/api';
import type { AttachmentRow, EnvironmentRow } from '@/lib/types';

const p = (pid: string) => `/v1/projects/${pid}`;

export const autoKeys = {
  all: (pid: string) => ['project', pid, 'automation'] as const,
  tree: (pid: string) => ['project', pid, 'automation', 'tree'] as const,
  request: (pid: string, id: string) => ['project', pid, 'automation', 'request', id] as const,
  tests: (pid: string) => ['project', pid, 'automation', 'tests'] as const,
  test: (pid: string, id: string) => ['project', pid, 'automation', 'test', id] as const,
  version: (pid: string, id: string, v: number) =>
    ['project', pid, 'automation', 'test', id, 'v', v] as const,
  runs: (pid: string) => ['project', pid, 'automation', 'runs'] as const,
  run: (pid: string, ref: string) => ['project', pid, 'automation', 'run', ref] as const,
  result: (pid: string, id: string) => ['project', pid, 'automation', 'result', id] as const,
  schedules: (pid: string) => ['project', pid, 'automation', 'schedules'] as const,
  tokens: (pid: string) => ['project', pid, 'automation', 'tokens'] as const,
};

// ---- types (mirrors the API responses) ---------------------------------------------------

export interface ApiRequestSummary {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  position: number;
  testCaseId: string | null;
  collectionId: string;
}
export interface ApiCollectionNode {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  variables: Record<string, string>;
  auth: ApiAuth;
  importedFrom: string | null;
  requests: ApiRequestSummary[];
}
export interface ApiRequestFull extends ApiRequestSummary {
  headers: KeyValue[];
  query: KeyValue[];
  body: ApiBody;
  auth: ApiAuth | null;
  assertions: Assertion[];
  extract: ExtractRule[];
  testCase: { id: string; seq: number; title: string } | null;
}
export interface AssertionOutcome {
  assertion: Assertion;
  passed: boolean;
  actual: string;
  message: string;
}
export interface ApiExchange {
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    size: number;
    truncated: boolean;
  } | null;
}
export interface ApiExecution {
  passed: boolean;
  error: string | null;
  durationMs: number;
  status: number | null;
  assertions: AssertionOutcome[];
  extracted: Record<string, string>;
  missingVariables: string[];
  exchange: ApiExchange;
}

export type ResultStatus = 'UNTESTED' | 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED' | 'RETEST';
export interface AutomationTestRow {
  id: string;
  name: string;
  path: string;
  status: AutomationTestStatus;
  tags: string[];
  version: number;
  flakyScore: number;
  testCaseId: string | null;
  hasPendingFix: boolean;
  updatedAt: string;
  lastResult: {
    status: ResultStatus;
    flaky: boolean;
    createdAt: string;
    durationMs: number | null;
  } | null;
}
export interface PendingFix {
  code: string;
  jobId: string;
  summary?: string;
  changes?: string[];
  confidence?: number;
  resultId?: string;
  baseVersion?: number;
}
export interface AutomationTestFull extends Omit<
  AutomationTestRow,
  'hasPendingFix' | 'lastResult'
> {
  code: string;
  pendingFix: PendingFix | null;
  testCase: { id: string; seq: number; title: string } | null;
  versions: { version: number; reason: string; createdAt: string; createdById: string | null }[];
}

export type RunStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR' | 'CANCELLED';
export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  quarantined: number;
  durationMs: number;
}
export interface AutomationRunRow {
  id: string;
  ref: string;
  seq: number;
  status: RunStatus;
  trigger: 'MANUAL' | 'SCHEDULE' | 'CI_WEBHOOK' | 'API';
  triggerRef: string | null;
  selection: AutomationSelection;
  build: string | null;
  retries: number;
  totals: RunTotals | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  environment: { id: string; name: string } | null;
  schedule: { id: string; name: string } | null;
  testRun: { id: string; seq: number; ref: string } | null;
}
export interface FailureAnalysis {
  confidence: number;
  reasoning: string;
  evidence: string;
  suggestedAction: string;
  locatorIssue: boolean;
  jobId?: string;
}
export interface AutomationResultRow {
  id: string;
  name: string;
  status: ResultStatus;
  flaky: boolean;
  attempts: number;
  durationMs: number | null;
  error: string | null;
  failureClass: FailureClass | null;
  analysis: FailureAnalysis | null;
  automationTestId: string | null;
  apiRequestId: string | null;
  attachmentCount: number;
  runResult: { id: string } | null;
  automationTest: { id: string; path: string; status: AutomationTestStatus } | null;
  apiRequest: { id: string; method: HttpMethod } | null;
}
export interface AutomationRunFull extends AutomationRunRow {
  results: AutomationResultRow[];
}
export interface AutomationResultFull {
  id: string;
  name: string;
  status: ResultStatus;
  log: string | null;
  error: string | null;
  exchange:
    | (ApiExchange & { assertions?: AssertionOutcome[]; extracted?: string[] })
    | {
        cases: { title: string; status: string; error: string | null; durationMs: number }[];
        driver: string;
      }
    | null;
  attachments: AttachmentRow[];
}
export interface ScheduleRow {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  selection: AutomationSelection;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  environment: { id: string; name: string } | null;
}
export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const onError = (e: Error) => toast.error(e.message);

// ---- API client ------------------------------------------------------------------------------

export function useApiTree(pid?: string) {
  return useQuery({
    queryKey: autoKeys.tree(pid ?? ''),
    queryFn: () => api.get<ApiCollectionNode[]>(`${p(pid!)}/api-collections`),
    enabled: !!pid,
  });
}

export function useApiRequest(pid?: string, id?: string | null) {
  return useQuery({
    queryKey: autoKeys.request(pid ?? '', id ?? ''),
    queryFn: () => api.get<ApiRequestFull>(`${p(pid!)}/api-requests/${id}`),
    enabled: !!pid && !!id,
  });
}

export function useSaveCollection(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ApiCollectionInput> & { id?: string }) =>
      id
        ? api.patch<ApiCollectionNode>(`${p(pid)}/api-collections/${id}`, input)
        : api.post<ApiCollectionNode>(`${p(pid)}/api-collections`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tree(pid) }),
    onError,
  });
}

export function useDeleteCollection(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/api-collections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tree(pid) }),
    onError,
  });
}

export function useSaveRequest(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ApiRequestInput> & { id?: string }) =>
      id
        ? api.patch<ApiRequestFull>(`${p(pid)}/api-requests/${id}`, input)
        : api.post<ApiRequestFull>(`${p(pid)}/api-requests`, input),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: autoKeys.tree(pid) });
      void qc.invalidateQueries({ queryKey: autoKeys.request(pid, r.id) });
    },
    onError,
  });
}

export function useDeleteRequest(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/api-requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tree(pid) }),
    onError,
  });
}

export function useSendRequest(pid: string) {
  return useMutation({
    mutationFn: (input: SendApiRequestInput) =>
      api.post<ApiExecution>(`${p(pid)}/api-requests/send`, input),
    onError,
  });
}

export function useImportCollection(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportCollectionInput) =>
      api.post<{ collectionId: string; requests: number; name: string }>(
        `${p(pid)}/api-collections/import`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tree(pid) }),
  });
}

// ---- UI tests ----------------------------------------------------------------------------------

export function useAutomationTests(pid?: string) {
  return useQuery({
    queryKey: autoKeys.tests(pid ?? ''),
    queryFn: () => api.get<AutomationTestRow[]>(`${p(pid!)}/automation-tests`),
    enabled: !!pid,
  });
}

export function useAutomationTest(pid?: string, id?: string | null) {
  return useQuery({
    queryKey: autoKeys.test(pid ?? '', id ?? ''),
    queryFn: () => api.get<AutomationTestFull>(`${p(pid!)}/automation-tests/${id}`),
    enabled: !!pid && !!id,
  });
}

export function useTestVersion(pid: string, id: string, version: number | null) {
  return useQuery({
    queryKey: autoKeys.version(pid, id, version ?? 0),
    queryFn: () =>
      api.get<{ version: number; code: string; reason: string; createdAt: string }>(
        `${p(pid)}/automation-tests/${id}/versions/${version}`,
      ),
    enabled: !!version,
  });
}

export function useSaveTest(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: Partial<AutomationTestInput> & { id?: string; version?: number }) =>
      id
        ? api.patch<AutomationTestFull>(`${p(pid)}/automation-tests/${id}`, input)
        : api.post<AutomationTestFull>(`${p(pid)}/automation-tests`, input),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: autoKeys.tests(pid) });
      void qc.invalidateQueries({ queryKey: autoKeys.test(pid, t.id) });
    },
  });
}

export function useDeleteTest(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/automation-tests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tests(pid) }),
    onError,
  });
}

export function useResolveFix(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: 'approve' | 'dismiss') =>
      api.post(`${p(pid)}/automation-tests/${id}/fix/${decision}`),
    onSuccess: (_d, decision) => {
      toast.success(
        decision === 'approve' ? 'Fix applied as a new version' : 'Suggestion dismissed',
      );
      void qc.invalidateQueries({ queryKey: autoKeys.tests(pid) });
      void qc.invalidateQueries({ queryKey: autoKeys.test(pid, id) });
    },
    onError,
  });
}

// ---- runs ----------------------------------------------------------------------------------

const live = (s?: RunStatus) => s === 'QUEUED' || s === 'RUNNING';

export function useAutomationRuns(pid?: string) {
  return useQuery({
    queryKey: autoKeys.runs(pid ?? ''),
    queryFn: () => api.get<AutomationRunRow[]>(`${p(pid!)}/automation-runs`),
    enabled: !!pid,
    placeholderData: keepPreviousData,
    // Poll while anything is in flight; runs report progress through the database.
    refetchInterval: (q) => (q.state.data?.some((r) => live(r.status)) ? 3000 : false),
  });
}

export function useAutomationRun(pid?: string, ref?: string) {
  return useQuery({
    queryKey: autoKeys.run(pid ?? '', ref ?? ''),
    queryFn: () => api.get<AutomationRunFull>(`${p(pid!)}/automation-runs/${ref}`),
    enabled: !!pid && !!ref,
    refetchInterval: (q) => (live(q.state.data?.status) ? 2500 : false),
  });
}

export function useAutomationResult(pid?: string, id?: string | null) {
  return useQuery({
    queryKey: autoKeys.result(pid ?? '', id ?? ''),
    queryFn: () => api.get<AutomationResultFull>(`${p(pid!)}/automation-results/${id}`),
    enabled: !!pid && !!id,
  });
}

export function useStartRun(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartAutomationRunInput) =>
      api.post<AutomationRunRow>(`${p(pid)}/automation-runs`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.runs(pid) }),
    onError,
  });
}

export function useCancelRun(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`${p(pid)}/automation-runs/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.all(pid) }),
    onError,
  });
}

export function fetchBugDraft(pid: string, resultId: string) {
  return api.get<{
    title: string;
    stepsToReproduce: string[];
    expectedResult: string;
    actualResult: string;
    severity: 'MAJOR';
    priority: 'MEDIUM';
    environmentId: string | null;
    testRunResultId: string | null;
  }>(`${p(pid)}/automation-results/${resultId}/bug-draft`);
}

// ---- schedules & CI -------------------------------------------------------------------------

export function useSchedules(pid?: string) {
  return useQuery({
    queryKey: autoKeys.schedules(pid ?? ''),
    queryFn: () => api.get<ScheduleRow[]>(`${p(pid!)}/automation-schedules`),
    enabled: !!pid,
  });
}

export function useSaveSchedule(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<AutomationScheduleInput> & { id?: string }) =>
      id
        ? api.patch<ScheduleRow>(`${p(pid)}/automation-schedules/${id}`, input)
        : api.post<ScheduleRow>(`${p(pid)}/automation-schedules`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.schedules(pid) }),
  });
}

export function useDeleteSchedule(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/automation-schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.schedules(pid) }),
    onError,
  });
}

export function useTokens(pid?: string, enabled = true) {
  return useQuery({
    queryKey: autoKeys.tokens(pid ?? ''),
    queryFn: () => api.get<TokenRow[]>(`${p(pid!)}/ci-tokens`),
    enabled: !!pid && enabled,
  });
}

export function useCreateToken(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; expiresInDays: number | null }) =>
      api.post<{ id: string; name: string; prefix: string; token: string }>(
        `${p(pid)}/ci-tokens`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tokens(pid) }),
    onError,
  });
}

export function useRevokeToken(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/ci-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: autoKeys.tokens(pid) }),
    onError,
  });
}

// ---- environment choice (per viewer, per project) ----------------------------------------------

const ENV_EVENT = 'qaforge:automation-env';
const subscribeEnv = (cb: () => void) => {
  window.addEventListener(ENV_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(ENV_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

/**
 * The environment the automation pages send requests and runs to. Remembered in this browser
 * only (a convenience; storage may be unavailable). Defaults to the first one with a base URL.
 */
export function useAutomationEnv(pid: string | undefined, envs: EnvironmentRow[] | undefined) {
  const key = `qaforge.automation.env.${pid}`;
  const stored = useSyncExternalStore(
    subscribeEnv,
    () => {
      try {
        return localStorage.getItem(key) ?? '';
      } catch {
        return '';
      }
    },
    () => '',
  );
  const set = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(key, id);
      } catch {
        /* storage unavailable: the choice lasts until reload */
      }
      window.dispatchEvent(new Event(ENV_EVENT));
    },
    [key],
  );
  const valid = envs?.some((e) => e.id === stored) ? stored : '';
  const id = valid || envs?.find((e) => e.baseUrl)?.id || envs?.[0]?.id || '';
  return [id, set] as const;
}
