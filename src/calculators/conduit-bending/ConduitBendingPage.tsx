import { CalculatorShell } from "../../components/CalculatorShell";
import { ResultCard } from "../../components/ResultCard";
import { NumberField, SelectField, Segmented } from "../../components/fields";
import { usePersistentState } from "../../lib/usePersistentState";
import { useLoadSavedState } from "../../lib/useLoadSavedState";
import {
  calcFourPointSaddle,
  calcOffset,
  calcStub90,
  calcThreePointSaddle,
  OFFSET_ANGLES,
  TAKE_UP,
} from "../../lib/calc/conduitBending";

type Mode = "offset" | "saddle3" | "saddle4" | "stub";

interface State {
  mode: Mode;
  offsetHeight: number | "";
  angle: number;
  saddleDepth: number | "";
  saddle4Depth: number | "";
  saddle4Angle: number;
  stubHeight: number | "";
  takeUpSize: string;
}

const DEFAULT: State = {
  mode: "offset",
  offsetHeight: 6,
  angle: 30,
  saddleDepth: 4,
  saddle4Depth: 3,
  saddle4Angle: 22.5,
  stubHeight: 12,
  takeUpSize: '1/2"',
};

const angleOptions = OFFSET_ANGLES.map((a) => ({
  value: String(a),
  label: `${a}°`,
}));
const takeUpOptions = Object.keys(TAKE_UP).map((k) => ({
  value: k,
  label: `${k} (${TAKE_UP[k]}")`,
}));

const inch = (n: number) => `${n.toFixed(2)}"`;

export default function ConduitBendingPage() {
  const [s, setS] = usePersistentState<State>("cw:bending", DEFAULT);
  useLoadSavedState<State>(setS);
  const set = <K extends keyof State>(k: K, v: State[K]) =>
    setS((p) => ({ ...p, [k]: v }));
  const num = (v: number | "") => (v === "" ? 0 : v);

  let result;
  let inputs;
  let saveSummary: string;
  let saveResult: string;

  if (s.mode === "offset") {
    const r = calcOffset(num(s.offsetHeight), s.angle);
    saveSummary = `Offset · ${inch(num(s.offsetHeight))} @ ${s.angle}°`;
    saveResult = `${inch(r.distanceBetweenMarks)} between marks · ${inch(r.shrink)} shrink`;
    result = (
      <ResultCard
        primary={inch(r.distanceBetweenMarks)}
        primaryLabel="Distance between marks"
        stats={[
          { label: "Shrink", value: inch(r.shrink) },
          { label: "×", value: r.multiplier.toFixed(2) },
        ]}
      />
    );
    inputs = (
      <>
        <NumberField
          label="Offset height"
          unit="in"
          step={0.25}
          value={s.offsetHeight}
          onChange={(v) => set("offsetHeight", v)}
        />
        <SelectField
          label="Bend angle"
          value={String(s.angle)}
          options={angleOptions}
          onChange={(v) => set("angle", Number(v))}
        />
      </>
    );
  } else if (s.mode === "saddle3") {
    const r = calcThreePointSaddle(num(s.saddleDepth));
    saveSummary = `3-pt saddle · ${inch(num(s.saddleDepth))} deep`;
    saveResult = `${inch(r.outerMarkDistance)} to outer marks · ${inch(r.shrink)} shrink`;
    result = (
      <ResultCard
        primary={inch(r.outerMarkDistance)}
        primaryLabel="Center → each outer mark"
        stats={[{ label: "Shrink", value: inch(r.shrink) }]}
      />
    );
    inputs = (
      <>
        <NumberField
          label="Obstruction depth"
          unit="in"
          step={0.25}
          value={s.saddleDepth}
          onChange={(v) => set("saddleDepth", v)}
        />
        <p className="text-sm text-slate-500">
          45° center bend, two 22.5° outer bends.
        </p>
      </>
    );
  } else if (s.mode === "saddle4") {
    const r = calcFourPointSaddle(num(s.saddle4Depth), s.saddle4Angle);
    saveSummary = `4-pt saddle · ${inch(num(s.saddle4Depth))} @ ${s.saddle4Angle}°`;
    saveResult = `${inch(r.riseDistance)} outer→inner · ${inch(r.shrink)} shrink`;
    result = (
      <ResultCard
        primary={inch(r.riseDistance)}
        primaryLabel="Each outer → inner mark"
        stats={[
          { label: "Total shrink", value: inch(r.shrink) },
          { label: "×", value: r.multiplier.toFixed(2) },
        ]}
      />
    );
    inputs = (
      <>
        <NumberField
          label="Obstruction depth"
          unit="in"
          step={0.25}
          value={s.saddle4Depth}
          onChange={(v) => set("saddle4Depth", v)}
        />
        <SelectField
          label="Bend angle"
          value={String(s.saddle4Angle)}
          options={angleOptions}
          onChange={(v) => set("saddle4Angle", Number(v))}
        />
      </>
    );
  } else {
    const takeUp = TAKE_UP[s.takeUpSize];
    const mark = calcStub90(num(s.stubHeight), takeUp);
    saveSummary = `90° stub · ${inch(num(s.stubHeight))} on ${s.takeUpSize}`;
    saveResult = `Mark at ${inch(mark)} (take-up ${inch(takeUp)})`;
    result = (
      <ResultCard
        primary={inch(mark)}
        primaryLabel="Mark from end of conduit"
        stats={[{ label: "Take-up", value: inch(takeUp) }]}
      />
    );
    inputs = (
      <>
        <NumberField
          label="Desired stub height"
          unit="in"
          step={0.25}
          value={s.stubHeight}
          onChange={(v) => set("stubHeight", v)}
        />
        <SelectField
          label="Conduit size (take-up)"
          value={s.takeUpSize}
          options={takeUpOptions}
          onChange={(v) => set("takeUpSize", v)}
        />
      </>
    );
  }

  return (
    <CalculatorShell
      title="Conduit Bending"
      subtitle="Offsets, saddles & stubs"
      result={result}
      saveData={{
        calculatorId: "conduit-bending",
        path: "/conduit-bending",
        defaultTitle: "Conduit Bend",
        summary: saveSummary,
        result: saveResult,
        state: s,
      }}
    >
      <Segmented
        value={s.mode}
        onChange={(v) => set("mode", v)}
        options={[
          { value: "offset", label: "Offset" },
          { value: "saddle3", label: "3-pt" },
          { value: "saddle4", label: "4-pt" },
          { value: "stub", label: "90°" },
        ]}
      />
      <div className="grid grid-cols-1 gap-4">{inputs}</div>
    </CalculatorShell>
  );
}
