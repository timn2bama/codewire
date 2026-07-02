/**
 * Per-route prerender for the Codewire SPA.
 *
 * Vite outputs a single dist/index.html shell. Crawlers (and most AI bots)
 * don't run JS, so every route would otherwise show the same homepage text.
 * This reads that built shell and writes one static HTML file per public route
 * with a route-specific <title>, meta description, canonical/OG/Twitter tags,
 * JSON-LD (WebApplication + FAQPage), and unique no-JS content inside #root.
 * The same hashed JS/CSS bundle is referenced, so when JS loads, React Router
 * renders the real interactive page. Users never see the fallback; crawlers do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const SITE = "https://codewire.tools";
const template = readFileSync(join(dist, "index.html"), "utf8");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A calculator/page definition. */
const routes = [
  {
    path: "/voltage-drop",
    title: "Voltage Drop Calculator (NEC) — Codewire",
    desc: "Free NEC voltage drop calculator for electricians. Enter wire size, load current, one-way length and voltage to get percent drop, voltage at the load, and the minimum wire size to stay within 3% / 5%.",
    h1: "Voltage Drop Calculator (NEC)",
    intro:
      "Calculate voltage drop for copper or aluminum conductors and find the smallest wire size that keeps you within code. Works for single-phase and three-phase circuits, offline, on any phone.",
    how: [
      "Pick single- or three-phase and copper or aluminum.",
      "Enter wire size, load current (amps), one-way run length (feet) and system voltage.",
      "Read the percent drop and voltage at the load instantly; the tool also flags the smallest wire size within 3%.",
    ],
    detail:
      "Codewire uses the circular-mil method: single-phase VD = 2 × K × I × L ÷ CM, and three-phase VD = 1.732 × K × I × L ÷ CM (K ≈ 12.9 for copper, 21.2 for aluminum). NEC 210.19 and 215 recommend keeping branch-circuit drop at or below 3% and total drop (feeder + branch) at or below 5%.",
    faq: [
      {
        q: "How do you calculate voltage drop?",
        a: "For a single-phase circuit, voltage drop = 2 × K × I × L ÷ CM, where K is the conductor constant (~12.9 for copper), I is the load current in amps, L is the one-way length in feet, and CM is the conductor's circular-mil area. For three-phase, multiply by 1.732 instead of 2.",
      },
      {
        q: "What is the maximum voltage drop allowed by the NEC?",
        a: "The NEC recommends (in informational notes to 210.19 and 215.2) a maximum 3% voltage drop on a branch circuit and 5% total for feeder plus branch. These are recommendations, not hard requirements, but inspectors and designers commonly enforce them.",
      },
      {
        q: "How do I fix excessive voltage drop?",
        a: "Increase the wire size (more circular mils), shorten the run, reduce the load, or raise the system voltage. Codewire's voltage drop calculator suggests the smallest wire size that brings you within 3%.",
      },
    ],
  },
  {
    path: "/conduit-fill",
    title: "Conduit Fill Calculator (NEC Chapter 9) — Codewire",
    desc: "Free NEC conduit fill calculator. Choose conduit type and size, add your conductors, and see fill percentage with pass/fail plus the smallest conduit that fits. Covers EMT, IMC, RMC, PVC 40/80, ENT, FMC, LFMC.",
    h1: "Conduit Fill Calculator (NEC Chapter 9)",
    intro:
      "Check whether your conductors fit a conduit per NEC Chapter 9, and find the smallest conduit size that passes. Supports EMT, IMC, RMC, PVC Schedule 40/80, ENT, FMC and LFMC with THHN/THWN-2 and XHHW conductors.",
    how: [
      "Select the conduit type and trade size.",
      "Add each conductor's insulation, size and quantity.",
      "Read the fill percentage and pass/fail; the tool also recommends the smallest conduit that fits.",
    ],
    detail:
      "Conduit fill compares the total conductor cross-sectional area (NEC Chapter 9, Table 5) against the conduit's allowable area (Table 4 area × the Table 1 percentage). The allowable fill is 53% for one conductor, 31% for two, and 40% for three or more.",
    faq: [
      {
        q: "How do you calculate conduit fill?",
        a: "Add up the cross-sectional area of all conductors (NEC Chapter 9, Table 5), then divide by the conduit's total interior area (Table 4). Compare that to the Table 1 limit for the number of conductors.",
      },
      {
        q: "What is the maximum conduit fill percentage?",
        a: "Per NEC Chapter 9, Table 1: 53% for a single conductor, 31% for two conductors, and 40% for three or more conductors.",
      },
      {
        q: "Does conduit fill depend on wire insulation type?",
        a: "Yes. Different insulations (e.g. THHN/THWN-2 vs XHHW) have different diameters for the same wire size, so they take up different amounts of space. Codewire accounts for the insulation type you choose.",
      },
    ],
  },
  {
    path: "/ampacity",
    title: "Wire Ampacity Calculator with Derating (NEC 310.16) — Codewire",
    desc: "Free NEC wire ampacity calculator. Get allowable ampacity for copper or aluminum with ambient-temperature and conductor-bundling derating and termination limits, or reverse-solve the minimum wire size for a load.",
    h1: "Wire Ampacity Calculator (NEC 310.16)",
    intro:
      "Find the safe current-carrying capacity of a conductor after temperature and bundling derating, or work backward to the minimum wire size for a given load. Based on NEC Table 310.16 with 310.15 correction and adjustment factors.",
    how: [
      "Choose copper or aluminum, the insulation temperature column (60/75/90°C) and wire size.",
      "Enter the ambient temperature and the number of current-carrying conductors.",
      "Read the derated, usable ampacity (limited by the termination rating per 110.14(C)).",
    ],
    detail:
      "Final ampacity = base ampacity (Table 310.16) × ambient correction factor (Table 310.15(B)(1)) × bundling adjustment factor (Table 310.15(C)(1)), then capped at the ampacity of the termination temperature rating per 110.14(C).",
    faq: [
      {
        q: "How do you calculate derated ampacity?",
        a: "Start with the base ampacity from NEC Table 310.16, multiply by the ambient temperature correction factor (Table 310.15(B)(1)) and the adjustment factor for more than three current-carrying conductors (Table 310.15(C)(1)), then limit the result to the termination temperature rating per 110.14(C).",
      },
      {
        q: "What is the ampacity of 12 AWG copper wire?",
        a: "12 AWG copper is 20 A at 60°C, 25 A at 75°C, and 30 A at 90°C per NEC Table 310.16, before any derating. Terminations commonly limit it to the 60°C or 75°C column.",
      },
      {
        q: "When do you derate for number of conductors?",
        a: "When more than three current-carrying conductors share a raceway or cable, NEC 310.15(C)(1) requires adjustment: 80% for 4–6, 70% for 7–9, 50% for 10–20, and so on.",
      },
    ],
  },
  {
    path: "/box-fill",
    title: "Box Fill Calculator (NEC 314.16) — Codewire",
    desc: "Free NEC box fill calculator. Add conductors, devices, clamps and grounds to get the required cubic inches versus your box volume with pass/fail, per NEC 314.16.",
    h1: "Box Fill Calculator (NEC 314.16)",
    intro:
      "Make sure a junction or device box is large enough. Codewire totals the required volume from conductors, devices, clamps and equipment grounds and compares it to your box volume, per NEC 314.16.",
    how: [
      "Enter the box volume (or pick a common box) in cubic inches.",
      "Add conductors by size and count, the number of device yokes, clamps and the largest equipment ground.",
      "Read the required volume versus the box volume with an instant fits / too-small result.",
    ],
    detail:
      "Each conductor uses the volume allowance from Table 314.16(B) (e.g. 2.25 cu in for 12 AWG). Each device yoke counts as two of the largest conductor, all clamps count as one, and all equipment grounds count as one of the largest ground.",
    faq: [
      {
        q: "How do you calculate box fill?",
        a: "Add the Table 314.16(B) volume allowance for each conductor, plus two allowances per device yoke (based on the largest conductor), one for all internal clamps, and one for all equipment grounding conductors. Compare the total to the box's cubic-inch volume.",
      },
      {
        q: "How many cubic inches does a 12 AWG wire need in a box?",
        a: "2.25 cubic inches per 12 AWG conductor, per NEC Table 314.16(B). 14 AWG needs 2.0, 10 AWG needs 2.5.",
      },
    ],
  },
  {
    path: "/conduit-bending",
    title: "Conduit Bending Calculator — Offsets, Saddles & Stubs — Codewire",
    desc: "Free conduit bending calculator for electricians: offsets, three- and four-point saddles, and 90° stub-ups. Get mark distances, shrink and multipliers instantly.",
    h1: "Conduit Bending Calculator",
    intro:
      "Lay out conduit bends fast: offsets, three-point and four-point saddles, and 90° stub-ups. Codewire gives the distance between marks, shrink, and the multiplier so you bend it right the first time.",
    how: [
      "Pick the bend type: offset, 3-point saddle, 4-point saddle, or 90° stub.",
      "Enter the rise/depth and the bend angle (or conduit size for take-up).",
      "Read the mark distances and shrink instantly.",
    ],
    detail:
      "Offset distance between bends = rise ÷ sin(angle); shrink = rise × tan(angle ÷ 2). Common multipliers: 10° ≈ 6.0, 22.5° ≈ 2.6, 30° = 2.0, 45° ≈ 1.4, 60° ≈ 1.15. A 90° stub mark = desired height − the take-up for the conduit size.",
    faq: [
      {
        q: "What is the multiplier for a 30-degree offset?",
        a: "2.0. The distance between the two bends equals the offset height times 2 (1 ÷ sin 30°). Codewire uses the exact cosecant so other angles are precise too.",
      },
      {
        q: "How do you calculate conduit shrink on an offset?",
        a: "Shrink = offset height × tan(angle ÷ 2). For a 30° offset that's about 0.27 inches of shrink per inch of rise.",
      },
    ],
  },
  {
    path: "/about",
    title: "What is Codewire? NEC Calculators for Electricians",
    desc: "Codewire is a fast, offline app that puts five NEC calculators in one place for electricians: voltage drop, conduit fill, conduit bending, box fill and wire ampacity.",
    h1: "What is Codewire?",
    intro:
      "Codewire is a field reference app for electricians. It replaces juggling several apps and a paper code book by putting the five most-used National Electrical Code calculators in one fast, offline, mobile-first tool with instant pass/fail.",
    how: [
      "Enter values you already have — wire size, amps, run length, box size. It's a calculator, not a measuring tool.",
      "Each tool runs the NEC formula and tables and shows a clear pass / fail as you type.",
      "Save calculations to jobs; everything works offline.",
    ],
    detail:
      "The five calculators are voltage drop, conduit fill, conduit bending, box fill and wire ampacity, based on the NEC 2023 edition. The calculators are free; Codewire Pro ($6/month or $45/year) adds unlimited saved jobs, cloud sync and PDF export.",
    faq: [
      {
        q: "Is Codewire free?",
        a: "Yes. All five NEC calculators are free, with up to two saved jobs on your device. Codewire Pro ($6/month or $45/year) adds unlimited jobs, cloud sync across devices, and PDF report export.",
      },
      {
        q: "Does Codewire work offline?",
        a: "Yes. It's an installable app that runs entirely on your device, so the calculators work in basements and job sites with no signal.",
      },
    ],
  },
  {
    path: "/upgrade",
    title: "Codewire Pro — Cloud Sync, Unlimited Jobs, PDF Export",
    desc: "Codewire Pro is $6/month or $45/year (7-day free trial). The NEC calculators stay free; Pro adds cloud sync across devices, unlimited saved jobs, and PDF report export.",
    h1: "Codewire Pro",
    intro:
      "The calculators are always free. Codewire Pro keeps your jobs backed up and synced across devices and unlocks the field workflow.",
    how: [
      "Cloud sync and backup of your jobs across all your devices.",
      "Unlimited saved jobs (the free plan keeps two).",
      "Export job reports to PDF.",
    ],
    detail:
      "Codewire Pro is $6.00/month or $45.00/year (about 38% off the monthly rate) with a 7-day free trial. Cancel anytime.",
    faq: [
      {
        q: "How much does Codewire Pro cost?",
        a: "$6.00 per month or $45.00 per year, which is about 38% off the monthly price. There's a 7-day free trial and you can cancel anytime.",
      },
    ],
  },
];

function bodyHtml(r) {
  const how = r.how.map((s) => `<li>${esc(s)}</li>`).join("");
  const faq = r.faq
    .map(
      (f) =>
        `<div><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`,
    )
    .join("");
  return `
      <main style="max-width: 42rem; margin: 0 auto; padding: 1.5rem">
        <h1>${esc(r.h1)}</h1>
        <p>${esc(r.intro)}</p>
        <h2>How to use it</h2>
        <ol>${how}</ol>
        <p>${esc(r.detail)}</p>
        <h2>Frequently asked questions</h2>
        ${faq}
        <p><a href="/">All Codewire calculators</a> · Free for electricians. Verify against the NEC edition adopted by your local AHJ.</p>
      </main>`;
}

function jsonLd(r) {
  const url = SITE + r.path;
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: r.h1,
      url,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, iOS, Android (PWA)",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: r.desc,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: r.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
  return JSON.stringify(data);
}

/** Apply a page's title/meta/JSON-LD/body to the built shell template. */
function renderPage({ title, desc, path, ldStr, body }) {
  const url = SITE + path;
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/>/,
    `<meta name="description" content="${esc(desc)}" />`,
  );
  html = html.replace(
    /<link rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${url}" />`,
  );
  html = html.replace(
    /<meta property="og:title"[^>]*>/,
    `<meta property="og:title" content="${esc(title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"[\s\S]*?\/>/,
    `<meta property="og:description" content="${esc(desc)}" />`,
  );
  html = html.replace(
    /<meta property="og:url"[^>]*>/,
    `<meta property="og:url" content="${url}" />`,
  );
  html = html.replace(
    /<meta name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" content="${esc(title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"[\s\S]*?\/>/,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
  );
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">${ldStr}</script>`,
  );
  html = html.replace(
    /<div id="root">[\s\S]*?<\/div>\s*<\/body>/,
    `<div id="root">${body}</div>\n  </body>`,
  );
  return html;
}

let count = 0;
for (const r of routes) {
  const html = renderPage({
    title: r.title,
    desc: r.desc,
    path: r.path,
    ldStr: jsonLd(r),
    body: bodyHtml(r),
  });
  writeFileSync(join(dist, r.path.replace(/^\//, "") + ".html"), html);
  count++;
}

// --- SEO guide/content pages (from src/content/guides.json) ---------------
const guides = JSON.parse(
  readFileSync(join(process.cwd(), "src", "content", "guides.json"), "utf8"),
);

function guideBody(g) {
  const faq = g.faq
    .map((f) => `<div><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`)
    .join("");
  return `
      <main style="max-width: 42rem; margin: 0 auto; padding: 1.5rem">
        <h1>${esc(g.h1)}</h1>
        ${g.html}
        <p><a href="${g.calcPath}">${esc(g.calcLabel)}</a></p>
        <h2>Frequently asked questions</h2>
        ${faq}
        <p><a href="/">All Codewire calculators</a> · Verify against the NEC edition adopted by your AHJ.</p>
      </main>`;
}

function guideLd(g) {
  return JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: g.h1,
      description: g.description,
      author: { "@type": "Organization", name: "Codewire" },
      publisher: { "@type": "Organization", name: "Codewire" },
      mainEntityOfPage: SITE + g.path,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: g.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ]);
}

for (const g of guides) {
  const html = renderPage({
    title: g.title,
    desc: g.description,
    path: g.path,
    ldStr: guideLd(g),
    body: guideBody(g),
  });
  writeFileSync(join(dist, g.path.replace(/^\//, "") + ".html"), html);
  count++;
}

console.log(`prerender: wrote ${count} pages`);
