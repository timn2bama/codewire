import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Trash2,
  ExternalLink,
  MapPin,
  Phone,
  StickyNote,
  Pencil,
  FileDown,
  Lock,
} from "lucide-react";
import { EditJobSheet } from "../components/EditJobSheet";
import { useSubscription } from "../lib/subscription";
import {
  deleteCalc,
  deleteJob,
  formatAddress,
  useJobs,
  useSavedCalcs,
} from "../lib/jobs";

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const jobs = useJobs();
  const calcs = useSavedCalcs();
  const { isPro } = useSubscription();
  const [editing, setEditing] = useState(false);

  const job = jobs.find((j) => j.id === id);
  const jobCalcs = calcs.filter((c) => c.jobId === id);

  if (!job) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-10 text-center text-slate-500">
        <p>This job no longer exists.</p>
        <Link to="/jobs" className="mt-3 inline-block text-brand">
          ← Back to jobs
        </Link>
      </div>
    );
  }

  const removeJob = () => {
    if (confirm(`Delete "${job.name}" and its ${jobCalcs.length} saved calcs?`)) {
      deleteJob(job.id);
      navigate("/jobs");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link
          to="/jobs"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Back to jobs"
        >
          <ChevronLeft size={24} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">
            {job.name}
            {job.jobNumber && (
              <span className="ml-2 text-base font-normal text-slate-500">
                #{job.jobNumber}
              </span>
            )}
          </h1>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Edit job"
        >
          <Pencil size={20} />
        </button>
        <button
          onClick={removeJob}
          className="rounded-lg p-2 text-slate-500 active:bg-slate-800"
          aria-label="Delete job"
        >
          <Trash2 size={20} />
        </button>
      </header>

      {(formatAddress(job) || job.phone || job.notes) && (
        <div className="mb-5 space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
          {formatAddress(job) && (
            <div className="flex items-start gap-2 text-slate-300">
              <MapPin size={16} className="mt-0.5 shrink-0 text-slate-500" />
              <span>{formatAddress(job)}</span>
            </div>
          )}
          {job.phone && (
            <div className="flex items-center gap-2">
              <Phone size={16} className="shrink-0 text-slate-500" />
              <a href={`tel:${job.phone}`} className="text-brand">
                {job.phone}
              </a>
            </div>
          )}
          {job.notes && (
            <div className="flex items-start gap-2 text-slate-300">
              <StickyNote size={16} className="mt-0.5 shrink-0 text-slate-500" />
              <span className="whitespace-pre-wrap">{job.notes}</span>
            </div>
          )}
        </div>
      )}

      {jobCalcs.length > 0 &&
        (isPro ? (
          <Link
            to={`/jobs/${job.id}/report`}
            className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 font-semibold text-slate-100 active:bg-slate-700"
          >
            <FileDown size={18} /> Export PDF report
          </Link>
        ) : (
          <Link
            to="/upgrade"
            className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/10 py-3 font-semibold text-brand"
          >
            <Lock size={16} /> Export PDF (Pro)
          </Link>
        ))}

      {jobCalcs.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">
          No saved calculations in this job.
        </p>
      ) : (
        <div className="space-y-3">
          {jobCalcs.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-bold leading-tight">{c.title}</h2>
                  <p className="mt-0.5 text-sm text-slate-400">{c.summary}</p>
                  <p className="mt-1 font-mono text-brand">{c.result}</p>
                </div>
                <button
                  onClick={() => deleteCalc(c.id)}
                  className="shrink-0 rounded-lg p-2 text-slate-500 active:bg-slate-800"
                  aria-label="Delete calculation"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <button
                onClick={() => navigate(c.path, { state: { loadCalc: c.state } })}
                className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 active:bg-slate-700"
              >
                <ExternalLink size={16} /> Open in calculator
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditJobSheet
          job={job}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </div>
  );
}
