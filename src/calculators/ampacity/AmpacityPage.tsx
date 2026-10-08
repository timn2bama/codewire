import { CalculatorShell } from "../../components/CalculatorShell";
import { ResultCard } from "../../components/ResultCard";
import {
  FieldGroup,
  NumberField,
  SelectField,
  Segmented,
} from "../../components/fields";
import { usePersistentState } from "../../lib/usePersistentState";
import { useLoadSavedState } from "../../lib/useLoadSavedState";
import { sizeLabel, WIRE_SIZES } from "../../lib/nec/types";
import type { Material, TempRating, WireSize } from "../../lib/nec/types";
import { calcAmpacity, recommendAmpacitySize } from "../../lib/calc/ampacity";

interface State {
  material: Material;
  size: WireSize;
  tempRating: TempRating;
  ambientC: number | "";
  currentCarrying: number | "";
  terminationRating: TempRating;
  load: number | "";
}

const DEFAULT: State = {
  material: "cu",
  size: "10",
  tempRating: 90,
  ambientC: 30,
  currentCarrying: 3,
  terminationRating: 75,
  load: 30,
};

const sizeOptions = WIRE_SIZES.map((s) => ({ value: s, label: sizeLabel(s) }));
const tempOptions = [
  { value: "60", label: "60 °C" },
  { value: "75", label: "75 °C" },
  { value: "90", label: "90 °C" },
];

export default function AmpacityPage() {
  const [s, setS] = usePersistentState<State>("cw:ampacity", DEFAULT);
  useLoadSavedState<State>(setS);
  const set = <K extends keyof State>(k: K, v: State[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const num = (v: number | "") => (v === "" ? 0 : v);

  // 310.15(C)(1) adjusts for a real bundled count. 0 or blank is an incomplete
  // input; it used to be silently coerced to 1 (the no-adjustment case) and a
  // result was still rendered, which reads like a computed answer.
  const currentCarrying = num(s.currentCarrying);
  const currentCarryingInvalid =
    s.currentCarrying === "" ||
    !Number.isFinite(currentCarrying) ||
    !Number.isInteger(currentCarrying) ||
    currentCarrying < 1;

  // A blank ambient was silently read as 0 °C, which the 310.15(B)(1) table
  // maps to its coldest row — a correction factor above 1. The card then
  // showed a "Derated" figure larger than the base ampacity, something no
  // derating table can produce. Blank is an incomplete input, so the result
  // is withheld rather than computed from an assumed temperature.
  const ambientC = num(s.ambientC);
  const ambientInvalid = s.ambientC === "" || !Number.isFinite(ambientC);
  const invalid = ambientInvalid || currentCarryingInvalid;

  const input = {
    material: s.material,
    size: s.size,
    tempRating: s.tempRating,
    ambientC,
    currentCarrying: currentCarrying || 1,
    terminationRating: s.terminationRating,
  };

  const r = calcAmpacity(input);
  const load = num(s.load);
  const recommended =
    load > 0 && !invalid
      ? recommendAmpacitySize(
          {
            material: s.material,
            tempRating: s.tempRating,
            ambientC,
            currentCarrying: currentCarrying || 1,
            terminationRating: s.terminationRating,
          },
          load,
        )
      : null;

  // toFixed(0) rounded the usable ampacity to the nearest ampere, so a derated
  // 24.6 A was shown as "25 A" while carriesLoad compared the unrounded 24.6 —
  // the card could read "USABLE AMPACITY 25 A" and "< 25 A" at once, reporting
  // an ampacity above the real one. NEC 310.15 gives the ampacity as the
  // derated value and no rule rounds it up, so truncate to a tenth of an ampere
  // (normalising float noise so 54.599999999999994 stays 54.6) and never
  // display a figure larger than the computed ampacity.
  const ampacityStr =
    r.ampacity === null
      ? "—"
      : `${Math.floor(Number((r.ampacity * 10).toFixed(6))) / 10} A`;
  const carriesLoad = r.ampacity !== null && load > 0 && r.ampacity >= load;

  return (
    <CalculatorShell
      title="Wire Ampacity"
      subtitle="Table 310.16 with derating"
      saveData={
        invalid
          ? undefined
          : {
              calculatorId: "ampacity",
              path: "/ampacity",
              defaultTitle: "Wire Ampacity",
              summary: `${s.material.toUpperCase()} ${sizeLabel(s.size)} @${s.tempRating}°C · ${ambientC}°C ambient · ${currentCarrying} cond`,
              result: `${ampacityStr} usable`,
              state: s,
            }
      }
      result={
        invalid ? (
          <div
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
            role="status"
          >
            {ambientInvalid
              ? "Enter an ambient temperature in °C (Table 310.15(B)(1) is based on 30 °C)."
              : "Enter a whole number of current-carrying conductors (1 or more)."}
          </div>
        ) : (
        <ResultCard
          primary={ampacityStr}
          primaryLabel="Usable ampacity"
          stats={[
            { label: "Base", value: r.base === null ? "—" : `${r.base} A` },
            {
              label: "Derated",
              value: r.derated === null ? "—" : `${r.derated.toFixed(1)} A`,
            },
          ]}
          pass={load > 0 ? carriesLoad : undefined}
          passText={`carries ${load} A`}
          failText={`< ${load} A`}
        />
        )
      }
    >
      <Segmented
        label="Conductor"
        value={s.material}
        onChange={(v) => set("material", v)}
        options={[
          { value: "cu", label: "Copper" },
          { value: "al", label: "Aluminum" },
        ]}
      />
      <FieldGroup>
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Wire size"
            value={s.size}
            options={sizeOptions}
            onChange={(v) => set("size", v)}
          />
          <SelectField
            label="Insulation column"
            value={String(s.tempRating)}
            options={tempOptions}
            onChange={(v) => set("tempRating", Number(v) as TempRating)}
          />
          <NumberField
            label="Ambient temp"
            unit="°C"
            value={s.ambientC}
            invalid={ambientInvalid}
            error="Enter an ambient temperature in °C."
            onChange={(v) => set("ambientC", v)}
          />
          <NumberField
            label="# current-carrying"
            value={s.currentCarrying}
            min={1}
            step={1}
            invalid={currentCarryingInvalid}
            error="Enter a whole number of conductors (1 or more)."
            onChange={(v) => set("currentCarrying", v)}
          />
          <SelectField
            label="Termination rating"
            value={String(s.terminationRating)}
            options={tempOptions}
            onChange={(v) => set("terminationRating", Number(v) as TempRating)}
          />
          <NumberField
            label="Load (optional)"
            unit="A"
            value={s.load}
            onChange={(v) => set("load", v)}
          />
        </div>
      </FieldGroup>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
        <span className="text-slate-400">Smallest size for {load || 0} A: </span>
        {load > 0 && recommended ? (
          <button
            className="inline-flex min-h-6 items-center font-semibold text-brand underline-offset-2 hover:underline"
            onClick={() => set("size", recommended)}
          >
            {sizeLabel(recommended)} →
          </button>
        ) : (
          <span className="text-slate-500">
            {load > 0 ? "none in table" : "enter a load"}
          </span>
        )}
      </div>

      {!invalid && (
        <p className="text-xs text-slate-600">
          Factors: ambient {r.ambientFactor ?? "—"} × bundling{" "}
          {r.bundlingFactor}. Final ampacity is limited by the termination
          temperature per 110.14(C).
        </p>
      )}
    </CalculatorShell>
  );
}
