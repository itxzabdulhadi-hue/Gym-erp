import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input, Select, Switch, Checkbox } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { useState } from 'react';
import { Check, Search } from 'lucide-react';

/**
 * Live preview.
 *
 * The real proof that the theme engine works is that this panel - and the rest
 * of the application around it - restyles the instant a control changes, with
 * no reload. These components consume only tokens, so whatever the tenant picks
 * is what renders.
 */
export function ThemePreview({ theme }) {
  const [tab, setTab] = useState('preview');
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);

  return (
    <Card className="p-4">
      <CardHeader
        title="Live preview"
        description="Changes apply immediately, before you save"
        action={<Badge tone="success" dot>Live</Badge>}
      />

      <Tabs
        className="mt-4"
        size="sm"
        tabs={[
          { key: 'preview', label: 'Components' },
          { key: 'table', label: 'Table' },
          { key: 'form', label: 'Form' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4 space-y-4">
        {tab === 'preview' && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm">Primary</Button>
              <Button size="sm" variant="secondary">Secondary</Button>
              <Button size="sm" variant="accent">Accent</Button>
              <Button size="sm" variant="outline">Outline</Button>
              <Button size="sm" variant="soft">Soft</Button>
              <Button size="sm" variant="ghost">Ghost</Button>
              <Button size="sm" variant="danger">Danger</Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status="active" />
              <StatusBadge status="pending" />
              <StatusBadge status="expired" />
              <StatusBadge status="frozen" />
              <Badge tone="info" dot>Info</Badge>
              <Badge tone="neutral">Neutral</Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-border bg-surface-alt p-3">
                <p className="text-sm font-semibold text-foreground">Surface alt card</p>
                <p className="mt-1 text-xs text-muted">
                  Radius {theme?.appearance?.radius ?? 12}px · {theme?.appearance?.cardStyle}
                </p>
              </div>
              <div className="rounded bg-primary p-3 text-primary-fg">
                <p className="text-sm font-semibold">Primary surface</p>
                <p className="mt-1 text-xs opacity-80">Foreground on primary</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded border border-border p-3">
              <span className="grid h-8 w-8 place-items-center rounded bg-sidebar text-sidebar-fg text-xs font-bold">
                SB
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">Sidebar tokens</p>
                <p className="truncate text-xs text-muted">Active: sidebar active background</p>
              </div>
              <span className="ml-auto h-6 w-6 rounded bg-sidebar-active" aria-hidden="true" />
            </div>
          </>
        )}

        {tab === 'table' && (
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt">
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-muted">Member</th>
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-muted">Plan</th>
                  <th className="border-b border-border px-3 py-2 text-right text-xs font-semibold text-muted">Due</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Aisha Khan', 'Annual', '$0'],
                  ['Daniel Okafor', 'Monthly', '$49'],
                  ['Mei Lin', 'Quarterly', '$120'],
                ].map(([name, plan, due], index) => (
                  <tr key={name} className={index % 2 === 1 && theme?.appearance?.tableStyle === 'striped' ? 'bg-surface-alt' : ''}>
                    <td className="border-b border-border px-3 py-2 text-foreground">{name}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{plan}</td>
                    <td className="border-b border-border px-3 py-2 text-right text-foreground">{due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'form' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input placeholder="Search input" className="pl-9" inputStyle={theme?.appearance?.inputStyle} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Outlined / filled / underlined" inputStyle={theme?.appearance?.inputStyle} />
              <Select inputStyle={theme?.appearance?.inputStyle} defaultValue="a">
                <option value="a">Select option A</option>
                <option value="b">Select option B</option>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <Checkbox label="Checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <Switch label="Switch" checked={toggled} onChange={setToggled} />
              <span className="inline-flex items-center gap-1.5 text-sm text-success">
                <Check className="h-4 w-4" />
                Success colour
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default ThemePreview;
