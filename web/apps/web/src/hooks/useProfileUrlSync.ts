import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useProfileSelection } from "../context/ProfileContext";
import {
  parseProfileParam,
  profileIdFromUrl,
  searchParamsWithProfile,
} from "./profileUrlSync";

/** Bidirectional sync between selected plan and ?profile= URL param. */
export function useProfileUrlSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profiles, selectedProfileId, setSelectedProfileId } = useProfileSelection();

  // URL -> state when the query or plan list changes (not when selection changes).
  useEffect(() => {
    const urlId = parseProfileParam(searchParams.get("profile"));
    const nextId = profileIdFromUrl(
      urlId,
      profiles.map((p) => p.id),
      selectedProfileId,
    );
    if (nextId != null) {
      setSelectedProfileId(nextId);
    }
    // selectedProfileId intentionally omitted — including it fights state -> URL sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see profileUrlSync tests
  }, [searchParams, profiles, setSelectedProfileId]);

  // State -> URL; functional update avoids searchParams dependency loops.
  useEffect(() => {
    setSearchParams(
      (prev) => searchParamsWithProfile(prev, selectedProfileId) ?? prev,
      { replace: true },
    );
  }, [selectedProfileId, setSearchParams]);
}
