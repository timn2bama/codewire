# Codewire — NEC / NFPA Copyright Assessment

_2026-06-16. Informational risk assessment for the operator — **not legal
advice.** Get sign-off from an IP attorney before large-scale marketing or any
feature that displays code text._

## The situation

The National Electrical Code (NEC / NFPA 70) is published by the NFPA, which
asserts **copyright** in the code's text and presentation. At the same time:

- **Facts and data aren't copyrightable.** Numeric values — an ampacity, a
  conduit's cross-sectional area, a circular-mil figure — are facts. Copyright
  protects the NFPA's *expression* (wording, prose, layout, selection/arrangement
  in some cases), not the underlying physical/numeric facts.
- **Codes adopted into law** have materially weaker protection. Courts have held
  that model codes enacted into law can be reproduced (e.g. *Veeck v. SBCCI*,
  5th Cir. 2002) and that posting incorporated-by-reference standards can be fair
  use (*ASTM v. Public.Resource.Org*, D.C. Cir. 2018). Most U.S. jurisdictions
  adopt the NEC by reference into law.

## How Codewire uses the data (low-risk by design)

- Codewire embeds **numeric values inside calculators** and uses them to compute
  a result. It does **not** reproduce NEC prose, informational notes, figures,
  or full tables for browsing.
- It **cites section/table numbers** (e.g. "NEC 310.16," "Chapter 9, Table 4").
  Citing a section number is referencing a fact, not copying expression.
- This "compute with the facts" use is the lowest-risk category — substantially
  different from republishing the code text or offering a searchable copy of the
  NEC tables.

## Where risk would increase (avoid without licensing/counsel)

- A feature that **displays full NEC tables verbatim** for browsing/reference
  (reproducing the NFPA's selection, arrangement, and presentation).
- Copying NEC **prose, informational notes, exception text, or figures**.
- Marketing that implies official NFPA affiliation or endorsement.

## Recommendations

1. **Keep the current model:** values used for computation + section-number
   citations. Do not add a "browse the NEC tables" view.
2. **Keep disclaimers** (already present on every calculator): field aid only,
   verify against the AHJ-adopted edition, not affiliated with NFPA.
3. **Consider an NFPA data license** (NFPA offers licensing/APIs) if you later
   want to surface more, or simply for peace of mind as you scale.
4. **Don't claim affiliation** with or endorsement by NFPA anywhere.
5. **Get IP-counsel sign-off** before a major launch push, and have them confirm
   the above for your specific jurisdiction and feature set.

## Bottom line

The current implementation — numeric values driving calculators, with section
citations and verify-the-book disclaimers — is a defensible, low-risk use. The
main thing to *not* do is turn Codewire into a republisher of the NEC's text or
tables. Treat this as a starting point for a conversation with counsel, not a
clearance.
