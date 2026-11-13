'use client';
import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  AGENT_IDS,
  AGENT_INFO,
  AI_MODELS,
  humanize,
  type AgentId,
  type AiSettingsView,
} from '@qaforge/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAiSettings, useAiUsage, useSaveAiSettings } from '@/hooks/ai';
import { useCurrentOrg } from '@/hooks/queries';
import { useCan } from '@/hooks/use-permission';

const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);
const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);
const modelLabel = (id: string) => AI_MODELS.find((m) => m.id === id)?.label ?? id;

function SettingsForm({ orgId, current }: { orgId: string; current: AiSettingsView }) {
  const save = useSaveAiSettings(orgId);
  const [model, setModel] = useState(current.model);
  const [apiKey, setApiKey] = useState('');
  const [budget, setBudget] = useState(current.monthlyBudgetUsd?.toString() ?? '');
  const [disabled, setDisabled] = useState<AgentId[]>(current.disabledAgents);

  const submit = async (e: React.FormEvent, opts: { removeKey?: boolean } = {}) => {
    e.preventDefault();
    const b = budget.trim() === '' ? null : Number(budget);
    if (b !== null && (Number.isNaN(b) || b < 0))
      return toast.error('Budget must be a positive number or empty');
    try {
      await save.mutateAsync({
        model,
        monthlyBudgetUsd: b,
        disabledAgents: disabled,
        ...(opts.removeKey ? { apiKey: null } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
      toast.success(opts.removeKey ? 'API key removed' : 'AI settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="ai-model" label="Model" hint="Used by every agent in this organization">
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger id="ai-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} · {m.note}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          id="ai-budget"
          label="Monthly budget (USD)"
          hint="Agents stop when this month's spend reaches it. Empty = no limit."
        >
          <Input
            id="ai-budget"
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="No limit"
          />
        </FormField>
      </div>
      <FormField
        id="ai-key"
        label="Anthropic API key"
        hint={
          current.hasApiKey
            ? 'A key is saved (hidden). Enter a new one to replace it.'
            : current.usingServerKey
              ? 'Optional: the server’s key is used until you add one.'
              : 'Required before agents can run. Stored encrypted; never shown again.'
        }
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              className="pl-8"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={current.hasApiKey ? '•••••••••••• saved' : 'sk-ant-…'}
            />
          </div>
          {current.hasApiKey && (
            <Button type="button" variant="outline" onClick={(e) => submit(e, { removeKey: true })}>
              Remove
            </Button>
          )}
        </div>
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Agents</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AGENT_IDS.map((id) => (
            <label key={id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={!disabled.includes(id)}
                onCheckedChange={(c) =>
                  setDisabled(c === true ? disabled.filter((x) => x !== id) : [...disabled, id])
                }
              />
              <span>
                <span className="font-medium">{AGENT_INFO[id].name}</span>
                <span className="block text-xs text-muted-foreground">
                  {AGENT_INFO[id].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}

function Usage({ orgId }: { orgId: string }) {
  const usage = useAiUsage(orgId);
  if (usage.isLoading) return <Skeleton className="h-40" />;
  const u = usage.data!;
  const pct = u.monthlyBudgetUsd
    ? Math.min(100, Math.round((u.totalCostUsd / u.monthlyBudgetUsd) * 100))
    : null;
  const calls = u.byAgent.reduce((a, r) => a + r.calls, 0);
  const tok = u.byAgent.reduce((a, r) => a + r.inputTokens + r.outputTokens + r.cacheReadTokens, 0);
  const cached = u.byAgent.reduce((a, r) => a + r.cacheReadTokens, 0);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Spend this month</div>
          <div className="text-xl font-semibold">{usd(u.totalCostUsd)}</div>
          {pct !== null && (
            <>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Budget used"
              >
                <div
                  className={pct >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {pct}% of {usd(u.monthlyBudgetUsd!)}
              </div>
            </>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Model calls</div>
          <div className="text-xl font-semibold">{calls}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Tokens</div>
          <div className="text-xl font-semibold">{tokens(tok)}</div>
          <div className="text-xs text-muted-foreground">
            {tok ? Math.round((cached / tok) * 100) : 0}% from cache
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Jobs</div>
          <div className="text-xl font-semibold">
            {Object.values(u.jobs).reduce((a, b) => a + b, 0)}
          </div>
          <div className="text-xs text-muted-foreground">{u.jobs.FAILED ?? 0} failed</div>
        </div>
      </div>
      {u.byAgent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AI usage this month yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            {
              title: 'By agent',
              rows: u.byAgent.map((r) => ({
                name: AGENT_INFO[r.agent as AgentId]?.name ?? humanize(r.agent),
                ...r,
              })),
            },
            {
              title: 'By model',
              rows: u.byModel.map((r) => ({ name: modelLabel(r.model), ...r })),
            },
          ].map((t) => (
            <div key={t.title} className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t.title}</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in / out</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.rows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {tokens(r.inputTokens + r.cacheReadTokens)} / {tokens(r.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{usd(r.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Costs are estimated from token counts at list prices; your Anthropic invoice is
        authoritative.
      </p>
    </div>
  );
}

export default function AiSettingsPage() {
  const { org } = useCurrentOrg();
  const settings = useAiSettings(org?.id);
  const canConfigure = useCan('ai:configure');
  if (!org || settings.isLoading) return <Skeleton className="h-64 max-w-3xl" />;
  const s = settings.data!;
  const ready = s.ready;
  return (
    <div className="grid max-w-4xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-violet-500" /> AI provider
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            Anthropic Claude · {modelLabel(s.model)}
            {s.mode === 'demo' ? (
              <Badge variant="warning">Offline demo mode: no real model calls</Badge>
            ) : ready ? (
              <Badge variant="success">
                <ShieldCheck className="size-3" /> {s.hasApiKey ? 'Organization key' : 'Server key'}
              </Badge>
            ) : (
              <Badge variant="warning">Not set up</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canConfigure ? (
            <SettingsForm key={JSON.stringify(s)} orgId={org.id} current={s} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {ready
                ? 'AI agents are available. Only Owners and Admins can change these settings.'
                : 'Ask an Owner or Admin to add an Anthropic API key to turn on AI agents.'}
            </p>
          )}
        </CardContent>
      </Card>
      {canConfigure && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage this month</CardTitle>
            <CardDescription>
              Every model call is logged with its tokens and estimated cost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Usage orgId={org.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
