import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  fetchProfiles,
  updateProfile,
  type ProfileSummary,
} from "../api/engine";
import { queryKeys } from "./keys";

export function useProfilesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: fetchProfiles,
    enabled,
  });
}

export function useCreateProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createProfile(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.profiles }),
  });
}

export function useUpdateProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateProfile(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.profiles }),
  });
}

export function useDeleteProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteProfile(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.profiles }),
  });
}

export function useDuplicateProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      name,
      clearCheckoff,
    }: {
      id: number;
      name: string;
      clearCheckoff?: boolean;
    }) => duplicateProfile(id, name, { clearCheckoff }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.profiles }),
  });
}

export function invalidateProfiles(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: queryKeys.profiles });
}

export type { ProfileSummary };
