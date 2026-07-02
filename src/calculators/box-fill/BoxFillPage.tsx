import { Plus, Trash2 } from "lucide-react";
import { CalculatorShell } from "../../components/CalculatorShell";
import { ResultCard } from "../../components/ResultCard";
import { NumberField, SelectField } from "../../components/fields";
import { usePersistentState } from "../../lib/usePersistentState";
import { useLoadSavedState } from "../../lib/useLoadSavedState";
import { sizeLabel } from "../../lib/nec/types";
import type { WireSize } from "../../lib/nec/types";
import { BOX_FILL_SIZES, COMMON_BOXES } from "../../lib/nec/2023/boxFill";
import { calcBoxFill } from "../../lib/calc/boxFill";

interface Row {
  size: WireSize;
  quantity: number;
}
interface State {
  boxVolume: number | "";
  conductors: Row[];
  devices: number | "";
  hasClamps: boolean;
  groundSize: WireSize | "none";
}

const DEFAULT: State = {
  boxVolume: 18,
  conductors: [{ size: "12", quantity: 3 }],
  devices: 1,
  hasClamps: true,
  groundSize: "12",
};

const sizeOptions = BOX_FILL_SIZES.map((s) => ({ value: s, label: sizeLabel(s) }));
const groundOptions = [
  { value: "none", label: "No EGC" },
  ...BOX_FILL_SIZES.map((s) => ({ value: s, label: sizeLabel(s) })),
];

export default function BoxFillPage() {
  const [s, setS] = usePersistentState<State>("cw:box-fill", DEFAULT);
  useLoadSavedState<State>(setS);
  const num = (v: number | "") => (v === "" ? 0 : v);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setS((p) => ({
      ...p,
      conductors: p.conductors.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    }));
  const addRow = () =>
    setS((p) => ({
      ...p,
      conductors: [...p.conductors, { size: "12", quantity: 1 }],
    }));
  const removeRow = (i: number) =>
    setS((p) => ({
      ...p,
      conductors: p.conductors.filter((_, idx) => idx !== i),
    }));

  const r = calcBoxFill({
    boxVolume: num(s.boxVolume),
    conductors: s.conductors.map((c) => ({
      size: c.size,
      quantity: num(c.quantity),
    })),
    devices: num(s.devices),
    hasClamps: s.hasClamps,
    groundSize: s.groundSize === "none" ? undefined : s.groundSize,
  });

  return (
    <CalculatorShell
      title="Box Fill"
      subtitle="NEC 314.16"
      saveData={{
        calculatorId: "box-fill",
        path: "/box-fill",
        defaultTitle: "Box Fill",
        summary: `${num(s.boxVolume)} in³ box · ${s.conductors.reduce(
          (n, c) => n + num(c.quantity),
          0,
        )} conductors · ${num(s.devices)} device(s)`,
        result: `${r.requiredVolume.toFixed(2)} in³ required — ${r.pass ? "fits" : "too small"}`,
        state: s,
      }}
      result={
        <ResultCard
          primary={`${r.requiredVolume.toFixed(2)} in³`}
          primaryLabel={`Required (box ${num(s.boxVolume)} in³)`}
          stats={[
            { label: "Remaining", value: `${r.remaining.toFixed(2)} in³` },
            { label: "Fill", value: `${r.fillPercent.toFixed(0)}%` },
          ]}
          pass={r.pass}
          passText="Fits"
          failText="Too small"
        />
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Box volume"
          unit="in³"
          step={0.5}
          value={s.boxVolume}
          onChange={(v) => setS((p) => ({ ...p, boxVolume: v }))}
        />
        <SelectField
          label="Pick a box"
          value=""
          options={[
            { value: "", label: "Common boxes…" },
            ...COMMON_BOXES.map((b) => ({
              value: b.label,
              label: `${b.label} — ${b.volume} in³`,
            })),
          ]}
          onChange={(v) => {
            const box = COMMON_BOXES.find((b) => b.label === v);
            if (box) setS((p) => ({ ...p, boxVolume: box.volume }));
          }}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="field-label mb-0">Conductors</span>
          <button
            onClick={addRow}
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-sm font-medium text-slate-200 active:bg-slate-700"
          >
            <Plus size={16} /> Add
          </button>
        </div>
        <div className="space-y-2">
          {s.conductors.map((c, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto_auto] items-end gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2"
            >
              <SelectField
                label="Size"
                value={c.size}
                options={sizeOptions}
                onChange={(v) => updateRow(i, { size: v })}
              />
              <div className="w-20">
                <NumberField
                  label="Qty"
                  min={1}
                  value={c.quantity}
                  onChange={(v) => updateRow(i, { quantity: v === "" ? 0 : v })}
                />
              </div>
              <button
                onClick={() => removeRow(i)}
                className="mb-1 rounded-lg p-2.5 text-slate-500 active:bg-slate-800"
                aria-label="Remove conductor"
                disabled={s.conductors.length === 1}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="Devices (yokes)"
          value={s.devices}
          min={0}
          onChange={(v) => setS((p) => ({ ...p, devices: v }))}
        />
        <SelectField
          label="Largest EGC"
          value={s.groundSize}
          options={groundOptions}
          onChange={(v) =>
            setS((p) => ({ ...p, groundSize: v as WireSize | "none" }))
          }
        />
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
        <input
          type="checkbox"
          className="h-5 w-5 accent-brand"
          checked={s.hasClamps}
          onChange={(e) => setS((p) => ({ ...p, hasClamps: e.target.checked }))}
        />
        <span className="text-sm">Internal cable clamps present</span>
      </label>
    </CalculatorShell>
  );
}
