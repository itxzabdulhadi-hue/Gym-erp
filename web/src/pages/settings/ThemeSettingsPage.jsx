import { ThemeStudio } from '@/features/theme/ThemeStudio';

/**
 * Settings → Theme Studio.
 *
 * The studio itself is a feature component; this route only decides who may
 * reach it. `theme.view` is enough to look, and the save controls inside the
 * studio check `theme.manage` separately, so a viewer is not shown buttons
 * that would fail.
 */
export function ThemeSettingsPage() {
  return <ThemeStudio />;
}

export default ThemeSettingsPage;
