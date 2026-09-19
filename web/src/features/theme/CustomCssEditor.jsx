import { useEffect, useState } from 'react';
import { AlertTriangle, Eye, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useValidateCss, useUpdateTheme } from './useThemes';

/**
 * Custom CSS - advanced.
 *
 * Deliberately labelled as such: this lets a tenant override anything, so it is
 * the one control that can make the product look broken. The server sanitises
 * what it stores, and this editor checks before saving so the user finds out
 * here rather than after a reload.
 *
 * Malformed CSS cannot crash the app: it is injected as text into a <style>
 * element, so the worst case is that it does nothing.
 */
export function CustomCssEditor({ themeId, customCss = '' }) {
  const toast = useToast();
  const { can } = useAuth();
  const [css, setCss] = useState(customCss);
  const [showPreview, setShowPreview] = useState(false);
  const [verdict, setVerdict] = useState(null);

  useEffect(() => setCss(customCss), [customCss]);

  const validate = useValidateCss();
  const update = useUpdateTheme();

  const dirty = css !== (customCss || '');

  const runValidation = async () => {
    try {
      const result = await validate.mutateAsync(css);
      setVerdict(result);
      return result;
    } catch (error) {
      setVerdict({ accepted: false, message: error.message });
      return null;
    }
  };

  const handleSave = async () => {
    const result = await runValidation();
    if (!result?.accepted) {
      toast.error('CSS was rejected', result?.message || 'The server did not accept this stylesheet.');
      return;
    }
    try {
      await update.mutateAsync({ id: themeId, patch: { customCss: css } });
      toast.success('Custom CSS saved', 'It will apply across the application.');
    } catch (error) {
      toast.error('Could not save the CSS', error.message);
    }
  };

  return (
    <Card className="p-4">
      <CardHeader
        title="Custom CSS"
        description="Overrides for this business only, scoped to its own theme"
        action={<Badge tone="warning" icon={AlertTriangle}>Advanced</Badge>}
      />

      <div className="mt-3 flex items-start gap-2.5 rounded border border-warning bg-warning-soft p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-foreground">
          This stylesheet can override any part of the interface, including in ways that make it hard to
          use. It is stored after sanitisation - unsafe rules such as external imports and script-bearing
          properties are stripped by the server. If the result looks wrong, reset to clear it.
        </p>
      </div>

      <label htmlFor="customCss" className="mt-4 block text-xs font-medium text-foreground">
        Stylesheet
      </label>
      <textarea
        id="customCss"
        value={css}
        onChange={(event) => {
          setCss(event.target.value);
          setVerdict(null);
        }}
        spellCheck={false}
        rows={12}
        placeholder={'.card {\n  border-radius: 4px;\n}\n\nbutton {\n  letter-spacing: 0.01em;\n}'}
        className="mt-1.5 w-full rounded border border-border bg-input p-3 font-mono text-xs leading-relaxed text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {verdict && (
        <p
          role="status"
          className={`mt-2 text-xs ${verdict.accepted ? 'text-success' : 'text-danger'}`}
        >
          {verdict.message || (verdict.accepted ? 'Accepted' : 'Rejected')}
          {typeof verdict.length === 'number' && ` · ${verdict.length} characters`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {can('theme.manage') && (
          <>
            <Button size="sm" onClick={handleSave} loading={update.isPending} disabled={!dirty && !css}>
              <Save className="h-3.5 w-3.5" />
              Save CSS
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={runValidation}
              loading={validate.isPending}
              disabled={!css}
            >
              Check
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)} disabled={!css}>
          <Eye className="h-3.5 w-3.5" />
          {showPreview ? 'Hide preview' : 'Preview'}
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCss(customCss || '');
              setVerdict(null);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}
      </div>

      {showPreview && css && (
        <div className="mt-4 rounded border border-border">
          <p className="border-b border-border bg-surface-alt px-3 py-2 text-xs font-medium text-muted">
            Rendered with your stylesheet applied
          </p>
          <style>{css}</style>
          <div className="p-4">
            <div className="card p-4">
              <p className="text-sm font-semibold text-foreground">Sample card</p>
              <p className="mt-1 text-xs text-muted">Your rules apply to this element and its children.</p>
              <Button size="sm" className="mt-3">
                Sample button
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default CustomCssEditor;
