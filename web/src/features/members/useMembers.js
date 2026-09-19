import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import membersApi from '@/services/members.api';
import { queryKeys } from '@/lib/queryClient';

/**
 * Members data layer.
 *
 * Queries and mutations live here rather than in components, so the list, the
 * profile and the import dialog all share one cache and one invalidation rule.
 * A mutation that changes a member invalidates the lists and that member's own
 * record - and nothing else, so unrelated screens are not refetched.
 */

const MEMBER_LIST_AFFECTING = [queryKeys.members({}).slice(0, 1), queryKeys.dashboard];

function useInvalidateMember() {
  const client = useQueryClient();
  return (memberId) => {
    client.invalidateQueries({ queryKey: ['members'] });
    client.invalidateQueries({ queryKey: queryKeys.dashboard });
    if (memberId) {
      client.invalidateQueries({ queryKey: queryKeys.member(memberId) });
      client.invalidateQueries({ queryKey: ['members', memberId] });
    }
  };
}

export function useMembers(params) {
  return useQuery({
    queryKey: queryKeys.members(params),
    queryFn: () => membersApi.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useMember(id) {
  return useQuery({
    queryKey: queryKeys.member(id),
    queryFn: () => membersApi.get(id),
    enabled: !!id,
  });
}

export function useMemberSection(id, section, params) {
  const fetchers = {
    memberships: () => membersApi.memberships(id),
    payments: () => membersApi.payments(id, params),
    attendance: () => membersApi.attendance(id, params),
    progress: () => membersApi.progress(id),
    workouts: () => membersApi.workouts(id),
    documents: () => membersApi.documents(id),
  };
  return useQuery({
    queryKey: [...queryKeys.memberSub(id, section), params ?? {}],
    queryFn: fetchers[section],
    enabled: !!id && !!fetchers[section],
  });
}

export function useCreateMember() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: membersApi.create,
    onSuccess: (member) => invalidate(member?.id),
  });
}

export function useUpdateMember() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: ({ id, patch }) => membersApi.update(id, patch),
    onSuccess: (member) => invalidate(member?.id),
  });
}

export function useDeleteMember() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: membersApi.remove,
    onSuccess: (_result, id) => invalidate(id),
  });
}

export function useBulkMemberStatus() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: ({ ids, status }) => membersApi.bulkStatus(ids, status),
    onSuccess: () => invalidate(),
  });
}

export function useImportMembers() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: membersApi.importCsv,
    onSuccess: () => invalidate(),
  });
}

export { MEMBER_LIST_AFFECTING };
