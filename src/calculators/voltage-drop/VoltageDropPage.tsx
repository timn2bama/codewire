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

  const num = (v: number | "") => (v === "" ? 0 : v);
  const baseInput = {
    phase: s.phase,
    material: s.material,
    current: num(s.current),
    length: num(s.length),
    voltage: num(s.voltage),
    sets: num(s.sets) || 1,
  };

  const r = calcVoltageDrop({ ...baseInput, size: s.size });
  const recommended = recommendSize(baseInput, 3);

  return (
    <CalculatorShell
      title="Voltage Drop"
      subtitle="Circular-mil method · 3% branch / 5% total"
      saveData={{
        calculatorId: "voltage-drop",
        path: "/voltage-drop",
        defaultTitle: "Voltage Drop",
        summary: `${s.phase === "single" ? "1Ø" : "3Ø"} ${s.material.toUpperCase()} ${sizeLabel(
          s.size,
        )} · ${num(s.current)} A · ${num(s.length)} ft · ${num(s.voltage)} V`,
        result: `${r.percentDrop.toFixed(2)}% drop (${r.voltageDrop.toFixed(2)} V)`,
        state: s,
      }}
      result={
        <ResultCard
          primary={`${r.percentDrop.toFixed(2)}%`}
          primaryLabel="Voltage drop"
          stats={[
            { label: "Drop", value: `${r.voltageDrop.toFixed(2)} V` },
            { label: "At load", value: `${r.voltageAtLoad.toFixed(1)} V` },
          ]}
          pass={r.withinBranchLimit}
          passText="≤ 3%"
          failText="> 3%"
        />
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
            onChange={(v) => set("current", v)}
          />
          <NumberField
            label="One-way length"
            unit="ft"
            value={s.length}
            onChange={(v) => set("length", v)}
          />
          <NumberField
            label="Voltage"
            unit="V"
            value={s.voltage}
            onChange={(v) => set("voltage", v)}
          />
          <NumberField
            label="Parallel sets"
            value={s.sets}
            min={1}
            onChange={(v) => set("sets", v)}
          />
        </div>
      </FieldGroup>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
        <span className="text-slate-400">Smallest size within 3%: </span>
        {recommended ? (
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
