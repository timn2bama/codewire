# Codewire

**Five NEC code calculators for electricians, in one fast, offline app.**

Codewire is a Progressive Web App that runs the everyday National Electrical Code (NEC 2023) math electricians do in the field — no signal required. Open it once and it works offline, on the truck, in the basement, anywhere.

## Calculators

| Calculator | What it does | NEC reference |
|---|---|---|
| **Voltage Drop** | % drop and minimum wire size for a run length | 210.19 / Ch. 9 |
| **Conduit Fill** | Whether your conductors fit the raceway | Ch. 9 Tbl 1, 4, 5 |
| **Wire Ampacity** | Derated ampacity & minimum conductor size | 310.16 / 310.15 |
| **Box Fill** | Cubic inches required vs. box volume | 314.16 |
| **Conduit Bending** | Offsets, saddles & 90° stub-ups | Geometry |

## Why it's trustworthy

A wrong answer in this domain is a real-world hazard, so correctness is built in, not assumed:

- The **NEC data tables** (conductor properties, conduit areas, ampacity, temperature correction, box-fill volumes) live in `src/lib/nec/2023/` — separated from the calculation logic and the UI.
- Every calculator has unit tests, plus a `dataIntegrity` suite that validates the code tables themselves. **44 tests, all passing.**

## Tech stack

- **Vite + React 18 + TypeScript**
- **PWA** (offline-first via `vite-plugin-pwa`)
- **Tailwind CSS**
- **Supabase** — optional accounts + cloud sync (Row-Level Security on all tables)
- **Stripe** — optional Pro subscription (signature-verified webhooks)
- Pre-rendered static pages for SEO

> The app runs **fully free and offline** without any backend. Accounts, cloud sync, and billing are optional Pro features.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # run the calculator + data-integrity tests
npm run build      # type-check, build, and prerender
```

To enable the optional accounts/billing features locally, copy `.env.example` to `.env.local` and fill in your Supabase and Stripe keys. (Server-only keys must also be set in your hosting environment, never committed.)

## Project layout

```
src/
  lib/nec/2023/     NEC code tables (data only)
  lib/calc/         calculation logic (+ tests)
  calculators/      one page per calculator
  pages/            home, jobs, account, guides, legal
  components/       shared UI (calculator shell, fields, results)
api/                Stripe checkout / portal / webhook (serverless)
supabase/           schema + RLS policies
```

## A note on the NEC data

The National Electrical Code® is a copyrighted standard published by the NFPA. Codewire implements calculation methods and references code sections; it reproduces only the factual data values needed to compute results. See [`docs/NEC-COPYRIGHT.md`](docs/NEC-COPYRIGHT.md) for details. NEC® and National Electrical Code® are registered trademarks of the NFPA.

## License

© 2026 Tim N. All rights reserved. This source is published for reference; it is not licensed for redistribution or commercial reuse.
