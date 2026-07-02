import type { Job, JobInput } from "../lib/jobs";

export interface JobFormValues {
  name: string;
  jobNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  notes: string;
}

export const emptyJobForm: JobFormValues = {
  name: "",
  jobNumber: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  notes: "",
};

/** Prefill the form from an existing job. */
export function jobToForm(job: Job): JobFormValues {
  return {
    name: job.name ?? "",
    jobNumber: job.jobNumber ?? "",
    address: job.address ?? "",
    city: job.city ?? "",
    state: job.state ?? "",
    zip: job.zip ?? "",
    phone: job.phone ?? "",
    notes: job.notes ?? "",
  };
}

/** Convert form values to a stored job (trim, drop empty optionals). */
export function formToInput(f: JobFormValues): JobInput {
  const t = (v: string) => v.trim() || undefined;
  return {
    name: f.name.trim(),
    jobNumber: t(f.jobNumber),
    address: t(f.address),
    city: t(f.city),
    state: t(f.state),
    zip: t(f.zip),
    phone: t(f.phone),
    notes: t(f.notes),
  };
}

interface Props {
  value: JobFormValues;
  onChange: (key: keyof JobFormValues, val: string) => void;
  autoFocus?: boolean;
}

export function JobFields({ value, onChange, autoFocus }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <span className="field-label">Job / project name *</span>
          <input
            className="field-input"
            value={value.name}
            onChange={(e) => onChange("name", e.target.value)}
            placeholder="e.g. Smith Residence"
            autoFocus={autoFocus}
          />
        </label>
        <label className="block w-28">
          <span className="field-label">Job #</span>
          <input
            className="field-input"
            value={value.jobNumber}
            onChange={(e) => onChange("jobNumber", e.target.value)}
            placeholder="1042"
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Street address</span>
        <input
          className="field-input"
          value={value.address}
          onChange={(e) => onChange("address", e.target.value)}
          placeholder="123 Main St"
        />
      </label>

      <div className="grid grid-cols-[1fr_auto_auto] gap-3">
        <label className="block">
          <span className="field-label">City</span>
          <input
            className="field-input"
            value={value.city}
            onChange={(e) => onChange("city", e.target.value)}
            placeholder="Austin"
          />
        </label>
        <label className="block w-16">
          <span className="field-label">State</span>
          <input
            className="field-input uppercase"
            maxLength={2}
            value={value.state}
            onChange={(e) => onChange("state", e.target.value.toUpperCase())}
            placeholder="TX"
          />
        </label>
        <label className="block w-24">
          <span className="field-label">ZIP</span>
          <input
            className="field-input"
            inputMode="numeric"
            value={value.zip}
            onChange={(e) => onChange("zip", e.target.value)}
            placeholder="78701"
          />
        </label>
      </div>

      <label className="block">
        <span className="field-label">Phone</span>
        <input
          className="field-input"
          type="tel"
          value={value.phone}
          onChange={(e) => onChange("phone", e.target.value)}
          placeholder="(512) 555-0123"
        />
      </label>

      <label className="block">
        <span className="field-label">Notes</span>
        <textarea
          className="field-input min-h-[72px] resize-y"
          value={value.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          placeholder="Gate code, panel location, contact…"
        />
      </label>
    </div>
  );
}
