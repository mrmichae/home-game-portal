import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { DetailPage } from "./pages/DetailPage";
import { HomePage } from "./pages/HomePage";
import { PlayerPage } from "./pages/PlayerPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { MetadataAdminPage } from "./pages/MetadataAdminPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { PresentationAdminPage } from "./pages/PresentationAdminPage";
import { controllerNavigationEnabled, useControllerNavigation } from "./use-controller-navigation";

export function App(): React.JSX.Element {
  const location = useLocation();
  useControllerNavigation(controllerNavigationEnabled(location.pathname));
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, left: 0 });
  }, [location.hash, location.pathname]);
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/games/:gameId" element={<DetailPage />} />
      <Route path="/play/:gameId" element={<PlayerPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/collections" element={<CollectionsPage />} />
      <Route path="/collections/:collectionSlug" element={<CollectionsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/profiles" element={<ProfilesPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/admin/metadata" element={<MetadataAdminPage />} />
      <Route path="/admin/presentation" element={<PresentationAdminPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
