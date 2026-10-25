import { lazy, Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import { CloudSyncManager } from "./components/CloudSyncManager";
import { RouteMetadata } from "./components/RouteMetadata";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { RequireAuth } from "./components/RequireAuth";
import { Analytics } from "@vercel/analytics/react";
import { useAuth } from "./lib/auth";

const About = lazy(() => import("./pages/About"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const JobReport = lazy(() => import("./pages/JobReport"));
const Account = lazy(() => import("./pages/Account"));
const Upgrade = lazy(() => import("./pages/Upgrade"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const VoltageDropPage = lazy(
  () => import("./calculators/voltage-drop/VoltageDropPage"),
);
const ConduitFillPage = lazy(
  () => import("./calculators/conduit-fill/ConduitFillPage"),
);
const AmpacityPage = lazy(
  () => import("./calculators/ampacity/AmpacityPage"),
);
const BoxFillPage = lazy(
  () => import("./calculators/box-fill/BoxFillPage"),
);
const ConduitBendingPage = lazy(
  () => import("./calculators/conduit-bending/ConduitBendingPage"),
);

/**
 * Render-throw probe. Vite replaces `import.meta.env.VITE_E2E` at build time, so
 * this route and the component below are dead code in a production build; the
 * Playwright webServer sets VITE_E2E=1 to prove the error boundary works.
 */
const E2E_PROBE = import.meta.env.VITE_E2E === "1";

function ErrorProbe(): never {
  throw new Error(
    "E2E render probe: intentional failure to exercise the route error boundary",
  );
}

function LoadingScreen() {
  return (
    <main
      className="mx-auto max-w-2xl px-4 py-12 text-center text-slate-400"
      role="status"
    >
      Opening Codewire...
    </main>
  );
}

export default function App() {
  const { loading: authLoading } = useAuth();
  // Keying the boundary by pathname clears a caught error as soon as the user
  // navigates, so one broken page cannot trap the rest of the app.
  const { pathname } = useLocation();

  return (
    <>
      <Analytics />
      <RouteMetadata />
      <CloudSyncManager />
      {authLoading ? (
        <LoadingScreen />
      ) : (
        <Suspense fallback={<LoadingScreen />}>
          {/* One main landmark wraps every routed page so a screen reader can
              jump straight to the page content; without it the document had no
              main landmark at all (axe landmark-one-main). */}
          <main>
            <RouteErrorBoundary resetKey={pathname}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about" element={<About />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/jobs/:id" element={<JobDetail />} />
                <Route path="/jobs/:id/report" element={<JobReport />} />
                <Route path="/login" element={<Account />} />
                <Route
                  path="/account"
                  element={
                    <RequireAuth>
                      <Account />
                    </RequireAuth>
                  }
                />
                <Route path="/upgrade" element={<Upgrade />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route
                  path="/voltage-drop-guide"
                  element={<GuidePage slug="voltage-drop" />}
                />
                <Route
                  path="/conduit-fill-guide"
                  element={<GuidePage slug="conduit-fill" />}
                />
                <Route
                  path="/codewire-vs-uglys"
                  element={<GuidePage slug="vs-uglys" />}
                />
                <Route
                  path="/wire-size-chart"
                  element={<GuidePage slug="wire-size" />}
                />
                <Route
                  path="/box-fill-guide"
                  element={<GuidePage slug="box-fill" />}
                />
                <Route
                  path="/conduit-bending-guide"
                  element={<GuidePage slug="bending" />}
                />
                <Route path="/voltage-drop" element={<VoltageDropPage />} />
                <Route path="/conduit-fill" element={<ConduitFillPage />} />
                <Route path="/ampacity" element={<AmpacityPage />} />
                <Route path="/box-fill" element={<BoxFillPage />} />
                <Route path="/conduit-bending" element={<ConduitBendingPage />} />
                {E2E_PROBE && (
                  <Route path="/__error-probe" element={<ErrorProbe />} />
                )}
                <Route path="*" element={<Home />} />
              </Routes>
            </RouteErrorBoundary>
          </main>
        </Suspense>
      )}
    </>
  );
}
