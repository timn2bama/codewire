import { Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import JobReport from "./pages/JobReport";
import Account from "./pages/Account";
import Upgrade from "./pages/Upgrade";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import GuidePage from "./pages/GuidePage";
import VoltageDropPage from "./calculators/voltage-drop/VoltageDropPage";
import ConduitFillPage from "./calculators/conduit-fill/ConduitFillPage";
import AmpacityPage from "./calculators/ampacity/AmpacityPage";
import BoxFillPage from "./calculators/box-fill/BoxFillPage";
import ConduitBendingPage from "./calculators/conduit-bending/ConduitBendingPage";
import { CloudSyncManager } from "./components/CloudSyncManager";
import { RequireAuth } from "./components/RequireAuth";
import { Analytics } from "@vercel/analytics/react";
import { useAuth } from "./lib/auth";

export default function App() {
  const { loading: authLoading } = useAuth();

  return (
    <>
      <Analytics />
      <CloudSyncManager />
      {authLoading ? (
        <main
          className="mx-auto max-w-2xl px-4 py-12 text-center text-slate-400"
          role="status"
        >
          Opening your device data...
        </main>
      ) : (
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
          <Route path="*" element={<Home />} />
        </Routes>
      )}
    </>
  );
}
