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
import type { Material, WireSize } from "../../lib/nec/types";
import {
  calcVoltageDrop,
  isValidVoltageDropInput,
  recommendSize,
  type Phase,
} from "../../lib/calc/voltageDrop";

interface State {
  phase: Phase;
  material: Material;
  size: WireSize;
  current: number | "";
  length: number | "";
  voltage: number | "";
  sets: number | "";
}

const DEFAULT: State = {
  phase: "single",
  material: "cu",
  size: "12",
  current: 20,
  length: 100,
  voltage: 120,
  sets: 1,
};

const sizeOptions = WIRE_SIZES.map((s) => ({ value: s, label: sizeLabel(s) }));

export default function VoltageDropPage() {
  const [s, setS] = usePersistentState<State>("cw:voltage-drop", DEFAULT);
  useLoadSavedState<State>(setS);
  const set = <K extends keyof State>(k: K, v: State[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const completeInput =
    s.current !== "" &&
    s.length !== "" &&
    s.voltage !== "" &&
    s.sets !== ""
      ? {
          phase: s.phase,
          material: s.material,
          size: s.size,
          current: s.current,
          length: s.length,
          voltage: s.voltage,
          sets: s.sets,
        }
      : null;
  const valid = completeInput !== null && isValidVoltageDropInput(completeInput);
  const baseInput = valid ? {
    phase: s.phase,
    material: s.material,
    current: completeInput.current,
    length: completeInput.length,
    voltage: completeInput.voltage,
    sets: completeInput.sets,
  } : null;

  const r = baseInput ? calcVoltageDrop({ ...baseInput, size: s.size }) : null;
  const recommended = baseInput ? recommendSize(baseInput, 3) : null;

  return (
    <CalculatorShell
      title="Voltage Drop"
      subtitle="Circular-mil method · 3% branch / 5% total"
      saveData={r ? {
        calculatorId: "voltage-drop",
        path: "/voltage-drop",
        defaultTitle: "Voltage Drop",
        summary: `${s.phase === "single" ? "1Ø" : "3Ø"} ${s.material.toUpperCase()} ${sizeLabel(
          s.size,
        )} · ${s.current} A · ${s.length} ft · ${s.voltage} V`,
        result: `${r.percentDrop.toFixed(2)}% drop (${r.voltageDrop.toFixed(2)} V)`,
        state: s,
      } : undefined}
      result={
        r ? <ResultCard
          primary={`${r.percentDrop.toFixed(2)}%`}
          primaryLabel="Voltage drop"
          stats={[
            { label: "Drop", value: `${r.voltageDrop.toFixed(2)} V` },
            { label: "At load", value: `${r.voltageAtLoad.toFixed(1)} V` },
          ]}
          pass={r.withinBranchLimit}
          passText="≤ 3%"
          failText="> 3%"
        /> : (
          <div
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
            role="status"
          >
            Enter positive, finite values to calculate voltage drop.
          </div>
        )
      }
    >
      <Segmented
        label="Phase"
        value={s.phase}
        onChange={(v) => set("phase", v)}
        options={[
          { value: "single", label: "Single Ø" },
          { value: "three", label: "Three Ø" },
        ]}
      />
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
        <SelectField
          label="Wire size"
          value={s.size}
          options={sizeOptions}
          onChange={(v) => set("size", v)}
        />
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            label="Load current"
            unit="A"
            value={s.current}
            min={0}
            invalid={s.current === "" || !Number.isFinite(s.current) || s.current <= 0}
            error="Enter a current greater than zero."
            onChange={(v) => set("current", v)}
          />
          <NumberField
            label="One-way length"
            unit="ft"
            value={s.length}
            min={0}
            invalid={s.length === "" || !Number.isFinite(s.length) || s.length <= 0}
            error="Enter a length greater than zero."
            onChange={(v) => set("length", v)}
          />
          <NumberField
            label="Voltage"
            unit="V"
            value={s.voltage}
            min={0}
            invalid={s.voltage === "" || !Number.isFinite(s.voltage) || s.voltage <= 0}
            error="Enter a voltage greater than zero."
            onChange={(v) => set("voltage", v)}
          />
          <NumberField
            label="Parallel sets"
            value={s.sets}
            min={1}
            step={1}
            invalid={
              s.sets === "" ||
              !Number.isFinite(s.sets) ||
              !Number.isInteger(s.sets) ||
              s.sets <= 0
            }
            error="Enter a whole number of sets greater than zero."
            onChange={(v) => set("sets", v)}
          />
        </div>
      </FieldGroup>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
        <span className="text-slate-400">Smallest size within 3%: </span>
        {!valid ? (
          <span className="text-amber-300">valid inputs required</span>
        ) : recommended ? (
          <button
            className="font-semibold text-brand underline-offset-2 hover:underline"
            onClick={() => set("size", recommended)}
          >
            {sizeLabel(recommended)} →
          </button>
        ) : (
          <span className="text-red-400">none in table</span>
        )}
      </div>
    </CalculatorShell>
  );
}
