# Codewire — Vetted NEC Tip Bank (source material for daily posts)

Feed this to Cowork as source material for the daily Twitter/X drafts. Every
fact below is checked against the audited app data (see `docs/NEC-DATA-QA.md`),
so drafts start from **correct** numbers. **Still review each draft before
posting** — and remember values are NEC 2023; tell people to verify against the
edition their AHJ adopts.

Each line is roughly tweet-length. Mix mostly value (tips) with the occasional
soft CTA from the bottom of this file. Aim ~80% tips / 20% promo.

---

## Voltage drop
- NEC recommends keeping voltage drop ≤3% on a branch circuit and ≤5% total (feeder + branch). Notes to 210.19 & 215.2.
- Voltage drop is a *recommendation*, not a hard NEC rule — but your equipment and your inspector both still care.
- Aluminum has ~1.6× the resistance of copper. Same size = more voltage drop, or upsize the wire.
- Voltage-drop math: double the run length → double the drop. Double the wire's circular mils → halve the drop.
- Three-phase voltage drop uses √3 (1.732), not 2 — so it's lower than single-phase for the same load and wire.
- Long run feeling sluggish? Voltage drop on undersized wire is usually why. Upsize one gauge and recheck.
- Quick K-method: 1Ø drop = (2 × K × I × L) ÷ CM, where K ≈ 12.9 Cu / 21.2 Al.

## Conduit fill
- Conduit fill limits (Ch.9, Table 1): 1 wire = 53%, 2 wires = 31%, 3 or more = 40%.
- That 40% fill cap isn't arbitrary — it leaves room to dissipate heat and to actually pull the wire.
- Conduit fill compares total conductor area (Table 5) to the conduit's interior area (Table 4) × the Table 1 %.
- Insulation matters: THHN is slimmer than XHHW at small sizes, so it fits more per conduit. Use the right one.
- 1/2" EMT has ~0.304 in² inside; at the 40% rule that's ~0.122 in² of usable space.
- Going from 2 conductors to 3 drops your allowable fill from 31% to 40%? Higher % — but you're also adding a wire's area.

## Box fill (NEC 314.16)
- Box-fill volume per conductor: 14 AWG = 2.0 in³, 12 = 2.25, 10 = 2.5, 8 = 3.0, 6 = 5.0.
- A device yoke (receptacle/switch) counts as TWO conductors of the largest size connected to it. Easy to forget.
- All equipment grounds together = ONE conductor allowance of the largest ground. Not one each.
- All internal cable clamps together = ONE conductor allowance of the largest conductor.
- Overstuffed box is a real code violation (314.16) — and a pain to make up. Count before you cut in.

## Wire ampacity & derating (310.16 / 310.15)
- 12 AWG copper: 20 A @60°C, 25 A @75°C, 30 A @90°C (Table 310.16) — before any derating.
- 110.14(C): your ampacity is capped by the *termination* temp rating (often 60°C ≤100 A, else 75°C), even with 90°C wire.
- More than 3 current-carrying conductors in a raceway? Derate: 4–6 = 80%, 7–9 = 70%, 10–20 = 50%.
- Ambient hotter than 30°C (86°F) lowers ampacity. Example: 40°C on 75°C wire = ×0.88.
- The 90°C column is a *starting point for derating* — rarely your final usable ampacity.
- Aluminum carries less per size: 4/0 AL ≈ 2/0 CU in ampacity (75°C: 180 A vs 175 A).

## Wire size by amperage
- What size wire for 50 A? 8 AWG copper or 6 AWG aluminum (75°C), before derating.
- 100 A feeder? 3 AWG Cu or 1 AWG Al per Table 310.16 (75°C). Dwelling services/feeders can go smaller per 310.12.
- 20 A circuit = 12 AWG copper minimum. 15 A = 14 AWG. 30 A = 10 AWG.
- Rule of thumb: aluminum usually needs to be 1–2 sizes larger than copper for the same amps.

## Conduit bending
- Offset multipliers worth memorizing: 10°=6, 22.5°=2.6, 30°=2, 45°=1.4, 60°=1.2.
- 30° is the field favorite — a multiplier of exactly 2 makes the offset math dead simple.
- Higher bend angle = more conduit "shrink." A 30° offset shrinks ~1/4" per inch of rise.
- Three-point saddle = a 45° center bend with two 22.5° outer bends.
- 90° stub: mark from the end = desired height − take-up (≈5" for 1/2" EMT, 6" for 3/4", 8" for 1").

## General / code literacy
- The NEC updates every 3 years — but your AHJ decides which edition is enforced. It's not always the newest.
- Always verify a calc against the printed code and the edition your AHJ adopted. A tool is a field aid, not the book.
- "Pass inspection on the first try" usually comes down to the boring stuff: fill, derating, and box volume.

---

## Optional soft CTAs (use sparingly — ~1 in 5 posts)
- Did this in your head? Codewire does it in 2 seconds, free → codewire.tools
- All five of these calculators live free in one app → codewire.tools
- Stop juggling apps + the code book. Five NEC calculators, one screen → codewire.tools
- Free voltage drop / conduit fill / box fill / ampacity / bending → codewire.tools

## Hashtags (rotate 1–3, don't stuff)
#electrician #electrical #NEC #trades #apprentice #conduit #wiring #sparky

## Posting tips
- ~80% value (tips), ~20% promo. Useful posts get followed and shared; ads get scrolled past.
- Best windows for trades: early morning (~6–7am) or lunch. 4am gets little engagement.
- When a tip cites a number, you can verify it fast at codewire.tools or in docs/NEC-DATA-QA.md before approving.
