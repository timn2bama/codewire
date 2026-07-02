import { useState } from "react";
import { X } from "lucide-react";
import { updateJob, type Job } from "../lib/jobs";
import {
  JobFields,
  formToInput,
  jobToForm,
  type JobFormValues,
} from "./JobFields";

interface Props {
  job: Job;
  onClose: () => void;
  onSaved: () => void;
}

export function EditJobSheet({ job, onClose, onSaved }: Props) {
  const [form, setForm] = useState<JobFormValues>(jobToForm(job));
  const set = (k: keyof JobFormValues, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    updateJob(job.id, formToInput(form));
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
          <h2 className="text-lg font-bold">Edit job</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 active:bg-slate-800"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        <div className="mb-3 max-h-[52vh] overflow-y-auto">
          <JobFields value={form} onChange={set} autoFocus />
        </div>

        <button
          onClick={handleSave}
          disabled={!canSave}
          className="mt-2 w-full rounded-xl bg-brand py-3.5 font-semibold text-white disabled:opacity-40 active:bg-brand-dark"
        >
          Save changes
        </button>
      </div>
    </div>
  );
}
