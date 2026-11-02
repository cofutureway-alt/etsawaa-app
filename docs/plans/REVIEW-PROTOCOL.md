# Review Protocol — Etsawaa

Implementation happens in Antigravity. Minis reviews each phase report and returns a verdict.

## Review inputs
1. The phase's `PLAN.md`, `TASKS.md`, `USER-STORIES.md`.
2. The filled `REPORT-TEMPLATE.md`.
3. Evidence files under `plans/evidence/phase-XX/`.
4. Repo diff or key file excerpts where needed.

## Review checks (in order)
| # | Check | Fails when |
|---|---|---|
| R1 | Scope & task coverage | Any task ID missing without an approved deferral |
| R2 | Acceptance criteria | Any PLAN acceptance item unproven |
| R3 | Data model consistency | Schema diverges from ARCHITECTURE.md without a logged decision |
| R4 | RLS & isolation | Any new table without RLS, or a cross-tenant leak possible |
| R5 | Atomicity & idempotency | Money/order RPC not atomic or not idempotent |
| R6 | Design rules | Emoji/gradient found · raw hex outside tokens · RTL broken |
| R7 | UX quality | >3 clicks for core task · missing loading/empty/error · destructive action without confirm |
| R8 | Responsive | Breakage or horizontal scroll at 390/768/1280/1440 |
| R9 | SEO/perf (public) | Missing meta/schema · panels indexable · LCP>2.5s |
| R10 | Journeys | A journey state/edge case from JOURNEYS.md is unimplemented or contradicted |

## Verdicts
- **PASS** — all gates green; phase can be closed.
- **PASS WITH FIXES** — no blockers; listed fixes required before the next phase starts.
- **FAIL** — blockers present (data loss, money errors, RLS leak, missing scope). Next phase cannot start.

## Output format (per review)
1. Verdict + one-line reason.
2. Blockers (numbered, each: what/where/why + exact fix).
3. Majors (should fix this phase).
4. Minors (can defer, listed).
5. What is proven (short evidence list).
6. Next phase readiness: ready / conditional / blocked.

## Rules
- No verdict without evidence. "It works" is not evidence.
- A blocker found in a previous phase reopens it; the fix is verified before closing.
- Owner decisions requested by the implementer must be answered explicitly (no silent assumptions).
