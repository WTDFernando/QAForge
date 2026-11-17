# @qaforge/web

Next.js 16 (App Router) front end. It never touches the database: `/v1/*` and `/api/auth/*` are rewritten to the API, so cookies stay first-party.

Read `AGENTS.md` and the docs bundled in `node_modules/next/dist/docs` before changing Next code. This Next version differs from older ones.

## Run

```bash
pnpm --filter @qaforge/web dev      # http://localhost:3000 (API must run on :4000)
pnpm --filter @qaforge/web build && pnpm --filter @qaforge/web start
```

## Layout

| Path                                                    | What                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/app/(auth)`                                        | Sign in / sign up                                                            |
| `src/app/(app)/[org]/p/[key]/…`                         | Project pages: dashboard, requirements, test-cases, runs, bugs, settings     |
| `src/components/ui`                                     | shadcn/Radix primitives, plus `states.tsx` (empty, error, permission-denied) |
| `src/components/qa/run-status.tsx`                      | Result, severity and run status visuals (Figma "Result status", "Severity")  |
| `src/components/{runs,bugs,test-cases,requirements,ai}` | Feature components                                                           |
| `src/hooks`                                             | TanStack Query hooks per area (`qa`, `runs`, `bugs`, `ai`, `queries`)        |
| `src/lib/api.ts`                                        | Typed fetch client; 401 sends the user to sign in                            |

Design tokens live in `src/app/globals.css` and mirror the Figma variables (see `docs/DECISIONS.md`).

## Conventions

- Every screen handles loading, empty, error and permission-denied states, and is keyboard accessible.
- Status is never shown by colour alone (icon or glyph + label).
- Use `useCan(permission)` to hide actions the role can't perform. The API enforces the same rules.
- Mutations that users repeat quickly (run results, Kanban moves) update the cache optimistically.

## Tests

```bash
pnpm --filter @qaforge/web test                     # Vitest unit tests
pnpm --filter @qaforge/web e2e                      # Playwright against a running, seeded stack
```

E2E needs `pnpm db:seed && pnpm db:perf-fixture`, the API started with `RATE_LIMIT_AUTH_PER_MIN=1000` and `QAFORGE_AI_PROVIDER=fake`, and the worker running. `e2e/a11y.spec.ts` runs axe (WCAG 2.2 AA) on every main page in light and dark mode. `e2e/perf.spec.ts` checks that the 10,000-case list is painted in under 1 s.
