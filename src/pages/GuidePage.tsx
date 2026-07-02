import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import guides from "../content/guides.json";

export default function GuidePage({ slug }: { slug: string }) {
  const g = guides.find((x) => x.slug === slug);

  if (!g) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-10 text-center text-slate-500">
        <p>Guide not found.</p>
        <Link to="/" className="mt-3 inline-block text-brand">
          ← Home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-4 flex items-center gap-2">
        <Link
          to="/"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Back to calculators"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-2xl font-extrabold leading-tight">{g.h1}</h1>
      </header>

      <article
        className="guide-content"
        dangerouslySetInnerHTML={{ __html: g.html }}
      />

      <div className="my-6">
        <Link
          to={g.calcPath}
          className="inline-block rounded-xl bg-brand px-6 py-3 font-semibold text-white active:bg-brand-dark"
        >
          {g.calcLabel}
        </Link>
      </div>

      <h2 className="mb-3 mt-2 text-lg font-bold">Frequently asked questions</h2>
      <div className="space-y-4">
        {g.faq.map((f) => (
          <div key={f.q}>
            <h3 className="font-semibold text-slate-100">{f.q}</h3>
            <p className="text-slate-300">{f.a}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-slate-600">
        Field aid only — verify against the NEC edition adopted by your AHJ.
      </p>
    </div>
  );
}
