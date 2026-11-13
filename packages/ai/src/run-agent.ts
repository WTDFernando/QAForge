import type { z } from 'zod';
import type { AgentDefinition } from './agents/types';
import { loadPrompt } from './prompts';
import type { ModelProvider, ProgressUpdate, StructuredResult } from './provider';

export interface RunContext {
  provider: ModelProvider;
  model: string;
  signal?: AbortSignal;
  onProgress?: (p: ProgressUpdate) => void;
}

export interface AgentRun<O> {
  output: O;
  /** Items removed by the agent's post-checks (e.g. cited a requirement that wasn't provided). */
  dropped: string[];
  call: Omit<StructuredResult<unknown>, 'data'>;
  promptVersion: string;
}

/** Validate input, call the model with the agent's versioned prompt, then enforce the agent's rules. */
export async function runAgent<I extends z.ZodType, O extends z.ZodType>(
  agent: AgentDefinition<I, O>,
  rawInput: z.input<I>,
  ctx: RunContext,
): Promise<AgentRun<z.infer<O>>> {
  const input = agent.input.parse(rawInput) as z.infer<I>;
  const result = await ctx.provider.generateStructured({
    model: ctx.model,
    system: loadPrompt(agent.id, agent.promptVersion),
    content: agent.buildContent(input),
    schema: agent.output,
    effort: agent.effort,
    signal: ctx.signal,
    onProgress: ctx.onProgress,
  });
  const { output, dropped } = agent.postprocess
    ? agent.postprocess(input, result.data)
    : { output: result.data, dropped: [] };
  return {
    output,
    dropped,
    call: { model: result.model, usage: result.usage },
    promptVersion: agent.promptVersion,
  };
}
