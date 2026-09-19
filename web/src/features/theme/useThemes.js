import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import themesApi from '@/services/themes.api';
import { queryKeys } from '@/lib/queryClient';

/**
 * Theme data layer.
 *
 * Saving a theme changes what every screen looks like, so a successful save
 * invalidates the theme list and the session (which carries the active theme
 * and branding) - that is what makes a save take effect everywhere without a
 * reload.
 */

export function useThemes() {
  return useQuery({ queryKey: queryKeys.themes, queryFn: themesApi.list });
}

export function useActiveTheme() {
  return useQuery({ queryKey: [...queryKeys.themes, 'active'], queryFn: themesApi.active });
}

export function useThemePresets() {
  return useQuery({
    queryKey: [...queryKeys.themes, 'presets'],
    queryFn: themesApi.presets,
    staleTime: 10 * 60_000,
  });
}

function useInvalidateThemes() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: queryKeys.themes });
    client.invalidateQueries({ queryKey: queryKeys.me });
  };
}

export function useCreateTheme() {
  const invalidate = useInvalidateThemes();
  return useMutation({ mutationFn: themesApi.create, onSuccess: invalidate });
}

export function useUpdateTheme() {
  const invalidate = useInvalidateThemes();
  return useMutation({
    mutationFn: ({ id, patch }) => themesApi.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteTheme() {
  const invalidate = useInvalidateThemes();
  return useMutation({ mutationFn: themesApi.remove, onSuccess: invalidate });
}

export function useActivateTheme() {
  const invalidate = useInvalidateThemes();
  return useMutation({ mutationFn: themesApi.activate, onSuccess: invalidate });
}

export function useDuplicateTheme() {
  const invalidate = useInvalidateThemes();
  return useMutation({ mutationFn: themesApi.duplicate, onSuccess: invalidate });
}

export function useValidateCss() {
  return useMutation({ mutationFn: themesApi.validateCss });
}
