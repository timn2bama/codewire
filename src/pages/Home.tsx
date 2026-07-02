import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, HelpCircle, Search, UserCircle, Zap } from "lucide-react";
import { CALCULATORS } from "../calculators/registry";

export default function Home() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CALCULATORS;
    return CALCULATORS.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.blurb.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-6">
      <header className="mb-5 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">
          <Zap size={20} />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold leading-none">Codewire</h1>
          <p className="text-sm text-slate-500">NEC field calculators</p>
        </div>
        <Link
          to="/jobs"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Saved jobs"
        >
          <Briefcase size={24} />
        </Link>
        <Link
          to="/account"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Account and subscription"
        >
          <UserCircle size={24} />
        </Link>
        <Link
          to="/about"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="What is this and how to use it"
        >
          <HelpCircle size={24} />
        </Link>
      </header>

      <Link
        to="/about"
        className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm text-slate-200 active:bg-brand/20"
      >
        <span>
          <strong>New here?</strong> What this is &amp; how to use it
        </span>
        <span className="text-brand">→</span>
      </Link>

      <div className="relative mb-5">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
        />
        <input
          className="field-input pl-11"
          placeholder="Search calculators…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {results.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.id}
              to={c.path}
              className="group flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition active:scale-[0.99] active:bg-slate-800"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
                <Icon size={24} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold">{c.title}</h2>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                    {c.code}
                  </span>
                </div>
                <p className="text-sm text-slate-400">{c.blurb}</p>
              </div>
            </Link>
          );
        })}
        {results.length === 0 && (
          <p className="col-span-full py-8 text-center text-slate-500">
            No calculator matches “{query}”.
          </p>
        )}
      </div>

      <div className="mt-8 border-t border-slate-800 pt-4 text-center text-xs leading-relaxed text-slate-500">
        <span className="text-slate-600">Guides: </span>
        <Link to="/voltage-drop-guide" className="text-slate-400 hover:text-brand">
          Voltage drop
        </Link>
        {" · "}
        <Link to="/conduit-fill-guide" className="text-slate-400 hover:text-brand">
          Conduit fill
        </Link>
        {" · "}
        <Link to="/wire-size-chart" className="text-slate-400 hover:text-brand">
          Wire size chart
        </Link>
        {" · "}
        <Link to="/box-fill-guide" className="text-slate-400 hover:text-brand">
          Box fill
        </Link>
        {" · "}
        <Link to="/conduit-bending-guide" className="text-slate-400 hover:text-brand">
          Bending
        </Link>
        {" · "}
        <Link to="/codewire-vs-uglys" className="text-slate-400 hover:text-brand">
          vs Ugly's
        </Link>
      </div>

      <p className="mt-4 text-center text-xs text-slate-600">
        Works offline. Verify against the code edition adopted by your AHJ.
      </p>
      <p className="mt-2 text-center text-xs text-slate-600">
        Feedback?{" "}
        <a
          href="mailto:codewire.tools@gmail.com?subject=Codewire%20feedback"
          className="text-brand"
        >
          codewire.tools@gmail.com
        </a>
      </p>
    </div>
  );
}
