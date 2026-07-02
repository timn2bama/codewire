import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="pt-3 font-semibold text-slate-100">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link to="/" className="rounded-lg p-2 text-slate-400 active:bg-slate-800" aria-label="Back">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">Privacy Policy</h1>
      </header>

      <div className="space-y-3 text-sm leading-relaxed text-slate-300">
        <p className="text-xs text-amber-300">
          DRAFT — have an attorney review before scaling paid sign-ups. Last
          updated 2026-06-16.
        </p>

        <p>
          Codewire is built to keep your data minimal and on your device by
          default. This policy explains what we collect and why.
        </p>

        <Section title="What we collect">
          <p>
            <strong>Without an account:</strong> your calculator inputs and saved
            jobs are stored only in your browser's local storage on your device.
            We do not receive or store them.
          </p>
          <p>
            <strong>With an account (Pro):</strong> we store your email address
            (for sign-in, via Supabase) and, when you save jobs, the job and
            calculation data you choose to sync, so it is backed up and available
            across your devices. Payments are processed by Stripe; we receive
            subscription status and a customer identifier but{" "}
            <strong>never see your full card number</strong>.
          </p>
          <p>
            We may collect basic technical/log data (e.g., error logs) needed to
            operate and secure the Service.
          </p>
        </Section>

        <Section title="How we use it">
          <p>
            To provide sign-in, sync your jobs, process subscriptions, operate
            and secure the Service, and respond to support. We do{" "}
            <strong>not sell your personal data</strong> and do not use it for
            third-party advertising.
          </p>
        </Section>

        <Section title="Service providers (processors)">
          <p>
            We use <strong>Supabase</strong> (authentication and database),{" "}
            <strong>Stripe</strong> (payments), and <strong>Vercel</strong>{" "}
            (hosting). Each processes data only to provide its part of the
            Service and under its own terms.
          </p>
        </Section>

        <Section title="Retention and your choices">
          <p>
            You can delete jobs anytime in the app. You can request deletion of
            your account and associated cloud data by emailing us; we will delete
            it within a reasonable period except where retention is legally
            required. Local (on-device) data is removed when you clear it or
            uninstall.
          </p>
        </Section>

        <Section title="Children">
          <p>
            The Service is intended for working electricians and apprentices and
            is not directed to children under 13. We do not knowingly collect
            data from children under 13.
          </p>
        </Section>

        <Section title="Changes; contact">
          <p>
            We may update this policy; material changes will be reflected by the
            date above. Questions or data requests:{" "}
            <a href="mailto:codewire.tools@gmail.com" className="text-brand">
              codewire.tools@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
