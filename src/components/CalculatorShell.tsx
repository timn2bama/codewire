import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Bookmark, Check } from "lucide-react";
import { EDITION } from "../lib/nec/2023";
import { SaveCalcSheet, type SaveData } from "./SaveCalcSheet";

interface Props {
  title: string;
  subtitle?: string;
  /** Left column: inputs. */
  children: ReactNode;
  /** Right / bottom: the sticky result. */
  result: ReactNode;
  /** Enables the Save-to-job button when provided. */
  saveData?: SaveData;
}

export function CalculatorShell({
  title,
  subtitle,
  children,
  result,
  saveData,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-28 pt-4">
      <header className="mb-4 flex items-center gap-2">
        <Link
          to="/"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Back to calculators"
        >
          <ChevronLeft size={24} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        {saveData && (
          <button
            onClick={() => setSheetOpen(true)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              justSaved
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-slate-800 text-slate-200 active:bg-slate-700"
            }`}
          >
            {justSaved ? <Check size={18} /> : <Bookmark size={18} />}
            {justSaved ? "Saved" : "Save"}
          </button>
        )}
      </header>

      <div className="space-y-5">{children}</div>

      <p className="mt-6 text-xs leading-relaxed text-slate-600">
        {EDITION.code}. {EDITION.note} Not a substitute for the code book or a
        licensed inspection.
      </p>

      {/* Sticky live result */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">{result}</div>
      </div>

      {sheetOpen && saveData && (
        <SaveCalcSheet
          data={saveData}
          onClose={() => setSheetOpen(false)}
          onSaved={() => {
            setSheetOpen(false);
            setJustSaved(true);
          }}
        />
      )}
    </div>
  );
}
