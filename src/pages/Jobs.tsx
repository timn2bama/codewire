import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, FolderOpen, Briefcase, Search } from "lucide-react";
import { formatAddress, useJobs, useSavedCalcs } from "../lib/jobs";

export default function Jobs() {
  const jobs = useJobs();
  const calcs = useSavedCalcs();
  const [query, setQuery] = useState("");

  const countFor = (jobId: string) =>
    calcs.filter((c) => c.jobId === jobId).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => {
      const jobCalcs = calcs.filter((c) => c.jobId === j.id);
      const haystack = [
        j.name,
        j.jobNumber,
        formatAddress(j),
        j.phone,
        j.notes,
        ...jobCalcs.map((c) => `${c.title} ${c.summary} ${c.result}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [jobs, calcs, query]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link
          to="/"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Back to calculators"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">Saved Jobs</h1>
      </header>

      {jobs.length > 0 && (
        <div className="relative mb-4">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="field-input pl-11"
            placeholder="Search name, address, notes, calc…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="mt-10 flex flex-col items-center text-center text-slate-500">
          <Briefcase size={40} className="mb-3 text-slate-700" />
          <p className="font-medium text-slate-400">No saved jobs yet</p>
          <p className="mt-1 max-w-xs text-sm">
            Run any calculator and tap <strong>Save</strong> to file the result
            under a job. Everything is stored on this device and works offline.
          </p>
          <Link
            to="/"
            className="mt-5 rounded-xl bg-brand px-5 py-2.5 font-semibold text-white active:bg-brand-dark"
          >
            Open the calculators
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">
          No jobs match “{query}”.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((j) => (
            <Link
              key={j.id}
              to={`/jobs/${j.id}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 active:bg-slate-800"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
                <FolderOpen size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-bold">
                  {j.name}
                  {j.jobNumber && (
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      #{j.jobNumber}
                    </span>
                  )}
                </h2>
                {formatAddress(j) && (
                  <p className="truncate text-sm text-slate-500">
                    {formatAddress(j)}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300">
                {countFor(j.id)} saved
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
