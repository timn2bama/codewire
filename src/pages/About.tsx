import { Link } from "react-router-dom";
import { ChevronLeft, Keyboard, CheckCircle2, WifiOff } from "lucide-react";
import { CALCULATORS } from "../calculators/registry";

const STEPS = [
  {
    icon: Keyboard,
    title: "You enter the numbers",
    body: "Type in values you already have — wire size (printed on the wire), amps (the breaker), run length (a tape measure), box size. No camera or sensors; it doesn't measure for you.",
  },
  {
    icon: CheckCircle2,
    title: "It does the code math",
    body: "Each tool runs the National Electrical Code (NEC) formula and tables, then shows a clear pass / fail plus the exact answer — instantly, as you type.",
  },
  {
    icon: WifiOff,
    title: "Works anywhere",
    body: "Everything runs on the device and offline, so it still works in a basement or on a site with no signal.",
  },
];

const WHAT: Record<string, string> = {
  "voltage-drop":
    "Long wire runs lose a little power (like pressure in a long hose). Tells you the % lost and whether you need a bigger wire.",
  "conduit-fill":
    "“Will these wires fit inside this pipe?” Code limits how full a pipe can be so wires can shed heat. Says fits or too small.",
  ampacity:
    "“How many amps can this wire safely carry?”, adjusted for heat and how many wires are bundled together.",
  "box-fill":
    "Code says how much can go in a junction box of a given size. Counts your wires and devices, says fits or not.",
  "conduit-bending":
    "Pure geometry: where to mark a pipe so a bend clears an obstacle — replaces trig done by hand.",
};

export default function About() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-4 flex items-center gap-2">
        <Link
          to="/"
          className="rounded-lg p-2 text-slate-400 active:bg-slate-800"
          aria-label="Back to calculators"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">What is Codewire?</h1>
      </header>

      <p className="text-slate-300">
        Codewire is a set of <strong>five calculators</strong> for electricians.
        It replaces a paper code book and several separate apps, giving instant,
        code-compliant answers on the job. It's a calculator — not a measuring
        tool.
      </p>

      <h2 className="mb-3 mt-7 text-sm font-semibold uppercase tracking-wide text-slate-500">
        How to use it
      </h2>
      <div className="space-y-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={i}
              className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
                <Icon size={22} />
              </span>
              <div>
                <h3 className="font-semibold">
                  {i + 1}. {s.title}
                </h3>
                <p className="text-sm text-slate-400">{s.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 mt-7 text-sm font-semibold uppercase tracking-wide text-slate-500">
        The five calculators
      </h2>
      <div className="space-y-2">
        {CALCULATORS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.id}
              to={c.path}
              className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 active:bg-slate-800"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                <Icon size={20} />
              </span>
              <div>
                <h3 className="font-semibold leading-tight">{c.title}</h3>
                <p className="text-sm text-slate-400">{WHAT[c.id]}</p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-7 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200/90">
        <strong>Important:</strong> Codewire is a field aid, not a substitute for
        the printed code book, your training, or a licensed inspection. Always
        verify against the NEC edition adopted by your local authority (AHJ).
      </div>

      <div className="mt-7 rounded-xl border border-slate-800 bg-slate-900 p-4 text-center text-sm text-slate-300">
        Found a bug, a wrong number, or want a feature? Email{" "}
        <a
          href="mailto:codewire.tools@gmail.com?subject=Codewire%20feedback"
          className="font-semibold text-brand"
        >
          codewire.tools@gmail.com
        </a>{" "}
        — feedback from electricians shapes what's next.
      </div>

      <div className="mt-6 text-center">
        <Link
          to="/"
          className="inline-block rounded-xl bg-brand px-6 py-3 font-semibold text-white active:bg-brand-dark"
        >
          Open the calculators
        </Link>
      </div>
    </div>
  );
}
