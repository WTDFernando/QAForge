# 0014 · Release readiness is rules-based; gates are frozen at sign-off

**Context.** A release needs a clear answer to "can we ship?", and approvers need to know what they approved. Live numbers keep moving after someone signs.

**Decision.**

- Quality gates are rules on measured metrics: pass rate and execution complete (latest result per test case in the release's runs), open bugs by severity (in scope or found in the release runs), requirement coverage, high-priority requirements passed, automation pass rate. A gate with no data fails, except open bugs, where zero is a real value.
- The readiness score is a fixed, documented formula: pass rate 35%, execution 25%, requirement coverage 20%, bugs 20% (100 minus 25 per open blocker/critical and 5 per open major). Any failing **blocking** gate makes the release _Blocked_, whatever the score. Bands: Ready ≥ 85, At risk ≥ 70, otherwise Not ready.
- Approval can only be requested when every blocking gate passes and at least one approver is named. Approvers must hold `release:approve` (QA Lead, Admin, Owner, Client). Requesting approval freezes the gates and metrics on the release; each decision also stores the numbers at that moment. A rejection needs a reason. Scope, gates and approvers are locked until the release is back in draft.
- The logic is pure functions in `@qaforge/shared`, used by the API, the worker (Go/No-Go report) and the web, so all three agree.

**Consequences.** The verdict is explainable and repeatable, and the AI never decides it. Teams that want different weights can make more gates blocking; the weights themselves are not configurable yet.
