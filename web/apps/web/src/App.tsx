import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { JobProvider } from "./context/JobContext";
import { ProfileProvider } from "./context/ProfileContext";
import { PlanWorkspaceProvider } from "./context/PlanWorkspaceContext";
import { ImportRulesSaveProvider } from "./context/ImportRulesSaveContext";
import { KitManifestSaveProvider } from "./context/KitManifestSaveContext";
import AppLayout from "./layout/AppLayout";
import BuildPage from "./pages/BuildPage";
import HelpPage from "./pages/HelpPage";
import ReviewPage from "./pages/ReviewPage";
import SettingsPage from "./pages/SettingsPage";
import SourcesPage from "./pages/SourcesPage";
import { buildRoute } from "./lib/routes";

function LegacyStudioRedirect() {
  const { planId } = useParams();
  const id = Number(planId);
  return (
    <Navigate to={buildRoute(Number.isFinite(id) && id > 0 ? id : null)} replace />
  );
}

function PlateRedirect() {
  const location = useLocation();
  return <Navigate to={`/review${location.search}`} replace />;
}

function CheckoffRedirect() {
  const location = useLocation();
  return <Navigate to={`/review${location.search}`} replace />;
}

function BuildsRedirect() {
  const location = useLocation();
  return <Navigate to={`/build${location.search}`} replace />;
}

export default function App() {
  return (
    <JobProvider>
      <ProfileProvider>
        <PlanWorkspaceProvider>
        <ImportRulesSaveProvider>
          <KitManifestSaveProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/sources" replace />} />
                <Route path="sources" element={<SourcesPage />} />
                <Route path="builds" element={<BuildsRedirect />} />
                <Route path="build" element={<BuildPage />} />
                <Route path="plan" element={<Navigate to="/build" replace />} />
                <Route path="review" element={<ReviewPage />} />
                <Route path="plans/:planId/studio" element={<LegacyStudioRedirect />} />
                <Route path="plate" element={<PlateRedirect />} />
                <Route path="print" element={<PlateRedirect />} />
                <Route path="checkoff" element={<CheckoffRedirect />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="help" element={<HelpPage />} />
              </Route>
            </Routes>
          </KitManifestSaveProvider>
        </ImportRulesSaveProvider>
        </PlanWorkspaceProvider>
      </ProfileProvider>
    </JobProvider>
  );
}
