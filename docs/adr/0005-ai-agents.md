# 0005 · AI agents: provider-agnostic, drafts only, redacted

**Context.** AI is central to the product, but output can be wrong, documents can contain prompt injection, and environments contain secrets.

**Decision.**

- `packages/ai` defines agents as versioned prompt files + Zod input/output + post-checks. Providers are adapters (Claude by default, a fake provider for tests).
- Agents create **drafts** (requirements, test cases) or **suggestions** (reviews, bug drafts). A person approves or submits. AI changes are audited as `AI_AGENT` with the requesting user.
- Every prompt is redacted: known secrets (environment secrets, API keys) and common credential patterns are replaced before the call. Uploaded text is wrapped in tags and treated as data, not instructions.
- Per organization: master switch, disabled agents, model, key (encrypted), monthly budget; cost is recorded per call.

**Consequences.** The product works fully with AI off. Changing models or providers doesn't touch agents. Evals (`pnpm --filter @qaforge/ai eval`) guard prompt changes, including injection and secret cases.
