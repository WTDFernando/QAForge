# @qaforge/ai

Provider-agnostic agent framework. Claude (Claude Opus 5.5 by default) is the production provider; `FakeProvider` gives deterministic output for tests and demos.

- `runAgent(agent, input, ctx)`: validates input with Zod, loads the versioned prompt (`prompts/<agent>.<version>.md`), **redacts secrets** (`redactText`: known environment secrets and API keys, plus common credential patterns), calls the provider with structured output, then runs the agent's `postprocess` checks ("never invent data").
- Agents: `requirement`, `test-case-writer`, `test-case-reviewer`, `bug`. The Copilot runs in the API with read-only tools.
- `pricing.ts`: cost per call (stored in `AiUsage`).

## Evals

```bash
pnpm --filter @qaforge/ai build
pnpm --filter @qaforge/ai eval -- --fake            # harness self-check, no API calls
pnpm --filter @qaforge/ai eval -- --only bug         # real model, needs ANTHROPIC_API_KEY
```

Cases live in `src/evals/cases.ts`: splitting, vagueness, prompt injection, coverage, invented detail, and passwords that must never reach the model.
