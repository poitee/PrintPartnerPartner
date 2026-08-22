import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useProfileSelection } from "../context/ProfileContext";
import { shouldBlockUrlProfileSync } from "./profileSelection";
import {
  parseProfileParam,
  profileIdFromUrl,
  searchAfterProfileStamp,
} from "./profileUrlSync";

/** Bidirectional sync between selected plan and ?profile= URL param. */
export function useProfileUrlSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    pendingSelectionId,
    clearPendingSelection,
  } = useProfileSelection();

  const locationRef = useRef(location);
  locationRef.current = location;

  const selectedRef = useRef(selectedProfileId);
  selectedRef.current = selectedProfileId;

  const pendingRef = useRef(pendingSelectionId);
  pendingRef.current = pendingSelectionId;

  // URL -> state when the query or plan list changes (not when selection changes).
  useEffect(() => {
    const urlId = parseProfileParam(new URLSearchParams(location.search).get("profile"));
    if (
      shouldBlockUrlProfileSync(urlId, pendingRef.current, selectedRef.current)
    ) {
      return;
    }
    if (urlId != null && urlId === pendingRef.current) {
      clearPendingSelection(urlId);
    }
    const nextId = profileIdFromUrl(
      urlId,
      profiles.map((p) => p.id),
      selectedRef.current,
    );
    if (nextId != null) {
      setSelectedProfileId(nextId, { fromUrl: true });
    }
    // selectedProfileId intentionally omitted — including it fights state -> URL sync.
  }, [location.search, profiles, setSelectedProfileId, clearPendingSelection]);

  // State -> URL. Read the live location at effect time so a stale /builds
  // render cannot replace New Build's navigation to Sources.
  useEffect(() => {
    const live = locationRef.current;
    const search = searchAfterProfileStamp(
      live.pathname,
      live.search,
      selectedProfileId,
    );
    if (search !== undefined) {
      navigate({ pathname: live.pathname, search }, { replace: true });
    }
    const params = new URLSearchParams(
      live.search.startsWith("?") ? live.search.slice(1) : live.search,
    );
    if (
      selectedProfileId != null &&
      params.get("profile") === String(selectedProfileId)
    ) {
      clearPendingSelection(selectedProfileId);
    }
  }, [selectedProfileId, location.pathname, navigate, clearPendingSelection]);
}
