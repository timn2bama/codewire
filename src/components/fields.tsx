import type { ReactNode } from "react";

interface NumberFieldProps {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  unit?: string;
  step?: number;
  min?: number;
  placeholder?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step,
  min,
  placeholder,
}: NumberFieldProps) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          className="field-input"
          value={value}
          step={step}
          min={min}
          placeholder={placeholder}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
        />
        {unit && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
            {unit}
          </span>
        )}
      </div>
    </label>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: SelectFieldProps<T>) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select
        className="field-select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div>
      {label && <span className="field-label">{label}</span>}
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`seg-btn ${value === o.value ? "seg-btn-on" : "seg-btn-off"}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4">{children}</div>;
}
