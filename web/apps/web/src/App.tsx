import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { PlanActionsProvider } from "./context/PlanActionsContext";
import { JobProvider } from "./context/JobContext";
import { ProfileProvider } from "./context/ProfileContext";
import { PlanWorkspaceProvider } from "./context/PlanWorkspaceContext";
import { ImportRulesSaveProvider } from "./context/ImportRulesSaveContext";
import { KitManifestSaveProvider } from "./context/KitManifestSaveContext";
import { SaveStatusProvider } from "./context/SaveStatusContext";
import { AuthProvider } from "./context/AuthContext";
import AuthGate from "./components/AuthGate";
import AppLayout from "./layout/AppLayout";
import BuildPage from "./pages/BuildPage";
import BuildsPage from "./pages/BuildsPage";
import HelpPage from "./pages/HelpPage";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ReviewPage from "./pages/ReviewPage";
import CheckoffPage from "./pages/CheckoffPage";
import SettingsPage from "./pages/SettingsPage";
import SourcesPage from "./pages/SourcesPage";
import WelcomePage from "./pages/WelcomePage";
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

function IndexRedirect() {
  return <WelcomePage />;
}

export default function App() {
  return (
    <AuthProvider>
      <JobProvider>
        <ProfileProvider>
          <PlanActionsProvider>
            <PlanWorkspaceProvider>
              <SaveStatusProvider>
                <ImportRulesSaveProvider>
                  <KitManifestSaveProvider>
                    <Routes>
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                      <Route path="/reset-password" element={<ResetPasswordPage />} />
                      <Route element={<AuthGate />}>
                        <Route element={<AppLayout />}>
                          <Route index element={<IndexRedirect />} />
                          <Route path="sources" element={<SourcesPage />} />
                          <Route path="builds" element={<BuildsPage />} />
                          <Route path="build" element={<BuildPage />} />
                          <Route path="plan" element={<Navigate to="/build" replace />} />
                          <Route path="review" element={<ReviewPage />} />
                          <Route path="plans/:planId/studio" element={<LegacyStudioRedirect />} />
                          <Route path="plate" element={<PlateRedirect />} />
                          <Route path="print" element={<PlateRedirect />} />
                          <Route path="checkoff" element={<CheckoffPage />} />
                          <Route path="settings" element={<SettingsPage />} />
                          <Route path="help" element={<HelpPage />} />
                        </Route>
                      </Route>
                    </Routes>
                  </KitManifestSaveProvider>
                </ImportRulesSaveProvider>
              </SaveStatusProvider>
            </PlanWorkspaceProvider>
          </PlanActionsProvider>
        </ProfileProvider>
      </JobProvider>
    </AuthProvider>
  );
}
