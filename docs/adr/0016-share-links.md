# 0016 · Read-only report links: hashed tokens that expire

**Context.** Clients and stakeholders without a QAForge account need to see a report.

**Decision.**

- QA Leads and Admins (`report:share`) create a link for one ready report. The token (`qaf_share_…`, 192 random bits) is shown once; only its SHA-256 is stored. Links expire (1–90 days, 14 by default), a new link replaces the old one, and links can be turned off. Creating and revoking are audited.
- `/share/<token>` shows only the frozen report and its exports: no ids, no navigation into the project. Downloads go through the usual short-lived signed file URLs. Unknown, expired and revoked links all get the same answer, so tokens can't be probed.
- The public endpoints are rate-limited like the rest of the API.

**Consequences.** Anyone who has the link can read that one report until it expires; treat it like a password. Per-recipient links and view logs can come later.
