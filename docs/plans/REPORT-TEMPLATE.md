# Phase XX — Delivery Report (template)

> Fill every section. Missing sections = review does not start.

## 1) Scope delivered
- Phase: XX — <name>
- Tasks completed: list IDs (e.g., F-01…F-18) — mark any skipped with reason.
- Out-of-scope work done (if any) and why.

## 2) Artifacts
- Repo branch/commit:
- Key files added/changed (paths):
- Migrations (names + what they create):
- Routes implemented:
- Components added (shared UI first):

## 3) Data & security evidence
- Tables created + RLS enabled (yes/no per table):
- Policies summary (who can read/write):
- RPCs added (name → purpose → atomic? → idempotent?):
- Test results: RLS cross-tenant tests (paste output).

## 4) Functional evidence (G1)
- Acceptance checklist from PLAN.md — item by item (✅/❌ + note).
- Repro steps for each main flow.

## 5) Design evidence (G3)
- Screenshots at 390 / 768 / 1280 / 1440 (attach paths).
- Token usage proof (no raw hex outside tokens; scan output).
- Emoji/gradient scan result (must be 0).

## 6) UX evidence (G4)
- Clicks-to-complete for the main task:
- Loading / empty / error states shown:
- Confirmations for destructive actions:
- Unsaved-data protection:

## 7) Responsive evidence (G5)
- Horizontal scroll check at 390 (none expected):
- Tables → cards behavior:
- Nav/menus on mobile:

## 8) SEO/performance (G6, public phases)
- Meta coverage:
- JSON-LD validity (Rich Results):
- Lighthouse mobile score + LCP/CLS:
- noindex on panels/auth:

## 9) Deviations & decisions
- Any deviation from PLAN/JOURNEYS (what/why/impact):
- Open questions needing owner decision:

## 10) Risks & follow-ups
- Known issues (severity + plan):
- What is intentionally deferred:

## 11) Evidence location
- `plans/evidence/phase-XX/` contents list.
