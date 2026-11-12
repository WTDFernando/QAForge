'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkTestCaseInput,
  CreateRequirementInput,
  CreateSuiteInput,
  CreateTestCaseInput,
  EnvironmentInput,
  MoveInput,
  SavedViewInput,
  SharedStepInput,
  TestCaseStatus,
  UpdateRequirementInput,
  UpdateTestCaseInput,
} from '@qaforge/shared';
import { api } from '@/lib/api';
import type {
  Dashboard,
  EnvironmentRow,
  RequirementDetail,
  RequirementRow,
  RequirementSourceRow,
  SavedViewRow,
  SharedStepRow,
  SuiteRow,
  TestCaseDetail,
  TestCaseRow,
  VersionRow,
} from '@/lib/types';

const p = (projectId: string) => `/v1/projects/${projectId}`;

export const qaKeys = {
  all: (pid: string) => ['project', pid] as const,
  dashboard: (pid: string) => ['project', pid, 'dashboard'] as const,
  envs: (pid: string) => ['project', pid, 'environments'] as const,
  reqs: (pid: string) => ['project', pid, 'requirements'] as const,
  req: (pid: string, id: string) => ['project', pid, 'requirements', id] as const,
  sources: (pid: string) => ['project', pid, 'sources'] as const,
  suites: (pid: string) => ['project', pid, 'suites'] as const,
  tcs: (pid: string) => ['project', pid, 'test-cases'] as const,
  tcList: (pid: string, qs: string) => ['project', pid, 'test-cases', 'list', qs] as const,
  tc: (pid: string, id: string) => ['project', pid, 'test-cases', 'item', id] as const,
  versions: (pid: string, kind: string, id: string) =>
    ['project', pid, kind, id, 'versions'] as const,
  shared: (pid: string) => ['project', pid, 'shared-steps'] as const,
  tags: (pid: string) => ['project', pid, 'tags'] as const,
  views: (pid: string, entity: string) => ['project', pid, 'views', entity] as const,
};

// ---- dashboard & environments ----------------------------------------------

export function useDashboard(pid?: string) {
  return useQuery({
    queryKey: qaKeys.dashboard(pid ?? ''),
    queryFn: () => api.get<Dashboard>(`${p(pid!)}/dashboard`),
    enabled: !!pid,
  });
}

export function useEnvironments(pid?: string) {
  return useQuery({
    queryKey: qaKeys.envs(pid ?? ''),
    queryFn: () => api.get<EnvironmentRow[]>(`${p(pid!)}/environments`),
    enabled: !!pid,
  });
}

export function useSaveEnvironment(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<EnvironmentInput> & { id?: string }) =>
      id
        ? api.patch<EnvironmentRow>(`${p(pid)}/environments/${id}`, input)
        : api.post<EnvironmentRow>(`${p(pid)}/environments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaKeys.envs(pid) }),
  });
}

export function useDeleteEnvironment(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/environments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaKeys.envs(pid) }),
  });
}

// ---- requirements ----------------------------------------------------------

export function useRequirements(pid?: string) {
  return useQuery({
    queryKey: qaKeys.reqs(pid ?? ''),
    queryFn: () => api.get<RequirementRow[]>(`${p(pid!)}/requirements`),
    enabled: !!pid,
  });
}

export function useRequirement(pid?: string, id?: string) {
  return useQuery({
    queryKey: qaKeys.req(pid ?? '', id ?? ''),
    queryFn: () => api.get<RequirementDetail>(`${p(pid!)}/requirements/${id}`),
    enabled: !!pid && !!id,
  });
}

function useInvalidateProject(pid: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qaKeys.all(pid) });
}

export function useCreateRequirement(pid: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (input: Partial<CreateRequirementInput> & { title: string }) =>
      api.post<RequirementRow>(`${p(pid)}/requirements`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateRequirement(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRequirementInput) =>
      api.patch<RequirementDetail>(`${p(pid)}/requirements/${id}`, input),
    // Optimistic: reflect edits immediately in the detail view.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qaKeys.req(pid, id) });
      const prev = qc.getQueryData<RequirementDetail>(qaKeys.req(pid, id));
      if (prev) qc.setQueryData(qaKeys.req(pid, id), { ...prev, ...input });
      return { prev };
    },
    onError: (_e, _i, ctx) => ctx?.prev && qc.setQueryData(qaKeys.req(pid, id), ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qaKeys.reqs(pid) });
      void qc.invalidateQueries({ queryKey: qaKeys.req(pid, id) });
      void qc.invalidateQueries({ queryKey: qaKeys.dashboard(pid) });
    },
  });
}

export function useMoveRequirement(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: MoveInput & { id: string }) =>
      api.post(`${p(pid)}/requirements/${id}/move`, input),
    onSettled: () => qc.invalidateQueries({ queryKey: qaKeys.reqs(pid) }),
  });
}

export function useDeleteRequirement(pid: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ids: string[] }>(`${p(pid)}/requirements/${id}`),
    onSuccess: invalidate,
  });
}

export function useRestoreRequirements(pid: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (ids: string[]) => api.post(`${p(pid)}/requirements/restore`, { ids }),
    onSuccess: invalidate,
  });
}

export function useLinkTestCases(pid: string, requirementId: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (ids: string[]) =>
      api.post(`${p(pid)}/requirements/${requirementId}/test-cases`, { ids }),
    onSuccess: invalidate,
  });
}

export function useUnlinkTestCase(pid: string, requirementId: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (testCaseId: string) =>
      api.delete(`${p(pid)}/requirements/${requirementId}/test-cases/${testCaseId}`),
    onSuccess: invalidate,
  });
}

export function useSources(pid?: string) {
  return useQuery({
    queryKey: qaKeys.sources(pid ?? ''),
    queryFn: () => api.get<RequirementSourceRow[]>(`${p(pid!)}/requirement-sources`),
    enabled: !!pid,
  });
}

export function useUploadSource(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api.upload<RequirementSourceRow>(`${p(pid)}/requirement-sources/upload`, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaKeys.sources(pid) }),
  });
}

export function useAddLinkSource(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; url: string }) =>
      api.post(`${p(pid)}/requirement-sources/link`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaKeys.sources(pid) }),
  });
}

export function useDeleteSource(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${p(pid)}/requirement-sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaKeys.sources(pid) }),
  });
}

export function useVersions(
  pid: string | undefined,
  kind: 'requirements' | 'test-cases',
  id: string | undefined,
) {
  return useQuery({
    queryKey: qaKeys.versions(pid ?? '', kind, id ?? ''),
    queryFn: () => api.get<VersionRow[]>(`${p(pid!)}/${kind}/${id}/versions`),
    enabled: !!pid && !!id,
  });
}

// ---- suites ----------------------------------------------------------------

export function useSuites(pid?: string) {
  return useQuery({
    queryKey: qaKeys.suites(pid ?? ''),
    queryFn: () => api.get<{ suites: SuiteRow[]; unsortedCount: number }>(`${p(pid!)}/suites`),
    enabled: !!pid,
  });
}

export function useSuiteMutations(pid: string) {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: qaKeys.suites(pid) });
    void qc.invalidateQueries({ queryKey: qaKeys.tcs(pid) });
  };
  return {
    create: useMutation({
      mutationFn: (input: CreateSuiteInput) => api.post<SuiteRow>(`${p(pid)}/suites`, input),
      onSuccess: done,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api.patch(`${p(pid)}/suites/${id}`, { name }),
      onSuccess: done,
    }),
    move: useMutation({
      mutationFn: ({ id, ...input }: MoveInput & { id: string }) =>
        api.post(`${p(pid)}/suites/${id}/move`, input),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`${p(pid)}/suites/${id}`),
      onSuccess: done,
    }),
  };
}

// ---- test cases ------------------------------------------------------------

export interface TestCasePage {
  items: TestCaseRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function useTestCases(pid: string | undefined, qs: string) {
  return useQuery({
    queryKey: qaKeys.tcList(pid ?? '', qs),
    queryFn: () => api.get<TestCasePage>(`${p(pid!)}/test-cases?${qs}`),
    enabled: !!pid,
    placeholderData: keepPreviousData,
  });
}

export function useTestCase(pid?: string, id?: string) {
  return useQuery({
    queryKey: qaKeys.tc(pid ?? '', id ?? ''),
    queryFn: () => api.get<TestCaseDetail>(`${p(pid!)}/test-cases/${id}`),
    enabled: !!pid && !!id,
  });
}

export function useTestCaseByRef(pid: string | undefined, ref: string | undefined) {
  return useQuery({
    queryKey: [...qaKeys.tcs(pid ?? ''), 'ref', ref],
    queryFn: async () =>
      (
        await api.get<TestCasePage>(
          `${p(pid!)}/test-cases?q=${encodeURIComponent(ref!)}&pageSize=1`,
        )
      ).items.find((t) => t.ref === ref) ?? null,
    enabled: !!pid && !!ref,
  });
}

export function useCreateTestCase(pid: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (input: Partial<CreateTestCaseInput> & { title: string }) =>
      api.post<TestCaseRow>(`${p(pid)}/test-cases`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateTestCase(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTestCaseInput) =>
      api.patch<TestCaseRow>(`${p(pid)}/test-cases/${id}`, input),
    onSettled: () => qc.invalidateQueries({ queryKey: qaKeys.all(pid) }),
  });
}

export function useSetTestCaseStatus(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: TestCaseStatus; note?: string }) =>
      api.post<TestCaseRow>(`${p(pid)}/test-cases/${id}/status`, { status, note }),
    // Optimistic status change in every cached list page.
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: qaKeys.tcs(pid) });
      const snapshot = qc.getQueriesData<TestCasePage>({ queryKey: [...qaKeys.tcs(pid), 'list'] });
      for (const [key, data] of snapshot) {
        if (data)
          qc.setQueryData(key, {
            ...data,
            items: data.items.map((t) => (t.id === id ? { ...t, status } : t)),
          });
      }
      return { snapshot };
    },
    onError: (_e, _v, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => qc.invalidateQueries({ queryKey: qaKeys.all(pid) }),
  });
}

export interface BulkResult {
  updated: number;
  previous: {
    id: string;
    status: TestCaseStatus;
    priority: string;
    suiteId: string | null;
    tags: string[];
  }[];
}

export function useBulkTestCases(pid: string) {
  const invalidate = useInvalidateProject(pid);
  return useMutation({
    mutationFn: (input: BulkTestCaseInput) =>
      api.post<BulkResult>(`${p(pid)}/test-cases/bulk`, input),
    onSuccess: invalidate,
  });
}

export function useTags(pid?: string) {
  return useQuery({
    queryKey: qaKeys.tags(pid ?? ''),
    queryFn: () => api.get<{ tag: string; count: number }[]>(`${p(pid!)}/test-cases/tags`),
    enabled: !!pid,
  });
}

export function useSharedSteps(pid?: string) {
  return useQuery({
    queryKey: qaKeys.shared(pid ?? ''),
    queryFn: () => api.get<SharedStepRow[]>(`${p(pid!)}/shared-steps`),
    enabled: !!pid,
  });
}

export function useCreateSharedStep(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SharedStepInput) =>
      api.post<SharedStepRow>(`${p(pid)}/shared-steps`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qaKeys.shared(pid) }),
  });
}

// ---- saved views -----------------------------------------------------------

export function useSavedViews(pid: string | undefined, entity: SavedViewInput['entity']) {
  return useQuery({
    queryKey: qaKeys.views(pid ?? '', entity),
    queryFn: () => api.get<SavedViewRow[]>(`${p(pid!)}/views?entity=${entity}`),
    enabled: !!pid,
  });
}

export function useSavedViewMutations(pid: string, entity: SavedViewInput['entity']) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: qaKeys.views(pid, entity) });
  return {
    create: useMutation({
      mutationFn: (input: Omit<SavedViewInput, 'entity'>) =>
        api.post<SavedViewRow>(`${p(pid)}/views`, { ...input, entity }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`${p(pid)}/views/${id}`),
      onSuccess: done,
    }),
  };
}
