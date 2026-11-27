# 0015 · Report numbers come only from the database; the AI writes text only

**Context.** Reports go to managers and clients. A wrong number in a Go/No-Go report is worse than no report, and language models can invent or round numbers.

**Decision.**

- The worker builds each report from database queries into one format-neutral document (`ReportDoc`: key numbers, tables, bar charts, optional verdict) and freezes it on the report. PDF (headless Chromium, network blocked), Word, Excel and CSV exports and the web page all render that same document, so every format shows the same numbers.
- The Report Agent receives the document as data and returns a summary, highlights, risks and a recommendation. Every number and item ref it writes must appear in the document; sentences that don't are removed (and listed in the job), never corrected. It may explain the rules-based verdict but never overrule a No-go. When nothing grounded is left, the verdict reason is used instead.
- The narrative is optional (AI on, configured, agent enabled, budget left) and is added after the numbers; exports are re-rendered with it.
- CSV cells that start with `= + - @` are prefixed so spreadsheets don't execute them. Large tables are cut in the PDF (500 rows) with the full data in the Excel export.

**Consequences.** Reports are reproducible and auditable, and work with AI off. The summary can be blander than a free-form one, which is the point.
