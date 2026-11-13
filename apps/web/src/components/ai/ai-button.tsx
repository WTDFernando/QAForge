'use client';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { AgentJobEvent, StartAgentJobInput } from '@qaforge/shared';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useAiSettings, useCancelAgentJob, useStartAgentJob } from '@/hooks/ai';
import { useCurrentOrg } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';

/** Is AI usable here, and if not, why (for tooltips/empty states)? */
export function useAiAvailability(
  agent: 'requirement' | 'test-case-writer' | 'test-case-reviewer' | 'copilot',
) {
  const { org } = useCurrentOrg();
  const settings = useAiSettings(org?.id);
  const canUse = useCan('ai:use');
  const s = settings.data;
  if (!canUse) return { ok: false, reason: 'Your role cannot run AI agents' };
  if (!s) return { ok: false, reason: 'Loading…' };
  if (s.disabledAgents.includes(agent))
    return { ok: false, reason: 'This agent is turned off in Settings > AI' };
  if (!s.ready)
    return {
      ok: false,
      reason: 'AI is not set up yet. An Admin can add an Anthropic API key in Settings > AI.',
    };
  return { ok: true, reason: null };
}

/**
 * Starts an agent job and shows its live state: progress + cancel while running.
 * The job's result arrives via the SSE feed (toast + refreshed data).
 */
export function AiJobButton({
  projectId,
  input,
  job,
  label,
  agent,
  size = 'sm',
  variant = 'outline',
}: {
  projectId: string;
  input: StartAgentJobInput;
  job?: AgentJobEvent;
  label: string;
  agent: 'requirement' | 'test-case-writer' | 'test-case-reviewer';
  size?: 'sm' | 'default';
  variant?: 'outline' | 'default';
}) {
  const start = useStartAgentJob(projectId);
  const cancel = useCancelAgentJob(projectId);
  const avail = useAiAvailability(agent);
  const running = job && (job.status === 'QUEUED' || job.status === 'RUNNING');

  if (running) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size={size} variant={variant} disabled aria-live="polite">
          <Loader2 className="animate-spin" /> {job.progressMessage ?? 'Working'}{' '}
          {job.progress > 5 && `${job.progress}%`}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel"
          onClick={() => cancel.mutate(job.id)}
        >
          <X />
        </Button>
      </span>
    );
  }
  const button = (
    <Button
      size={size}
      variant={variant}
      disabled={!avail.ok || start.isPending}
      onClick={() => start.mutate(input)}
    >
      {start.isPending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Sparkles className={variant === 'outline' ? 'text-violet-500' : undefined} />
      )}{' '}
      {label}
    </Button>
  );
  return avail.ok ? (
    button
  ) : (
    <Tooltip content={avail.reason}>
      <span>{button}</span>
    </Tooltip>
  );
}
