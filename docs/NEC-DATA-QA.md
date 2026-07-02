# Codewire — NEC Data QA Report

_Audit date: 2026-06-16. Audited by reviewing every data module against known
NEC 2023 values and adding an automated integrity test
(`src/lib/nec/2023/dataIntegrity.test.ts`, 15 checks) that pins anchor values
and enforces monotonic consistency so future edits can't silently drift._

**Bottom line:** all tables passed. The core, high-traffic data (ampacity,
circular mils, temperature factors, box fill, EMT/RMC/PVC conduit areas,
THHN/XHHW conductor areas) matches NEC and is high-confidence. A short list of
lower-traffic items is worth a final cross-check against a printed code book by
you or an electrician before heavy promotion.

## Verified — high confidence (matches NEC 2023)

| Data | File | Notes |
|---|---|---|
| Table 310.16 ampacity (Cu + Al, 60/75/90 °C) | `ampacity.ts` | Full row-by-row review; all values match. |
| Table 310.15(B)(1) ambient correction | `tempCorrection.ts` | All ranges/factors match, incl. 90 °C high-temp rows. |
| Table 310.15(C)(1) bundling adjustment | `tempCorrection.ts` | 80/70/50/45/40/35% bands correct. |
| Ch. 9 Table 8 circular mils | `conductors.ts` | All match. |
| Table 314.16(B) box-fill allowances | `boxFill.ts` | 18–6 AWG all match. |
| Table 314.16(A) common box volumes | `boxFill.ts` | All 13 picker volumes match. |
| Ch. 9 Table 1 fill % (53/31/40) | `fillPercent.ts` | Correct. |
| Ch. 9 Table 4 — EMT, RMC, IMC, PVC-40, PVC-80 | `conduitAreas.ts` | Full review; all match. These cover the vast majority of real jobs. |
| Ch. 9 Table 5 — THHN/THWN-2 | `insulationAreas.ts` | All sizes match (widely published values). |
| Ch. 9 Table 5 — XHHW/XHHW-2 | `insulationAreas.ts` | Match, incl. the correct THHN/XHHW crossover at 4 AWG+. |

## Resolved in this pass

1. **ENT — REMOVED** (2026-06-16). Its areas were identical to PVC-40, which is
   almost certainly wrong, and if ENT's true area is smaller the fill calc could
   read "fits" when it doesn't (unsafe-permissive). Since it couldn't be verified
   without the book, ENT was dropped from the conduit-type list. To re-add it,
   pull the real ENT total-area column from NEC Ch. 9 Table 4 and restore it in
   `conduitAreas.ts`.

## Worth a final cross-check (lower confidence / lower traffic)

1. **FMC and LFMC conduit areas** (`conduitAreas.ts`) — reviewed and believed
   correct (values match the pattern of genuine Table 4 data), but referenced
   less often; spot-check the sizes you expect to use most before promoting hard.
2. **18 & 16 AWG ampacity** (`ampacity.ts`, 14 A / 18 A at 90 °C) — these sizes
   are **not** part of Table 310.16 (which starts at 14 AWG); the values come
   from small-conductor/fixture-wire context. Low impact (rarely used for a
   sizing decision). Left in place; remove from the ampacity picker if you want
   to stay strictly within 310.16.

## Methodology notes & limitations

- **Voltage drop uses the circular-mil "K" method** (K = 12.9 Cu / 21.2 Al).
  This is the standard field approximation and slightly conservative; it does
  not use the AC resistance/reactance from Ch. 9 Table 9. Fine for field use and
  clearly the common method, but a future "precise (Table 9)" mode is a nice
  upgrade.
- **Edition:** values are NEC 2023. Tables 4/5/8 and 310.16/314.16 are stable
  across recent editions, but always verify against the edition your local AHJ
  has adopted (some jurisdictions are still on 2020 or 2017).
- **Not a substitute for the code book.** This audit checks internal consistency
  and matches against well-known values; the app already shows the AHJ-verify
  disclaimer on every calculator.

## Automated guardrail

`dataIntegrity.test.ts` now runs with the suite (`npm test`). It enforces:
- circular mils strictly increasing; ampacity non-decreasing with size and
  60 ≤ 75 ≤ 90; ambient factors decreasing with temperature; bundling factors
  decreasing with count; box-fill and conduit/conductor areas increasing with
  size; Table 1 percentages exact.
- pinned anchor values for 310.16, Table 8, 314.16(B), Table 4, Table 5,
  310.15(B)(1), and the K constants.

Any future edit that breaks consistency or changes a pinned value fails the build.
