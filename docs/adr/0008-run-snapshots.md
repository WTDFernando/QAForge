# 0008 · Run results store a snapshot of the case

**Context.** Test cases keep changing after a run starts; reports must show what was actually executed.

**Decision.** When a run is created, each result stores a snapshot (title, preconditions, steps with shared steps expanded, test data, priority, type) and the case version. Parameterised cases get one result per data row.

**Consequences.** Runs are reproducible and reports are honest. Fixing a typo in a case doesn't change past runs; adding cases to a running run snapshots them at that moment.
