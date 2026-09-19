import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Fingerprint,
  Mail,
  MapPin,
  Pencil,
  Phone,
  TrendingUp,
  User,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { money, formatDate, formatDateTime, plainNumber, relativeTime, humanize } from '@/lib/format';
import { terminologyFor } from '@/services/branding.api';
import { MemberFormModal } from './MemberFormModal';
import { useMember, useMemberSection } from './useMembers';

/**
 * Member profile.
 *
 * The header carries the facts that matter at a glance; each tab loads its own
 * sub-resource on demand, so opening a profile does not pull the member's
 * entire attendance and payment history in one request.
 */

export function MemberProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { branding, can } = useAuth();
  const terms = useMemo(() => terminologyFor(branding), [branding]);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);

  const { data: member, isLoading, error, refetch } = useMember(id);

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => refetch()}
        title={error.status === 404 ? `${terms.customer} not found` : 'Could not load this profile'}
      />
    );
  }

  if (isLoading || !member) {
    return (
      <div className="space-y-4">
        <CardSkeleton lines={2} />
        <div className="grid gap-4 lg:grid-cols-3">
          <CardSkeleton lines={5} className="lg:col-span-2" />
          <CardSkeleton lines={5} />
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: User },
    can('memberships.view') && { key: 'membership', label: terms.subscription, icon: CreditCard },
    can('attendance.view') && { key: 'attendance', label: terms.visitPlural, icon: Fingerprint },
    can('payments.view') && { key: 'payments', label: 'Payments', icon: Banknote },
    can('workouts.view') && { key: 'workouts', label: 'Workouts', icon: ClipboardList },
    can('progress.view') && { key: 'progress', label: 'Progress', icon: TrendingUp },
    { key: 'notes', label: 'Notes', icon: Pencil },
  ].filter(Boolean);

  const expiryTone =
    member.daysRemaining === null || member.daysRemaining === undefined
      ? 'neutral'
      : member.daysRemaining < 0
        ? 'danger'
        : member.daysRemaining <= 7
          ? 'warning'
          : 'success';

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/members')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {terms.customerPlural.toLowerCase()}
      </button>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <Avatar src={member.photoUrl} name={member.fullName} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  {member.fullName}
                </h2>
                <StatusBadge status={member.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {member.memberNo}
                {member.age ? ` · ${member.age} years` : ''}
                {member.gender ? ` · ${humanize(member.gender)}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {member.phone && (
                  <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                    <Phone className="h-3 w-3" />
                    {member.phone}
                  </a>
                )}
                {member.email && (
                  <a href={`mailto:${member.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                    <Mail className="h-3 w-3" />
                    <span className="truncate">{member.email}</span>
                  </a>
                )}
                {(member.address || member.city) && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" />
                    {[member.address, member.city].filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {can('members.edit') && (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </div>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label={terms.subscription} value={member.currentPlan || 'None'} />
          <Fact
            label="Expires"
            value={member.membershipEndDate ? formatDate(member.membershipEndDate) : '—'}
            hint={
              member.daysRemaining !== null && member.daysRemaining !== undefined ? (
                <Badge tone={expiryTone}>
                  {member.daysRemaining < 0 ? `${Math.abs(member.daysRemaining)}d overdue` : `${member.daysRemaining}d left`}
                </Badge>
              ) : null
            }
          />
          <Fact label={terms.visitPlural + ' (30d)'} value={plainNumber(member.visits30d)} />
          <Fact label={`Total ${terms.visitPlural.toLowerCase()}`} value={plainNumber(member.totalVisits)} />
          <Fact label="Paid to date" value={money(member.totalPaid, branding)} />
          <Fact
            label="Outstanding"
            value={money(member.outstanding, branding)}
            tone={Number(member.outstanding) > 0 ? 'danger' : undefined}
          />
        </dl>
      </Card>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab member={member} terms={terms} branding={branding} />}
      {tab === 'membership' && <MembershipTab id={id} terms={terms} branding={branding} />}
      {tab === 'attendance' && <AttendanceTab id={id} terms={terms} />}
      {tab === 'payments' && <PaymentsTab id={id} branding={branding} />}
      {tab === 'workouts' && <WorkoutsTab id={id} />}
      {tab === 'progress' && <ProgressTab id={id} />}
      {tab === 'notes' && (
        <TabPanel id="notes">
          <Card className="p-4">
            <CardHeader title="Notes" description="Private to your team" />
            {member.notes ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{member.notes}</p>
            ) : (
              <EmptyState
                compact
                className="mt-3"
                title="No notes yet"
                description="Add context about this member from their profile edit form."
                action={
                  can('members.edit') ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      Add a note
                    </Button>
                  ) : null
                }
              />
            )}
          </Card>
        </TabPanel>
      )}

      <MemberFormModal open={editing} onClose={() => setEditing(false)} member={member} />
    </div>
  );
}

function Fact({ label, value, hint, tone }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] uppercase tracking-wide text-muted">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-sm font-semibold ${
          tone === 'danger' ? 'text-danger' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
      {hint && <div className="mt-1">{hint}</div>}
    </div>
  );
}

function OverviewTab({ member, terms, branding }) {
  return (
    <TabPanel id="overview">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <CardHeader title="Profile details" icon={User} />
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Date of birth" value={member.dob ? formatDate(member.dob) : '—'} />
            <Detail label="Gender" value={member.gender ? humanize(member.gender) : '—'} />
            <Detail label="Join date" value={formatDate(member.joinDate)} />
            <Detail label={terms.staff} value={member.trainerName || 'Unassigned'} />
            <Detail label="Blood group" value={member.bloodGroup || '—'} />
            <Detail label="Occupation" value={member.occupation || '—'} />
            <Detail label="Emergency contact" value={member.emergencyContact || '—'} />
            <Detail label="Emergency phone" value={member.emergencyPhone || '—'} />
            <Detail label="Last progress entry" value={member.lastProgressAt ? relativeTime(member.lastProgressAt) : '—'} />
            <Detail label="Added" value={formatDateTime(member.createdAt)} />
          </dl>

          {member.customFields && Object.keys(member.customFields).length > 0 && (
            <>
              <h3 className="mt-5 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                Custom fields
              </h3>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {Object.entries(member.customFields).map(([key, value]) => (
                  <Detail key={key} label={humanize(key)} value={String(value)} />
                ))}
              </dl>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <CardHeader title="Financial summary" icon={Banknote} />
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Paid to date" value={money(member.totalPaid, branding)} />
              <Row
                label="Outstanding"
                value={money(member.outstanding, branding)}
                tone={Number(member.outstanding) > 0 ? 'danger' : undefined}
              />
            </dl>
          </Card>

          <Card className="p-4">
            <CardHeader title="Activity" icon={Fingerprint} />
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label={`${terms.visitPlural} (30d)`} value={plainNumber(member.visits30d)} />
              <Row label={`Total ${terms.visitPlural.toLowerCase()}`} value={plainNumber(member.totalVisits)} />
              <Row label={`${terms.subscription} status`} value={humanize(member.membershipStatus || 'none')} />
            </dl>
          </Card>
        </div>
      </div>
    </TabPanel>
  );
}

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-sm font-semibold ${tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

/** Shared shell for the sub-resource tabs: loading, error and empty handled once. */
function SectionTab({ id, section, params, children, emptyTitle, emptyDescription, icon }) {
  const { data, isLoading, error, refetch } = useMemberSection(id, section, params);
  const rows = Array.isArray(data) ? data : data?.data || [];

  if (isLoading) return <CardSkeleton lines={6} className="mt-4" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="mt-4" compact />;
  if (!rows.length) {
    return (
      <EmptyState className="mt-4" icon={icon} title={emptyTitle} description={emptyDescription} compact />
    );
  }
  return children(rows);
}

function MembershipTab({ id, terms, branding }) {
  return (
    <TabPanel id="membership">
      <SectionTab
        id={id}
        section="memberships"
        icon={CreditCard}
        emptyTitle={`No ${terms.subscriptionPlural.toLowerCase()} yet`}
        emptyDescription={`Assign a ${terms.subscription.toLowerCase()} from the Memberships screen.`}
      >
        {(rows) => (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{row.plan_name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatDate(row.start_date)} → {row.end_date ? formatDate(row.end_date) : 'Open ended'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-foreground">{money(row.price, branding)}</span>
                    <StatusBadge status={row.status} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </SectionTab>
    </TabPanel>
  );
}

function AttendanceTab({ id, terms }) {
  return (
    <TabPanel id="attendance">
      <SectionTab
        id={id}
        section="attendance"
        params={{ limit: 50 }}
        icon={CalendarDays}
        emptyTitle={`No ${terms.visitPlural.toLowerCase()} recorded`}
        emptyDescription={`This ${terms.customer.toLowerCase()} has not checked in yet.`}
      >
        {(rows) => (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{formatDate(row.visit_date)}</p>
                    <p className="text-xs text-muted">
                      Checked in {row.check_in_at ? formatDateTime(row.check_in_at) : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.check_out_at && <span className="text-xs text-muted">Out {formatDateTime(row.check_out_at)}</span>}
                    <StatusBadge status={row.status || 'checked_in'} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </SectionTab>
    </TabPanel>
  );
}

function PaymentsTab({ id, branding }) {
  return (
    <TabPanel id="payments">
      <SectionTab
        id={id}
        section="payments"
        params={{ limit: 50 }}
        icon={Banknote}
        emptyTitle="No payments recorded"
        emptyDescription="Payments made by this member will appear here."
      >
        {(rows) => (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{row.invoice_no}</p>
                    <p className="text-xs text-muted">
                      {formatDate(row.paid_at)} · {humanize(row.method)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">{money(row.amount_paid, branding)}</p>
                      {Number(row.amount) !== Number(row.amount_paid) && (
                        <p className="text-xs text-muted">of {money(row.amount, branding)}</p>
                      )}
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </SectionTab>
    </TabPanel>
  );
}

function WorkoutsTab({ id }) {
  return (
    <TabPanel id="workouts">
      <SectionTab
        id={id}
        section="workouts"
        icon={ClipboardList}
        emptyTitle="No workout plans assigned"
        emptyDescription="Assign a plan from the Workout Plans screen."
      >
        {(rows) => (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{row.plan_name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {row.level ? humanize(row.level) : 'General'}
                      {row.goal ? ` · goal: ${humanize(row.goal)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.trainer_name && <span className="text-xs text-muted">{row.trainer_name}</span>}
                    <StatusBadge status={row.status || 'assigned'} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </SectionTab>
    </TabPanel>
  );
}

function ProgressTab({ id }) {
  return (
    <TabPanel id="progress">
      <SectionTab
        id={id}
        section="progress"
        icon={TrendingUp}
        emptyTitle="No progress recorded"
        emptyDescription="Weight, measurements and body fat entries will chart here."
      >
        {(rows) => (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{formatDate(row.recorded_at)}</p>
                    {row.notes && <p className="mt-0.5 truncate text-xs text-muted">{row.notes}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    {row.weight_kg != null && <span className="font-medium text-foreground">{row.weight_kg} kg</span>}
                    {row.body_fat_pct != null && <span>{row.body_fat_pct}% body fat</span>}
                    {row.bmi != null && <span>BMI {Number(row.bmi).toFixed(1)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </SectionTab>
    </TabPanel>
  );
}

export default MemberProfilePage;
