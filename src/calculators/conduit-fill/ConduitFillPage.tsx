import { Plus, Trash2 } from "lucide-react";
import { CalculatorShell } from "../../components/CalculatorShell";
import { ResultCard } from "../../components/ResultCard";
import { NumberField, SelectField } from "../../components/fields";
import { usePersistentState } from "../../lib/usePersistentState";
import { useLoadSavedState } from "../../lib/useLoadSavedState";
import { sizeLabel } from "../../lib/nec/types";
import type { WireSize } from "../../lib/nec/types";
import {
  CONDUIT_TYPE_LABEL,
  tradeSizesFor,
  type ConduitType,
} from "../../lib/nec/2023/conduitAreas";
import {
  INSULATION_LABEL,
  insulationSizes,
  type Insulation,
} from "../../lib/nec/2023/insulationAreas";
import {
  calcConduitFill,
  recommendConduitSize,
  type ConductorEntry,
} from "../../lib/calc/conduitFill";

interface State {
  type: ConduitType;
  tradeSize: string;
  conductors: ConductorEntry[];
}

const DEFAULT: State = {
  type: "EMT",
  tradeSize: '1/2"',
  conductors: [{ insulation: "THHN", size: "12", quantity: 3 }],
};

const typeOptions = (Object.keys(CONDUIT_TYPE_LABEL) as ConduitType[]).map(
  (t) => ({ value: t, label: CONDUIT_TYPE_LABEL[t] }),
);
const insulationOptions = (Object.keys(INSULATION_LABEL) as Insulation[]).map(
  (i) => ({ value: i, label: INSULATION_LABEL[i] }),
);

export default function ConduitFillPage() {
  const [s, setS] = usePersistentState<State>("cw:conduit-fill", DEFAULT);
  useLoadSavedState<State>(setS);

  const tradeOptions = tradeSizesFor(s.type).map((t) => ({
    value: t,
    label: t,
  }));

  const setType = (type: ConduitType) => {
    const sizes = tradeSizesFor(type);
    setS((p) => ({
      ...p,
      type,
      tradeSize: sizes.includes(p.tradeSize) ? p.tradeSize : sizes[0],
    }));
  };

  const updateConductor = (i: number, patch: Partial<ConductorEntry>) =>
    setS((p) => ({
      ...p,
      conductors: p.conductors.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    }));

  const addConductor = () =>
    setS((p) => ({
      ...p,
      conductors: [
        ...p.conductors,
        { insulation: "THHN", size: "12", quantity: 1 },
      ],
    }));

  const removeConductor = (i: number) =>
    setS((p) => ({
      ...p,
      conductors: p.conductors.filter((_, idx) => idx !== i),
    }));

  const r = calcConduitFill(s);
  const recommended = recommendConduitSize(s.type, s.conductors);

  return (
    <CalculatorShell
      title="Conduit Fill"
      subtitle="Chapter 9 · 1w 53% / 2w 31% / 3+ 40%"
      saveData={{
        calculatorId: "conduit-fill",
        path: "/conduit-fill",
        defaultTitle: "Conduit Fill",
        summary: `${CONDUIT_TYPE_LABEL[s.type]} ${s.tradeSize} · ${r.conductorCount} conductors`,
        result: `${r.fillPercent.toFixed(1)}% fill — ${r.pass ? "within code" : "over fill"}`,
        state: s,
      }}
      result={
        <ResultCard
          primary={`${r.fillPercent.toFixed(1)}%`}
          primaryLabel={`Fill (${(r.allowablePercent * 100).toFixed(0)}% allowed)`}
          stats={[
            { label: "Wires", value: `${r.usedArea.toFixed(3)} in²` },
            { label: "Max", value: `${r.allowableArea.toFixed(3)} in²` },
          ]}
          pass={r.pass}
        />
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="Conduit type"
          value={s.type}
          options={typeOptions}
          onChange={setType}
        />
        <SelectField
          label="Trade size"
          value={s.tradeSize}
          options={tradeOptions}
          onChange={(v) => setS((p) => ({ ...p, tradeSize: v }))}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="field-label mb-0">Conductors</span>
          <button
            onClick={addConductor}
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-sm font-medium text-slate-200 active:bg-slate-700"
          >
            <Plus size={16} /> Add
          </button>
        </div>

        <div className="space-y-2">
          {s.conductors.map((c, i) => {
            const sizes = insulationSizes(c.insulation);
            return (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2"
              >
                <SelectField
                  label="Type"
                  value={c.insulation}
                  options={insulationOptions}
                  onChange={(v) => {
                    const ns = insulationSizes(v);
                    updateConductor(i, {
                      insulation: v,
                      size: ns.includes(c.size) ? c.size : ns[0],
                    });
                  }}
                />
                <SelectField
                  label="Size"
                  value={c.size}
                  options={sizes.map((sz) => ({
                    value: sz,
                    label: sizeLabel(sz as WireSize),
                  }))}
                  onChange={(v) => updateConductor(i, { size: v as WireSize })}
                />
                <div className="w-20">
                  <NumberField
                    label="Qty"
                    min={1}
                    value={c.quantity}
                    onChange={(v) =>
                      updateConductor(i, { quantity: v === "" ? 0 : v })
                    }
                  />
                </div>
                <button
                  onClick={() => removeConductor(i)}
                  className="mb-1 rounded-lg p-2.5 text-slate-500 active:bg-slate-800"
                  aria-label="Remove conductor"
                  disabled={s.conductors.length === 1}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
        <span className="text-slate-400">
          Smallest {CONDUIT_TYPE_LABEL[s.type]} that fits:{" "}
        </span>
        {recommended ? (
          <button
            className="font-semibold text-brand underline-offset-2 hover:underline"
            onClick={() => setS((p) => ({ ...p, tradeSize: recommended }))}
          >
            {recommended} →
          </button>
        ) : (
          <span className="text-red-400">none listed</span>
        )}
      </div>
    </CalculatorShell>
  );
}
