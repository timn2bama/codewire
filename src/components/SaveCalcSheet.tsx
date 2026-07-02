import { useState } from "react";
import { track } from "@vercel/analytics";
import { Link } from "react-router-dom";
import { X, FolderPlus, CheckCircle2, Lock } from "lucide-react";
import {
  createJob,
  formatAddress,
  saveCalc,
  useJobs,
  FREE_JOB_LIMIT,
} from "../lib/jobs";
import { useSubscription } from "../lib/subscription";
import {
  JobFields,
  emptyJobForm,
  formToInput,
  type JobFormValues,
} from "./JobFields";

export interface SaveData {
  calculatorId: string;
  path: string;
  defaultTitle: string;
  summary: string;
  result: string;
  state: unknown;
}

interface Props {
  data: SaveData;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveCalcSheet({ data, onClose, onSaved }: Props) {
  const jobs = useJobs();
  const { isPro } = useSubscription();
  const atJobLimit = !isPro && jobs.length >= FREE_JOB_LIMIT;
  const [title, setTitle] = useState(data.defaultTitle);
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [creating, setCreating] = useState(jobs.length === 0);
  const [nj, setNj] = useState<JobFormValues>(emptyJobForm);
  const njSet = (k: keyof JobFormValues, v: string) =>
    setNj((p) => ({ ...p, [k]: v }));

  const canSave =
    title.trim().length > 0 &&
    (creating
      ? nj.name.trim().length > 0 && !atJobLimit
      : jobId.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const job =
      creating || !jobId
        ? createJob(formToInput(nj))
        : jobs.find((j) => j.id === jobId)!;
    saveCalc({
      jobId: job.id,
      calculatorId: data.calculatorId,
      path: data.path,
      title: title.trim(),
      summary: data.summary,
      result: data.result,
      state: data.state,
    });
    track("save_calc", { calculator: data.calculatorId });
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-t-2xl border-t border-slate-700 bg-slate-900 p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Save calculation</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 active:bg-slate-800"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
          <div className="text-slate-300">{data.summary}</div>
          <div className="font-mono text-brand">{data.result}</div>
        </div>

        <label className="mb-4 block">
          <span className="field-label">Label</span>
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Kitchen circuit"
          />
        </label>

        {jobs.length > 0 && !creating && (
          <div className="mb-3">
            <span className="field-label">Job</span>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {jobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setJobId(j.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${
                    jobId === j.id
                      ? "border-brand bg-brand/10"
                      : "border-slate-800 bg-slate-950"
                  }`}
                >
                  <span>
                    <span className="font-semibold">{j.name}</span>
                    {formatAddress(j) && (
                      <span className="block text-sm text-slate-500">
                        {formatAddress(j)}
                      </span>
                    )}
                  </span>
                  {jobId === j.id && (
                    <CheckCircle2 size={20} className="text-brand" />
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCreating(true)}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium text-brand"
            >
              <FolderPlus size={16} /> New job
            </button>
          </div>
        )}

        {creating && atJobLimit && (
          <div className="mb-3 rounded-xl border border-brand/30 bg-brand/10 p-4 text-center">
            <Lock className="mx-auto mb-2 text-brand" size={24} />
            <p className="font-semibold">Free plan keeps {FREE_JOB_LIMIT} jobs</p>
            <p className="mt-1 text-sm text-slate-400">
              Upgrade to Pro for unlimited jobs plus cloud backup across devices.
            </p>
            <Link
              to="/upgrade"
              onClick={onClose}
              className="mt-3 inline-block rounded-xl bg-brand px-5 py-2.5 font-semibold text-white active:bg-brand-dark"
            >
              See Pro
            </Link>
            <button
              onClick={() => setCreating(false)}
              className="mt-3 block w-full text-sm font-medium text-slate-400"
            >
              ← Pick an existing job
            </button>
          </div>
        )}

        {creating && !atJobLimit && (
          <div className="mb-3 max-h-[46vh] space-y-3 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3">
            <JobFields value={nj} onChange={njSet} autoFocus />
            {jobs.length > 0 && (
              <button
                onClick={() => setCreating(false)}
                className="text-sm font-medium text-slate-400"
              >
                ← Pick an existing job
              </button>
            )}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!canSave}
          className="mt-2 w-full rounded-xl bg-brand py-3.5 font-semibold text-white disabled:opacity-40 active:bg-brand-dark"
        >
          Save to job
        </button>
      </div>
    </div>
  );
}
