'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateBugInput,
  SetBugStatusInput,
  StartAgentJobInput,
  UpdateBugInput,
} from '@qaforge/shared';
import { api } from '@/lib/api';
import type { AgentJobEvent } from '@qaforge/shared';
import type { AttachmentRow, BugDetail, BugRow, CommentRow, NotificationRow } from '@/lib/types';

const p = (pid: string) => `/v1/projects/${pid}`;

export const bugKeys = {
  all: (pid: string) => ['project', pid, 'bugs'] as const,
  board: (pid: string, qs: string) => ['project', pid, 'bugs', 'board', qs] as const,
  list: (pid: string, qs: string) => ['project', pid, 'bugs', 'list', qs] as const,
  byRef: (pid: string, ref: string) => ['project', pid, 'bugs', 'ref', ref] as const,
  components: (pid: string) => ['project', pid, 'bugs', 'components'] as const,
  comments: (pid: string, entity: string, id: string) =>
    ['project', pid, 'comments', entity, id] as const,
};

export function useBugBoard(pid: string | undefined, qs: string) {
  return useQuery({
    queryKey: bugKeys.board(pid ?? '', qs),
    queryFn: () => api.get<BugRow[]>(`${p(pid!)}/bugs/board?${qs}`),
    enabled: !!pid,
    placeholderData: keepPreviousData,
  });
}

export function useBugList(pid: string | undefined, qs: string) {
  return useQuery({
    queryKey: bugKeys.list(pid ?? '', qs),
    queryFn: () =>
      api.get<{ items: BugRow[]; total: number }>(`${p(pid!)}/bugs?pageSize=200&${qs}`),
    enabled: !!pid,
    placeholderData: keepPreviousData,
  });
}

export function useBugComponents(pid: string | undefined) {
  return useQuery({
    queryKey: bugKeys.components(pid ?? ''),
    queryFn: () => api.get<{ component: string; count: number }[]>(`${p(pid!)}/bugs/components`),
    enabled: !!pid,
  });
}

export function useBugByRef(pid: string | undefined, ref: string | undefined) {
  const seq = Number(/(\d+)$/.exec(ref ?? '')?.[1]);
  return useQuery({
    queryKey: bugKeys.byRef(pid ?? '', ref ?? ''),
    queryFn: () => api.get<BugDetail>(`${p(pid!)}/bugs/by-ref/${seq}`),
    enabled: !!pid && Number.isFinite(seq),
  });
}

export function useCreateBug(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateBugInput> & { title: string }) =>
      api.post<BugRow>(`${p(pid)}/bugs`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', pid] }),
  });
}

export function useUpdateBug(pid: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBugInput) => api.patch<BugDetail>(`${p(pid)}/bugs/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: bugKeys.all(pid) }),
  });
}

/** Status change (workflow or Kanban drag). Optimistic on the board. */
export function useSetBugStatus(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: SetBugStatusInput & { id: string }) =>
      api.post<BugRow>(`${p(pid)}/bugs/${id}/status`, input),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: bugKeys.all(pid) });
      const boards = qc.getQueriesData<BugRow[]>({ queryKey: ['project', pid, 'bugs', 'board'] });
      for (const [key, rows] of boards)
        qc.setQueryData<BugRow[]>(
          key,
          rows?.map((b) => (b.id === id ? { ...b, status } : b)),
        );
      return { boards };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, rows] of ctx?.boards ?? []) qc.setQueryData(key, rows);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', pid] }),
  });
}

export function useBugUpload(pid: string) {
  return useMutation({
    mutationFn: (file: File) => api.upload<AttachmentRow>(`${p(pid)}/bugs/uploads`, file),
  });
}

export function useStartBugDraft(pid: string) {
  return useMutation({
    mutationFn: (input: Extract<StartAgentJobInput, { kind: 'draft-bug' }>) =>
      api.post<AgentJobEvent>(`${p(pid)}/agent-jobs`, input),
  });
}

export function useAgentJob<T>(pid: string | undefined, jobId: string | undefined, poll: boolean) {
  return useQuery({
    queryKey: ['project', pid, 'agent-job', jobId],
    queryFn: () => api.get<AgentJobEvent & { output: T | null }>(`${p(pid!)}/agent-jobs/${jobId}`),
    enabled: !!pid && !!jobId,
    refetchInterval: (q) =>
      poll && (!q.state.data || ['QUEUED', 'RUNNING'].includes(q.state.data.status)) ? 1000 : false,
  });
}

// ---- comments ---------------------------------------------------------------

export function useComments(pid: string | undefined, entity: string, id: string | undefined) {
  return useQuery({
    queryKey: bugKeys.comments(pid ?? '', entity, id ?? ''),
    queryFn: () => api.get<CommentRow[]>(`${p(pid!)}/comments/${entity}/${id}`),
    enabled: !!pid && !!id,
  });
}

export function useAddComment(pid: string, entity: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: unknown; mentions: string[] }) =>
      api.post<CommentRow>(`${p(pid)}/comments/${entity}/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bugKeys.comments(pid, entity, id) });
      void qc.invalidateQueries({ queryKey: bugKeys.all(pid) });
    },
  });
}

// ---- notifications ------------------------------------------------------------

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ items: NotificationRow[]; unread: number }>('/v1/notifications?limit=20'),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) =>
      api.post(id ? `/v1/notifications/${id}/read` : '/v1/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
