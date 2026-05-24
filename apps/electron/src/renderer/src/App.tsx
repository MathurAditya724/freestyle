import AppPage from "@renderer/pages/app";
import NotFoundPage from "@renderer/pages/not-found";
import OnboardingPage from "@renderer/pages/onboarding";
import DictionaryPage from "@renderer/pages/settings/dictionary";
import FeedbackPage from "@renderer/pages/settings/feedback";
import FormatsPage from "@renderer/pages/settings/formats";
import GeneralSettingsPage from "@renderer/pages/settings/general";
import HistoryPage from "@renderer/pages/settings/history";
import SettingsLayout from "@renderer/pages/settings/layout";
import ModelsPage from "@renderer/pages/settings/models";
import { Navigate, Route, Routes } from "react-router";

export default function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<AppPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/settings" element={<SettingsLayout />}>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<GeneralSettingsPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="dictionary" element={<DictionaryPage />} />
        <Route path="formats" element={<FormatsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
