# 0009 · List performance: offset pagination + virtualised table

**Context.** NFR: a list of 10,000 test cases loads in under 1 s.

**Decision.** Measure before optimising. With a 10k fixture, offset pagination on the `(projectId, seq)` index answers any page, sort or filter in 26–61 ms; the browser paints the list in about 300 ms. Pages of more than 100 rows are virtualised (`@tanstack/react-virtual`) while keeping real table rows and ARIA row counts. Both checks run in CI.

**Consequences.** No extra indexes or cursor API to maintain yet. Keyset pagination is the next step if a single project grows past about 100k cases.
