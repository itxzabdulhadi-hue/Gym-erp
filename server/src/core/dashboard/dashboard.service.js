import { withTenant } from '../../db/index.js';
import { DASHBOARD_WIDGETS } from '@erp/shared';
import { addDays, todayISO, lastDays, lastMonths } from '../../utils/dates.js';

/**
 * Dashboard metrics.
 *
 * Every number here is computed from the tenant's own rows at request time -
 * there is no sample data and no hardcoding. Widgets are addressed by id from
 * the shared catalogue so a saved layout can ask for exactly what it renders.
 */

export async function getDashboardMetrics(tenantId, options = {}) {
  const warningDays = Number(options.expiryWarningDays ?? 7);
  const horizon = addDays(todayISO(), warningDays);

  return withTenant(tenantId, async (client) => {
    const [
      memberCounts,
      membershipCounts,
      attendanceToday,
      finance,
      attendanceTrend,
      revenueTrend,
      growth,
      planDistribution,
      recentPayments,
      recentMembers,
      expiringList,
    ] = await Promise.all([
      client.query(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE status = 'active')::int AS active,
           count(*) FILTER (WHERE status = 'frozen')::int AS frozen,
           count(*) FILTER (WHERE status = 'expired')::int AS expired,
           count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
           count(*) FILTER (WHERE join_date >= CURRENT_DATE - interval '30 days')::int AS new_last_30d,
           count(*) FILTER (WHERE join_date = CURRENT_DATE)::int AS new_today
         FROM members WHERE tenant_id = $1`,
        [tenantId],
      ),
      client.query(
        `SELECT
           count(*) FILTER (WHERE status = 'active')::int AS active,
           count(*) FILTER (WHERE status = 'active' AND end_date BETWEEN CURRENT_DATE AND $2::date)::int AS expiring,
           count(*) FILTER (WHERE status = 'expired')::int AS expired,
           count(*) FILTER (WHERE status = 'frozen')::int AS frozen
         FROM memberships WHERE tenant_id = $1`,
        [tenantId, horizon],
      ),
      client.query(
        `SELECT count(*)::int AS checkins,
                count(*) FILTER (WHERE check_out_at IS NOT NULL)::int AS checked_out,
                count(DISTINCT member_id)::int AS unique_members
         FROM attendance WHERE tenant_id = $1 AND visit_date = CURRENT_DATE`,
        [tenantId],
      ),
      client.query(
        `SELECT
           COALESCE(SUM(p.amount_paid) FILTER (WHERE p.status IN ('paid','partial') AND p.paid_at >= CURRENT_DATE - interval '30 days'), 0)::numeric AS revenue_30d,
           COALESCE(SUM(p.amount_paid) FILTER (WHERE p.status IN ('paid','partial') AND p.paid_at >= date_trunc('month', CURRENT_DATE)), 0)::numeric AS revenue_month,
           COALESCE(SUM(p.amount - p.amount_paid) FILTER (WHERE p.status IN ('pending','partial')), 0)::numeric AS outstanding,
           count(*) FILTER (WHERE p.status IN ('pending','partial'))::int AS pending_count,
           (SELECT COALESCE(SUM(amount), 0)::numeric FROM expenses WHERE tenant_id = $1 AND expense_date >= CURRENT_DATE - interval '30 days') AS expenses_30d,
           (SELECT COALESCE(SUM(amount), 0)::numeric FROM expenses WHERE tenant_id = $1 AND expense_date >= date_trunc('month', CURRENT_DATE)) AS expenses_month
         FROM payments p WHERE p.tenant_id = $1`,
        [tenantId],
      ),
      client.query(
        `SELECT visit_date::text AS date, count(*)::int AS checkins
         FROM attendance
         WHERE tenant_id = $1 AND visit_date >= CURRENT_DATE - interval '13 days'
         GROUP BY visit_date ORDER BY visit_date`,
        [tenantId],
      ),
      client.query(
        `SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month,
                COALESCE(SUM(amount_paid), 0)::numeric AS revenue
         FROM payments
         WHERE tenant_id = $1 AND status IN ('paid','partial') AND paid_at >= date_trunc('month', CURRENT_DATE) - interval '11 months'
         GROUP BY 1 ORDER BY 1`,
        [tenantId],
      ),
      client.query(
        `SELECT to_char(date_trunc('month', join_date), 'YYYY-MM') AS month, count(*)::int AS joined
         FROM members
         WHERE tenant_id = $1 AND join_date >= date_trunc('month', CURRENT_DATE) - interval '11 months'
         GROUP BY 1 ORDER BY 1`,
        [tenantId],
      ),
      client.query(
        `SELECT mp.name, count(ms.id)::int AS members
         FROM memberships ms
         JOIN membership_plans mp ON mp.id = ms.plan_id
         WHERE ms.tenant_id = $1 AND ms.status = 'active'
         GROUP BY mp.name ORDER BY members DESC LIMIT 6`,
        [tenantId],
      ),
      client.query(
        `SELECT p.id, p.invoice_no, p.amount, p.amount_paid, p.method, p.status, p.paid_at,
                concat(m.first_name, ' ', m.last_name) AS member_name, m.id AS member_id
         FROM payments p JOIN members m ON m.id = p.member_id
         WHERE p.tenant_id = $1
         ORDER BY p.created_at DESC LIMIT 8`,
        [tenantId],
      ),
      client.query(
        `SELECT id, member_no, first_name, last_name, status, join_date, photo_url, email, phone
         FROM members WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT 8`,
        [tenantId],
      ),
      client.query(
        `SELECT ms.id, ms.end_date, ms.plan_name, m.id AS member_id,
                concat(m.first_name, ' ', m.last_name) AS member_name, m.phone
         FROM memberships ms JOIN members m ON m.id = ms.member_id
         WHERE ms.tenant_id = $1 AND ms.status = 'active' AND ms.end_date BETWEEN CURRENT_DATE AND $2::date
         ORDER BY ms.end_date ASC LIMIT 8`,
        [tenantId, horizon],
      ),
    ]);

    const members = memberCounts.rows[0];
    const memberships = membershipCounts.rows[0];
    const today = attendanceToday.rows[0];
    const money = finance.rows[0];

    const metrics = {
      totalMembers: members.total,
      activeMembers: members.active,
      frozenMembers: members.frozen,
      suspendedMembers: members.suspended,
      newMembers: members.new_last_30d,
      newMembersToday: members.new_today,
      expiringMemberships: memberships.expiring,
      expiredMemberships: memberships.expired,
      activeMemberships: memberships.active,
      frozenMemberships: memberships.frozen,
      todayCheckins: today.checkins,
      todayUniqueMembers: today.unique_members,
      checkedOut: today.checked_out,
      revenue30d: Number(money.revenue_30d),
      revenueMonth: Number(money.revenue_month),
      pendingPayments: Number(money.outstanding),
      pendingPaymentCount: money.pending_count,
      expenses30d: Number(money.expenses_30d),
      expensesMonth: Number(money.expenses_month),
      netRevenue30d: Number(money.revenue_30d) - Number(money.expenses_30d),
      netRevenueMonth: Number(money.revenue_month) - Number(money.expenses_month),
      membershipGrowthPct: growthPct(members.total, members.new_last_30d),
    };

    const series = {
      attendanceTrend: fillDays(attendanceTrend.rows.map((r) => ({ date: r.date, value: r.checkins })), 14),
      revenueTrend: fillMonths(revenueTrend.rows.map((r) => ({ month: r.month, value: Number(r.revenue) })), 12),
      membershipGrowth: cumulative(fillMonths(growth.rows.map((r) => ({ month: r.month, value: r.joined })), 12), members.total),
      planDistribution: planDistribution.rows.map((r) => ({ name: r.name, value: r.members })),
    };

    const lists = {
      recentPayments: recentPayments.rows,
      recentMembers: recentMembers.rows,
      expiringList: expiringList.rows,
    };

    return { metrics, series, lists, generatedAt: new Date().toISOString(), horizon };
  });
}

/** Data for a single widget (lazy loading / refresh without refetching everything). */
export async function getWidgetData(tenantId, widgetId) {
  const widget = DASHBOARD_WIDGETS.find((w) => w.id === widgetId);
  if (!widget) return null;
  const dashboard = await getDashboardMetrics(tenantId);
  if (widget.type === 'stat') return { id: widgetId, value: dashboard.metrics[widget.metric] ?? null };
  return { id: widgetId, value: dashboard.series[widget.metric] ?? dashboard.lists[widget.metric] ?? null };
}

// ---------------------------------------------------------------------------
// Series helpers
// ---------------------------------------------------------------------------

function fillDays(rows, count) {
  const map = new Map(rows.map((r) => [r.date, r.value]));
  return lastDays(count).map((day) => ({ label: day.slice(5), date: day, value: map.get(day) ?? 0 }));
}

function fillMonths(rows, count) {
  const map = new Map(rows.map((r) => [r.month, r.value]));
  return lastMonths(count).map((month) => ({ label: month, month, value: map.get(month) ?? 0 }));
}

function cumulative(monthly, totalNow) {
  let running = Math.max(0, totalNow - monthly.reduce((sum, m) => sum + m.value, 0));
  return monthly.map((m) => {
    running += m.value;
    return { ...m, value: running };
  });
}

function growthPct(total, added) {
  if (!total) return 0;
  const base = Math.max(1, total - added);
  return Math.round(((total - base) / base) * 1000) / 10;
}
