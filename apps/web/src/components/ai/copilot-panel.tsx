'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUp, Bot, Loader2, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useAiAvailability } from '@/components/ai/ai-button';
import { useUiState } from '@/components/shell/ui-state';
import { useCurrentProject } from '@/hooks/queries';
import { useRequirements } from '@/hooks/qa';
import { useHotkey } from '@/hooks/use-hotkey';
import { renderCopilotMarkdown } from '@/lib/copilot-format';
import { cn } from '@/lib/utils';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  error?: string;
}

const STARTERS = [
  'Which high-priority requirements have no tests?',
  'Summarize what is waiting in the review queue.',
  'Which requirements have open questions for the client?',
  'Draft test cases for the uncovered high-priority stories.',
];

/** Parse an SSE byte stream into JSON events. */
async function* readSse(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('');
      if (data)
        yield JSON.parse(data) as {
          type: string;
          delta?: string;
          label?: string;
          message?: string;
          summary?: string;
        };
    }
  }
}

export function CopilotPanel() {
  const { copilotOpen, setCopilotOpen } = useUiState();
  const { project, org } = useCurrentProject();
  const reqs = useRequirements(copilotOpen ? project?.id : undefined);
  const avail = useAiAvailability('copilot');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useHotkey(
    'mod+j',
    useCallback(
      () => project && setCopilotOpen(!copilotOpen),
      [project, copilotOpen, setCopilotOpen],
    ),
  );
  // New project, new conversation.
  useEffect(() => {
    setTurns([]);
  }, [project?.id]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  const base = org && project ? `/${org.slug}/p/${project.key}` : '';
  const resolve = (ref: string) => {
    if (ref.startsWith('TC-')) return `${base}/test-cases/${ref}`;
    const r = reqs.data?.find((x) => x.ref === ref);
    return r ? `${base}/requirements/${r.id}` : null;
  };

  const send = async (text: string) => {
    if (!project || !text.trim() || busy) return;
    const history = [
      ...turns.filter((t) => !t.error),
      { role: 'user' as const, content: text.trim() },
    ];
    setTurns([...history, { role: 'assistant', content: '', tools: [] }]);
    setInput('');
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const patch = (fn: (t: Turn) => Turn) =>
      setTurns((all) => [...all.slice(0, -1), fn(all.at(-1)!)]);
    try {
      const res = await fetch(`/v1/projects/${project.id}/copilot`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-20).map(({ role, content }) => ({ role, content })),
        }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? 'Copilot is unavailable');
      }
      for await (const e of readSse(res)) {
        if (e.type === 'text') patch((t) => ({ ...t, content: t.content + e.delta }));
        if (e.type === 'tool') patch((t) => ({ ...t, tools: [...(t.tools ?? []), e.label!] }));
        if (e.type === 'job') patch((t) => ({ ...t, tools: [...(t.tools ?? []), e.summary!] }));
        if (e.type === 'error') patch((t) => ({ ...t, error: e.message }));
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError')
        patch((t) => ({ ...t, error: (err as Error).message }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <DialogPrimitive.Root open={copilotOpen} onOpenChange={setCopilotOpen} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[26rem]"
          aria-describedby={undefined}
        >
          <div className="flex h-12 items-center gap-2 border-b px-4">
            <Sparkles className="size-4 text-violet-500" />
            <DialogPrimitive.Title className="flex-1 text-sm font-semibold">
              QA Copilot{' '}
              {project && (
                <span className="font-normal text-muted-foreground">· {project.name}</span>
              )}
            </DialogPrimitive.Title>
            {turns.length > 0 && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="New conversation"
                onClick={() => setTurns([])}
                disabled={busy}
              >
                <RotateCcw />
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Close copilot">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div ref={scroller} className="flex-1 overflow-y-auto p-4" aria-live="polite">
            {!avail.ok ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {avail.reason}
              </p>
            ) : turns.length === 0 ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Ask about this project’s requirements, test cases and coverage. Answers cite items
                  you can open.
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    className="rounded-lg border px-3 py-2 text-left text-sm hover:border-primary/50 hover:bg-accent"
                    onClick={() => void send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <ol className="grid gap-4">
                {turns.map((t, i) => (
                  <li
                    key={i}
                    className={cn('grid gap-1.5', t.role === 'user' && 'justify-items-end')}
                  >
                    {t.role === 'user' ? (
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {t.content}
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Bot className="mt-0.5 size-4 shrink-0 text-violet-500" aria-hidden />
                        <div className="min-w-0 flex-1 text-sm">
                          {!!t.tools?.length && (
                            <ul className="mb-1.5 flex flex-wrap gap-1">
                              {t.tools.map((tool, j) => (
                                <li
                                  key={j}
                                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                >
                                  {tool}
                                </li>
                              ))}
                            </ul>
                          )}
                          {t.content
                            ? renderCopilotMarkdown(t.content, resolve)
                            : busy &&
                              i === turns.length - 1 && (
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                              )}
                          {t.error && (
                            <p
                              role="alert"
                              className="mt-1 rounded-md bg-destructive/10 px-2 py-1 text-destructive"
                            >
                              {t.error}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <form
            className="border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder="Ask about this project…"
                aria-label="Message QA Copilot"
                disabled={!avail.ok}
                className="max-h-40 min-h-9 resize-none border-0 p-1 shadow-none focus-visible:ring-0"
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Stop"
                  onClick={() => abort.current?.abort()}
                >
                  <Square />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send"
                  disabled={!input.trim() || !avail.ok}
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Answers come from project data. Anything the Copilot drafts lands in the review queue.
            </p>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
