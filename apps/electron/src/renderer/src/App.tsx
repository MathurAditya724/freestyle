import AppPage from "@renderer/pages/app";
import NotFoundPage from "@renderer/pages/not-found";
import FeedbackPage from "@renderer/pages/settings/feedback";
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
      <Route path="/settings" element={<SettingsLayout />}>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<GeneralSettingsPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
