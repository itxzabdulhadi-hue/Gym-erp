import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  Fingerprint,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/contexts/AuthContext';
import dashboardApi from '@/services/dashboard.api';
import { queryKeys } from '@/lib/queryClient';
import { money, plainNumber, formatDate, relativeTime, humanize } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { CardSkeleton, ErrorState, EmptyState } from '@/components/ui/States';
import { terminologyFor } from '@/services/branding.api';

/**
 * Dashboard.
 *
 * Every number here is read from /api/dashboard - metrics, series and lists.
 * Nothing is estimated, averaged or hardcoded on the client, so what the owner
 * sees is what the database holds.
 */

const CHART_COLORS = ['--color-primary', '--color-accent', '--color-info', '--color-success', '--color-warning'];

function chartColor(index) {
  return `var(${CHART_COLORS[index % CHART_COLORS.length]})`;
}

/** The API returns the attendance window unordered; charts need it chronological. */
function chronological(series) {
  if (!Array.isArray(series)) return [];
  return [...series].sort((a, b) => String(a.date || a.label).localeCompare(String(b.date || b.label)));
}

function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: dashboardApi.overview,
    staleTime: 20_000,
  });
}

function StatTile({ label, value, hint, icon: Icon, tone = 'primary', trend }) {
  const positive = typeof trend === 'number' && trend >= 0;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span
          className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded',
            tone === 'danger' && 'bg-danger-soft text-danger',
            tone === 'warning' && 'bg-warning-soft text-warning',
            tone === 'success' && 'bg-success-soft text-success',
            tone === 'primary' && 'bg-primary-soft text-primary',
          )}
          aria-hidden="true"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {typeof trend === 'number' && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[0.6875rem] font-medium',
              positive ? 'text-success' : 'text-danger',
            )}
          >
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {hint && <span className="truncate text-[0.6875rem] text-muted">{hint}</span>}
      </div>
    </Card>
  );
}

function ChartCard({ title, description, action, children, className }) {
  return (
    <Card className={cn('flex flex-col p-4', className)}>
      <CardHeader title={title} description={description} action={action} />
      <div className="mt-4 h-56 w-full">{children}</div>
    </Card>
  );
}

function ChartTip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg">
      <p className="font-medium text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-muted">
          {entry.name}: <span className="font-medium text-foreground">{formatter ? formatter(entry.value) : entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { branding, can } = useAuth();
  const terms = useMemo(() => terminologyFor(branding), [branding]);
  const { data, isLoading, error, refetch, isFetching } = useDashboard();

  const metrics = data?.metrics || {};
  const series = data?.series || {};
  const lists = data?.lists || {};
  const layoutWidgets = data?.layout?.widgets || [];

  const attendance = useMemo(() => chronological(series.attendanceTrend), [series.attendanceTrend]);
  const revenue = useMemo(() => chronological(series.revenueTrend), [series.revenueTrend]);
  const planDistribution = series.planDistribution || [];

  const currency = (value) => money(value, branding);

  if (error) {
    return <ErrorState error={error} onRetry={() => refetch()} title="The dashboard could not be loaded" />;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {greeting()}, {branding?.shortName || branding?.businessName || 'there'}
          </h2>
          <p className="text-xs text-muted">
            {data?.generatedAt
              ? `Updated ${relativeTime(data.generatedAt)}`
              : 'Loading the latest figures…'}
            {data?.horizon && ` · expiring by ${formatDate(data.horizon)}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
          {!isFetching && <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </header>

      {/* ------------------------------ Stat tiles ----------------------------- */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} lines={1} className="p-4" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={`Total ${terms.customerPlural.toLowerCase()}`}
            value={plainNumber(metrics.totalMembers)}
            icon={Users}
            hint={`${plainNumber(metrics.activeMembers)} active`}
            trend={metrics.membershipGrowthPct}
          />
          <StatTile
            label={`New ${terms.customerPlural.toLowerCase()} (30d)`}
            value={plainNumber(metrics.newMembers)}
            icon={TrendingUp}
            tone="success"
            hint={`${plainNumber(metrics.newMembersToday)} today`}
          />
          <StatTile
            label={`${terms.visitPlural} today`}
            value={plainNumber(metrics.todayCheckins)}
            icon={Fingerprint}
            hint={`${plainNumber(metrics.todayUniqueMembers)} unique`}
          />
          <StatTile
            label="Expiring in 7 days"
            value={plainNumber(metrics.expiringMemberships)}
            icon={CalendarClock}
            tone="warning"
            hint={`${plainNumber(metrics.expiredMemberships)} expired`}
          />
          <StatTile
            label="Revenue (30d)"
            value={currency(metrics.revenue30d)}
            icon={Banknote}
            tone="success"
            hint={currency(metrics.revenueMonth) + ' this month'}
          />
          <StatTile
            label="Pending payments"
            value={currency(metrics.pendingPayments)}
            icon={Wallet}
            tone="danger"
            hint={`${plainNumber(metrics.pendingPaymentCount)} invoices`}
          />
          <StatTile
            label="Expenses (30d)"
            value={currency(metrics.expenses30d)}
            icon={Wallet}
            tone="warning"
            hint={currency(metrics.expensesMonth) + ' this month'}
          />
          <StatTile
            label="Net revenue (30d)"
            value={currency(metrics.netRevenue30d)}
            icon={TrendingUp}
            tone={Number(metrics.netRevenue30d) >= 0 ? 'success' : 'danger'}
            hint={currency(metrics.netRevenueMonth) + ' this month'}
          />
        </div>
      )}

      {/* -------------------------------- Charts ------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading ? (
          <>
            <CardSkeleton lines={6} />
            <CardSkeleton lines={6} />
          </>
        ) : (
          <>
            <ChartCard title="Revenue" description="Recorded payments over the last 12 periods">
              {revenue.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenue} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--color-muted-text)' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--color-muted-text)' }}
                      tickLine={false}
                      axisLine={false}
                      width={54}
                      tickFormatter={(v) => `${branding?.currencySymbol || ''}${v}`}
                    />
                    <ChartTooltip content={<ChartTip formatter={(v) => currency(v)} />} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Revenue"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#revenueFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState compact title="No revenue recorded yet" description="Payments will appear here as they are recorded." />
              )}
            </ChartCard>

            <ChartCard title={terms.visitPlural} description="Daily visits over the last 14 days">
              {attendance.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attendance} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--color-muted-text)' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--color-muted-text)' }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={40}
                    />
                    <ChartTooltip content={<ChartTip />} cursor={{ fill: 'var(--color-surface-alt)' }} />
                    <Bar dataKey="value" name={terms.visitPlural} fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState compact title="No visits recorded yet" />
              )}
            </ChartCard>
          </>
        )}
      </div>

      {/* --------------------------- Lists and mix ---------------------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <CardHeader
            title="Recent payments"
            description="The latest recorded transactions"
            action={
              can('payments.view') ? (
                <Button as={Link} to="/payments" variant="ghost" size="sm">
                  View all
                </Button>
              ) : null
            }
          />
          {isLoading ? (
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-9 rounded" />
              ))}
            </div>
          ) : lists.recentPayments?.length ? (
            <ul className="mt-3 divide-y divide-border">
              {lists.recentPayments.map((payment) => (
                <li key={payment.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={payment.member_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{payment.member_name}</p>
                    <p className="truncate text-xs text-muted">
                      {payment.invoice_no} · {humanize(payment.method)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-foreground">{currency(payment.amount_paid)}</p>
                    <StatusBadge status={payment.status} className="mt-0.5" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact className="mt-3" title="No payments yet" description="Recorded payments will show up here." />
          )}
        </Card>

        <Card className="p-4">
          <CardHeader title="Plan mix" description={`${terms.subscriptionPlural} by plan`} />
          {isLoading ? (
            <div className="skeleton mt-4 h-40 rounded" />
          ) : planDistribution.length ? (
            <>
              <div className="mt-2 h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={planDistribution}
                      dataKey="value"
                      nameKey="label"
                      innerRadius="58%"
                      outerRadius="88%"
                      paddingAngle={2}
                      stroke="var(--color-surface)"
                    >
                      {planDistribution.map((entry, index) => (
                        <Cell key={entry.label || index} fill={chartColor(index)} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {planDistribution.map((entry, index) => (
                  <li key={entry.label || index} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: chartColor(index) }} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{entry.label}</span>
                    <span className="font-medium text-muted">{plainNumber(entry.value)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState compact className="mt-3" title="No plans in use" />
          )}
        </Card>
      </div>

      <Card className="p-4">
        <CardHeader
          title={`New ${terms.customerPlural.toLowerCase()}`}
          description="Most recently joined"
          action={
            can('members.view') ? (
              <Button as={Link} to="/members" variant="ghost" size="sm">
                View all
              </Button>
            ) : null
          }
        />
        {isLoading ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded" />
            ))}
          </div>
        ) : lists.recentMembers?.length ? (
          <ul className="mt-3 grid gap-x-4 sm:grid-cols-2">
            {lists.recentMembers.map((member) => (
              <li key={member.id} className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
                <Avatar src={member.photo_url} name={`${member.first_name} ${member.last_name}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {member.first_name} {member.last_name}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {member.member_no} · joined {formatDate(member.join_date)}
                  </p>
                </div>
                <StatusBadge status={member.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact className="mt-3" title={`No ${terms.customerPlural.toLowerCase()} yet`} />
        )}
      </Card>

      {layoutWidgets.length === 0 && !isLoading && (
        <p className="text-center text-xs text-muted">
          No dashboard widgets are configured for your account.
        </p>
      )}
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default DashboardPage;
