import { useEffect, useRef } from "react";
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

  // Latest params, read inside the state -> URL effect without making it a dep
  // (which would fight the URL -> state sync).
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

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

  // State -> URL. Only navigate when the param actually changes; calling
  // setSearchParams on a no-op still replaces history and drops location.state
  // (e.g. the kit-import payload passed to the Build page).
  useEffect(() => {
    const next = searchParamsWithProfile(searchParamsRef.current, selectedProfileId);
    if (next) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedProfileId, setSearchParams]);
}
