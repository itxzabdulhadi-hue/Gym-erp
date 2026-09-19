import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  COLOR_TOKENS,
  ENUMS,
  FONT_PRESETS,
  RADIUS_PRESETS,
  DEFAULT_THEME,
} from '@erp/shared';
import {
  Check,
  Copy,
  Monitor,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Type,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { queryKeys } from '@/lib/queryClient';
import {
  useActivateTheme,
  useCreateTheme,
  useDeleteTheme,
  useDuplicateTheme,
  useThemePresets,
  useThemes,
  useUpdateTheme,
} from './useThemes';
import { ThemePreview } from './ThemePreview';
import { CustomCssEditor } from './CustomCssEditor';

/**
 * Theme Studio.
 *
 * Every control edits a draft and calls preview(), which rewrites the CSS
 * variables on :root. The whole application - not just this panel - restyles
 * as you drag, because there is only one source of truth for colour and shape.
 *
 * The field list is not hardcoded here: the colour swatches come from
 * COLOR_TOKENS and the dropdowns from ENUMS in @erp/shared, so a token added to
 * the contract appears in the studio without editing this file.
 */

const GROUP_ORDER = ['Brand', 'Surface', 'Text', 'Status', 'Chrome'];

function ColorField({ tokenKey, label, value, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded border border-border bg-surface px-2.5 py-2 transition-colors hover:border-ring">
      <span className="min-w-0 truncate text-xs font-medium text-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-[0.625rem] uppercase text-muted">{value}</span>
        <input
          type="color"
          value={value || '#000000'}
          onChange={(event) => onChange(tokenKey, event.target.value)}
          aria-label={label}
          className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </span>
    </label>
  );
}

function EnumSelect({ label, value, options, onChange, name }) {
  return (
    <Field label={label} htmlFor={name}>
      <Select id={name} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function ThemeStudio() {
  const toast = useToast();
  const { can } = useAuth();
  const { theme, committed, isDirty, preview, previewTheme, discard, commit } = useTheme();
  const [section, setSection] = useState('colors');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: themes } = useThemes();
  const { data: presets } = useThemePresets();

  const create = useCreateTheme();
  const update = useUpdateTheme();
  const remove = useDeleteTheme();
  const activate = useActivateTheme();
  const duplicate = useDuplicateTheme();

  const themeList = Array.isArray(themes?.data) ? themes.data : Array.isArray(themes) ? themes : [];
  const presetList = Array.isArray(presets?.data) ? presets.data : Array.isArray(presets) ? presets : [];
  const activeTheme = themeList.find((t) => t.isActive) || null;

  const setColors = (key, value) => preview({ colors: { [key]: value } });
  const setAppearance = (key, value) => preview({ appearance: { [key]: value } });
  const setTypography = (key, value) => preview({ typography: { [key]: value } });
  const setLayout = (key, value) => preview({ layout: { [key]: value } });

  const groupedColors = useMemo(() => {
    const groups = new Map();
    for (const token of COLOR_TOKENS) {
      const group = token.group || 'Other';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(token);
    }
    return [...groups.entries()].sort(
      (a, b) => (GROUP_ORDER.indexOf(a[0]) + 99) % 100 - ((GROUP_ORDER.indexOf(b[0]) + 99) % 100),
    );
  }, []);

  const handleSave = async () => {
    try {
      if (activeTheme) {
        await update.mutateAsync({
          id: activeTheme.id,
          patch: { name: activeTheme.name, config: theme, customCss: activeTheme.customCss || '' },
        });
      } else {
        await create.mutateAsync({ name: 'Custom theme', description: '', config: theme });
      }
      commit(theme);
      toast.success('Theme saved', 'Your changes are now live for everyone in this business.');
    } catch (error) {
      toast.error('Could not save the theme', error.message);
    }
  };

  const handleApplyPreset = (preset) => {
    previewTheme(preset.config);
    toast.info(`Previewing ${preset.name}`, 'Save to make it permanent.');
  };

  const handleDuplicate = async () => {
    if (!activeTheme) return;
    try {
      await duplicate.mutateAsync(activeTheme.id);
      toast.success('Theme duplicated', 'A copy was created for you to edit.');
    } catch (error) {
      toast.error('Could not duplicate', error.message);
    }
  };

  const handleActivate = async (id) => {
    try {
      await activate.mutateAsync(id);
      toast.success('Theme activated');
    } catch (error) {
      toast.error('Could not activate the theme', error.message);
    }
  };

  const handleDelete = async () => {
    if (!activeTheme) return;
    try {
      await remove.mutateAsync(activeTheme.id);
      discard();
      toast.success('Theme deleted');
      setConfirmDelete(false);
    } catch (error) {
      toast.error('Could not delete the theme', error.message);
    }
  };

  const sections = [
    { key: 'colors', label: 'Colours', icon: Palette },
    { key: 'typography', label: 'Typography', icon: Type },
    { key: 'shape', label: 'Shape', icon: Sparkles },
    { key: 'components', label: 'Components', icon: Copy },
    { key: 'layout', label: 'Layout', icon: Monitor },
    { key: 'appearance', label: 'Appearance', icon: Sun },
    { key: 'presets', label: 'Presets', icon: Sparkles },
    { key: 'css', label: 'Custom CSS', icon: Type },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">Theme Studio</h3>
            <p className="mt-0.5 text-xs text-muted">
              {activeTheme ? `Editing "${activeTheme.name}"` : 'No saved theme yet'}
              {isDirty && <span className="ml-1.5 font-medium text-warning">· unsaved changes</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDirty && (
              <Button variant="ghost" size="sm" onClick={discard}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
            {can('theme.manage') && activeTheme && (
              <>
                <Button variant="outline" size="sm" onClick={handleDuplicate} loading={duplicate.isPending}>
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </Button>
                <Button variant="danger-outline" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </>
            )}
            {can('theme.manage') && (
              <Button size="sm" onClick={handleSave} loading={update.isPending || create.isPending} disabled={!isDirty}>
                <Save className="h-3.5 w-3.5" />
                Save theme
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
        {/* --------------------------- Section nav --------------------------- */}
        <nav aria-label="Theme sections" className="lg:sticky lg:top-[4.5rem] lg:self-start">
          <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {sections.map((item) => {
              const Icon = item.icon;
              const active = section === item.key;
              return (
                <li key={item.key} className="shrink-0 lg:w-full">
                  <button
                    type="button"
                    onClick={() => setSection(item.key)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary-soft text-primary'
                        : 'text-muted hover:bg-surface-alt hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ---------------------------- Controls ----------------------------- */}
        <div className="min-w-0 space-y-4">
          {section === 'colors' && (
            <div className="space-y-4">
              {groupedColors.map(([group, tokens]) => (
                <Card key={group} className="p-4">
                  <CardHeader title={group} description={`${tokens.length} tokens`} />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {tokens.map((token) => (
                      <ColorField
                        key={token.key}
                        tokenKey={token.key}
                        label={token.label}
                        value={theme.colors[token.key]}
                        onChange={setColors}
                      />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {section === 'typography' && (
            <Card className="space-y-4 p-4">
              <CardHeader title="Typography" description="Fonts and type scale" />
              <Field label="Interface font" htmlFor="fontFamily">
                <Select
                  id="fontFamily"
                  value={theme.typography.fontFamily}
                  onChange={(event) => setTypography('fontFamily', event.target.value)}
                >
                  {FONT_PRESETS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Heading font"
                htmlFor="headingFontFamily"
                hint="Use inherit to match the interface font"
              >
                <Select
                  id="headingFontFamily"
                  value={theme.typography.headingFontFamily}
                  onChange={(event) => setTypography('headingFontFamily', event.target.value)}
                >
                  <option value="inherit">Inherit interface font</option>
                  {FONT_PRESETS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Type scale — ${theme.typography.fontScale}×`} htmlFor="fontScale">
                <input
                  id="fontScale"
                  type="range"
                  min="0.9"
                  max="1.2"
                  step="0.05"
                  value={theme.typography.fontScale}
                  onChange={(event) => setTypography('fontScale', Number(event.target.value))}
                  className="w-full accent-[var(--color-primary)]"
                />
              </Field>
              <Field label="Google Fonts URL" htmlFor="customFontUrl" hint="Optional. Loaded for the whole tenant.">
                <Input
                  id="customFontUrl"
                  value={theme.typography.customFontUrl || ''}
                  onChange={(event) => setTypography('customFontUrl', event.target.value)}
                  placeholder="https://fonts.googleapis.com/css2?family=…"
                />
              </Field>
              <div
                className="rounded border border-border p-4"
                style={{ fontFamily: 'var(--font-heading)' }}
              >
                <p className="text-xl font-semibold text-foreground">The quick brown fox</p>
                <p className="mt-1 text-sm text-muted">
                  0123456789 · {theme.typography.fontFamily} at {theme.typography.fontScale}×
                </p>
              </div>
            </Card>
          )}

          {section === 'shape' && (
            <Card className="space-y-4 p-4">
              <CardHeader title="Shape" description="Corner radius and elevation" />
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">Radius presets</p>
                <div className="flex flex-wrap gap-2">
                  {RADIUS_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setAppearance('radius', preset.value)}
                      className={cn(
                        'flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        theme.appearance.radius === preset.value
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-border text-muted hover:text-foreground',
                      )}
                    >
                      <span
                        className="h-4 w-4 border-2 border-current"
                        style={{ borderRadius: `${Math.min(preset.value, 12)}px` }}
                        aria-hidden="true"
                      />
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label={`Custom radius — ${theme.appearance.radius}px`} htmlFor="radius">
                <input
                  id="radius"
                  type="range"
                  min="0"
                  max="28"
                  step="1"
                  value={Math.min(theme.appearance.radius, 28)}
                  onChange={(event) => setAppearance('radius', Number(event.target.value))}
                  className="w-full accent-[var(--color-primary)]"
                />
              </Field>
              <EnumSelect
                label="Card style"
                name="cardStyle"
                value={theme.appearance.cardStyle}
                options={ENUMS.cardStyle}
                onChange={(value) => setAppearance('cardStyle', value)}
              />
              <EnumSelect
                label="Shadow"
                name="shadow"
                value={theme.appearance.shadow}
                options={ENUMS.shadow}
                onChange={(value) => setAppearance('shadow', value)}
              />
            </Card>
          )}

          {section === 'components' && (
            <Card className="space-y-4 p-4">
              <CardHeader title="Component styles" description="How controls are drawn" />
              <div className="grid gap-4 sm:grid-cols-2">
                <EnumSelect
                  label="Button style"
                  name="buttonStyle"
                  value={theme.appearance.buttonStyle}
                  options={ENUMS.buttonStyle}
                  onChange={(value) => setAppearance('buttonStyle', value)}
                />
                <EnumSelect
                  label="Input style"
                  name="inputStyle"
                  value={theme.appearance.inputStyle}
                  options={ENUMS.inputStyle}
                  onChange={(value) => setAppearance('inputStyle', value)}
                />
                <EnumSelect
                  label="Table style"
                  name="tableStyle"
                  value={theme.appearance.tableStyle}
                  options={ENUMS.tableStyle}
                  onChange={(value) => setAppearance('tableStyle', value)}
                />
                <EnumSelect
                  label="Sidebar style"
                  name="sidebarStyle"
                  value={theme.appearance.sidebarStyle}
                  options={ENUMS.sidebarStyle}
                  onChange={(value) => setAppearance('sidebarStyle', value)}
                />
                <EnumSelect
                  label="Navbar style"
                  name="navbarStyle"
                  value={theme.appearance.navbarStyle}
                  options={ENUMS.navbarStyle}
                  onChange={(value) => setAppearance('navbarStyle', value)}
                />
                <EnumSelect
                  label="Density"
                  name="density"
                  value={theme.appearance.density}
                  options={ENUMS.density}
                  onChange={(value) => setAppearance('density', value)}
                />
              </div>
            </Card>
          )}

          {section === 'layout' && (
            <Card className="space-y-4 p-4">
              <CardHeader title="Layout" description="Sidebar, navbar and content width" />
              <div className="grid gap-4 sm:grid-cols-2">
                <EnumSelect
                  label="Sidebar position"
                  name="sidebarPosition"
                  value={theme.layout.sidebarPosition}
                  options={ENUMS.sidebarPosition}
                  onChange={(value) => setLayout('sidebarPosition', value)}
                />
                <EnumSelect
                  label="Content width"
                  name="contentWidth"
                  value={theme.layout.contentWidth}
                  options={ENUMS.contentWidth}
                  onChange={(value) => setLayout('contentWidth', value)}
                />
              </div>
              <Field label={`Sidebar width — ${theme.layout.sidebarWidth}px`} htmlFor="sidebarWidth">
                <input
                  id="sidebarWidth"
                  type="range"
                  min="200"
                  max="340"
                  step="4"
                  value={theme.layout.sidebarWidth}
                  onChange={(event) => setLayout('sidebarWidth', Number(event.target.value))}
                  className="w-full accent-[var(--color-primary)]"
                />
              </Field>
              <Switch
                label="Collapsible sidebar"
                description="Lets users narrow the rail to icons only"
                checked={theme.layout.sidebarCollapsible !== false}
                onChange={(value) => setLayout('sidebarCollapsible', value)}
              />
              <EnumSelect
                label="Navbar behaviour"
                name="layoutNavbarStyle"
                value={theme.layout.navbarStyle}
                options={ENUMS.navbarStyle}
                onChange={(value) => setLayout('navbarStyle', value)}
              />
            </Card>
          )}

          {section === 'appearance' && (
            <Card className="space-y-4 p-4">
              <CardHeader title="Appearance" description="Light, dark or follow the system" />
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                  { value: 'system', label: 'System', icon: Monitor },
                ].map((option) => {
                  const Icon = option.icon;
                  const active = theme.appearance.mode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAppearance('mode', option.value)}
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded border px-3 py-3 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-border text-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs leading-relaxed text-muted">
                Dark mode changes the chrome around your palette. The Midnight preset ships a full dark
                colour set - apply it from Presets if you want a complete dark identity rather than a
                dark frame around light surfaces.
              </p>
            </Card>
          )}

          {section === 'presets' && (
            <Card className="p-4">
              <CardHeader
                title="Presets"
                description="Starting points - every value stays editable after you apply one"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {presetList.map((preset) => {
                  const colors = preset.config?.colors || {};
                  const isActive = activeTheme?.name === preset.name;
                  return (
                    <div key={preset.name} className="rounded border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {preset.name}
                            {isActive && <Badge tone="success" className="ml-2">Active</Badge>}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{preset.description}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex gap-1" aria-hidden="true">
                        {[colors.primary, colors.secondary, colors.accent, colors.background, colors.surface].map(
                          (color, index) => (
                            <span
                              key={index}
                              className="h-5 flex-1 rounded border border-border"
                              style={{ background: color || 'transparent' }}
                            />
                          ),
                        )}
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => handleApplyPreset(preset)}
                      >
                        <Sparkles className="h-3 w-3" />
                        Preview {preset.name}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {section === 'css' && <CustomCssEditor themeId={activeTheme?.id} customCss={activeTheme?.customCss || ''} />}

          {themeList.length > 0 && (
            <Card className="p-4">
              <CardHeader title="Saved themes" description="Activate one to apply it to the whole business" />
              <ul className="mt-3 divide-y divide-border">
                {themeList.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {item.name}
                        {item.isActive && <Badge tone="primary" className="ml-2">Active</Badge>}
                      </p>
                      {item.description && <p className="truncate text-xs text-muted">{item.description}</p>}
                    </div>
                    {!item.isActive && can('theme.manage') && (
                      <Button size="xs" variant="outline" onClick={() => handleActivate(item.id)}>
                        <Check className="h-3 w-3" />
                        Activate
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ThemePreview theme={theme} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        loading={remove.isPending}
        title="Delete this theme?"
        description={
          activeTheme
            ? `"${activeTheme.name}" will be permanently removed. The business will fall back to the default theme.`
            : ''
        }
        confirmLabel="Delete theme"
      />
    </div>
  );
}

export default ThemeStudio;
