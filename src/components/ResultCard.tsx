import { CheckCircle2, XCircle } from "lucide-react";

interface Stat {
  label: string;
  value: string;
}

interface Props {
  /** Big headline number, e.g. "7.90 V" or '1" EMT'. */
  primary: string;
  primaryLabel: string;
  stats?: Stat[];
  /** undefined = no pass/fail badge; true/false = show badge. */
  pass?: boolean;
  passText?: string;
  failText?: string;
}

export function ResultCard({
  primary,
  primaryLabel,
  stats = [],
  pass,
  passText = "Within code",
  failText = "Exceeds limit",
}: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          {primaryLabel}
        </div>
        <div className="truncate font-mono text-3xl font-bold text-white">
          {primary}
        </div>
        {stats.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-400">
            {stats.map((s) => (
              <span key={s.label}>
                {s.label}:{" "}
                <span className="font-mono text-slate-200">{s.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {pass !== undefined && (
        <div
          className={`flex shrink-0 flex-col items-center rounded-xl px-3 py-2 text-center text-sm font-semibold ${
            pass ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
          }`}
        >
          {pass ? <CheckCircle2 size={28} /> : <XCircle size={28} />}
          <span className="mt-0.5">{pass ? passText : failText}</span>
        </div>
      )}
    </div>
  );
}
