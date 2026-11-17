# 0007 · Background jobs and live updates

**Context.** AI calls, scans, test execution and report generation are slow and must not block requests.

**Decision.** BullMQ on Redis with retries and exponential backoff. Job state lives in Postgres (`AgentJob`); progress is published on Redis pub/sub and streamed to the browser with Server-Sent Events.

**Consequences.** API instances stay stateless. SSE is one-way, which is all the UI needs; if collaborative editing arrives, WebSockets can be added for that feature alone.
