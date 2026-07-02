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

export default function Terms() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link to="/" className="rounded-lg p-2 text-slate-400 active:bg-slate-800" aria-label="Back">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">Terms of Service</h1>
      </header>

      <div className="space-y-3 text-sm leading-relaxed text-slate-300">
        <p className="text-xs text-amber-300">
          DRAFT — have an attorney review before scaling paid sign-ups. Last
          updated 2026-06-16.
        </p>

        <p>
          These Terms of Service ("Terms") govern your use of Codewire (the
          "Service"), provided by the operator of codewire.tools ("we," "us").
          By creating an account or using the Service you agree to these Terms.
          If you do not agree, do not use the Service. You must be at least 18.
        </p>

        <Section title="The service">
          <p>
            Codewire provides electrical calculators based on the National
            Electrical Code (NEC) and tools to save calculations to jobs. The
            free tier includes the calculators and limited on-device storage;
            paid "Pro" plans add cloud sync, additional storage, and report
            export.
          </p>
        </Section>

        <Section title="Not professional advice; no warranty">
          <p>
            Codewire is a field aid only. It is <strong>not</strong> a substitute
            for the printed code book, your professional training, engineering
            judgment, or a licensed inspection. You are solely responsible for
            verifying every result against the NEC edition adopted by your local
            authority having jurisdiction (AHJ) and for all work you perform.
          </p>
          <p>
            The Service is provided <strong>"as is" and "as available," without
            warranties of any kind</strong>, express or implied, including
            merchantability, fitness for a particular purpose, accuracy, and
            non-infringement. We do not warrant that results are error-free or
            that the Service will be uninterrupted.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, we will not be liable for any
            indirect, incidental, special, consequential, or punitive damages, or
            for any code violations, failed inspections, rework, property damage,
            injury, or loss arising from your use of or reliance on the Service.
            Our total liability for any claim will not exceed the amount you paid
            us in the 12 months before the claim (or USD $50 if you paid nothing).
          </p>
        </Section>

        <Section title="Subscriptions, billing, and cancellation">
          <p>
            Pro plans are billed monthly or annually through Stripe at the prices
            shown at checkout. Paid plans, including any free trial,{" "}
            <strong>automatically renew</strong> at the end of each period unless
            you cancel before it ends. A free trial converts to a paid
            subscription unless cancelled before the trial ends.
          </p>
          <p>
            You can cancel anytime from the billing portal in your account;
            access continues until the end of the current paid period. Except
            where required by law, payments are non-refundable and partial
            periods are not prorated. We may change prices on a prospective basis
            with notice.
          </p>
        </Section>

        <Section title="Accounts and acceptable use">
          <p>
            You are responsible for your account and credentials and for activity
            under your account. Do not misuse the Service, attempt to breach its
            security, resell it, or use it unlawfully.
          </p>
        </Section>

        <Section title="Intellectual property">
          <p>
            We retain all rights in the Service and its software. NEC and related
            materials are the property of their respective owners (see our
            handling of code data). You retain ownership of the job data you
            enter.
          </p>
        </Section>

        <Section title="Data">
          <p>
            Free data is stored on your device; Pro data also syncs to our cloud
            provider. See the{" "}
            <Link to="/privacy" className="text-brand">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

        <Section title="Changes; termination">
          <p>
            We may update these Terms; continued use after changes constitutes
            acceptance. We may suspend or terminate accounts that violate these
            Terms.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These Terms are governed by the laws of the State of [STATE], USA,
            without regard to conflict-of-laws rules. (Set your state/venue
            before launch.)
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions:{" "}
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
