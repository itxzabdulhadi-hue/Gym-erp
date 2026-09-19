import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { toCsv } from '../../../utils/csv.js';

/**
 * Reports.
 *
 * Every report is parameterised SQL over the tenant's own data, with the same
 * filter set (date range, plan, trainer, status) and the same CSV export path.
 * Adding a report = adding an entry to REPORTS.
 */

function filtersSql(q, params, aliases = {}) {
  const where = [];
  const memberTable = aliases.member || 'm';

  if (q.from) {
    params.push(q.from);
    where.push(`${aliases.date || 'm.join_date'} >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`${aliases.date || 'm.join_date'} <= $${params.length}`);
  }
  if (q.trainerId) {
    params.push(q.trainerId);
    where.push(`${memberTable}.trainer_id = $${params.length}`);
  }
  if (q.planId) {
    params.push(q.planId);
    where.push(`ms.plan_id = $${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`${memberTable}.status = $${params.length}`);
  }
  return where;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function membersReport(tenantId, q = {}) {
  return withTenant(tenantId, async (client) => {
    const params = [tenantId];
    const where = [`m.tenant_id = $1`, ...filtersSql(q, params)];
    const whereSql = where.join(' AND ');

    const [summary, byStatus, growth, byTrainer] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE m.status = 'active')::int AS active,
                count(*) FILTER (WHERE m.status = 'expired')::int AS expired,
                count(*) FILTER (WHERE m.status = 'frozen')::int AS frozen,
                count(*) FILTER (WHERE m.status = 'suspended')::int AS suspended,
                count(*) FILTER (WHERE m.status = 'inactive')::int AS inactive
         FROM members m WHERE ${whereSql}`,
        params,
      ),
      client.query(
        `SELECT m.status, count(*)::int AS count FROM members m WHERE ${whereSql} GROUP BY m.status ORDER BY count DESC`,
        params,
      ),
      client.query(
        `SELECT to_char(date_trunc('month', m.join_date), 'YYYY-MM') AS month, count(*)::int AS joined
         FROM members m WHERE ${whereSql} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      client.query(
        `SELECT concat(t.first_name, ' ', t.last_name) AS trainer, count(m.id)::int AS members,
                count(m.id) FILTER (WHERE m.status = 'active')::int AS active
         FROM members m LEFT JOIN trainers t ON t.id = m.trainer_id
         WHERE ${whereSql} GROUP BY 1 ORDER BY members DESC LIMIT 20`,
        params,
      ),
    ]);

    const rows = growth.rows.map((r) => ({ month: r.month, joined: r.joined }));
    let running = 0;
    const cumulative = rows.map((r) => {
      running += r.joined;
      return { ...r, cumulative: running };
    });

    return {
      filters: q,
      summary: summary.rows[0],
      byStatus: byStatus.rows,
      growth: cumulative,
      byTrainer: byTrainer.rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export async function attendanceReport(tenantId, q = {}) {
  const granularity = ['day', 'week', 'month'].includes(q.granularity) ? q.granularity : 'day';
  const trunc = { day: 'day', week: 'week', month: 'month' }[granularity];

  return withTenant(tenantId, async (client) => {
    const params = [tenantId];
    const where = [`a.tenant_id = $1`];
    if (q.from) {
      params.push(q.from);
      where.push(`a.visit_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`a.visit_date <= $${params.length}`);
    }
    if (q.memberId) {
      params.push(q.memberId);
      where.push(`a.member_id = $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const [series, summary, topMembers, byWeekday] = await Promise.all([
      client.query(
        `SELECT to_char(date_trunc('${trunc}', a.visit_date), 'YYYY-MM-DD') AS period,
                count(*)::int AS visits, count(DISTINCT a.member_id)::int AS unique_members
         FROM attendance a WHERE ${whereSql} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      client.query(
        `SELECT count(*)::int AS visits, count(DISTINCT a.member_id)::int AS unique_members,
                count(DISTINCT a.visit_date)::int AS days,
                COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(a.check_out_at, a.check_in_at + interval '1 hour') - a.check_in_at)) / 60), 0)::numeric AS avg_minutes
         FROM attendance a WHERE ${whereSql}`,
        params,
      ),
      client.query(
        `SELECT m.id, m.member_no, concat(m.first_name, ' ', m.last_name) AS member_name, count(a.id)::int AS visits
         FROM attendance a JOIN members m ON m.id = a.member_id
         WHERE ${whereSql} GROUP BY m.id ORDER BY visits DESC LIMIT 15`,
        params,
      ),
      client.query(
        `SELECT extract(isodow FROM a.check_in_at)::int AS weekday, count(*)::int AS visits
         FROM attendance a WHERE ${whereSql} GROUP BY 1 ORDER BY 1`,
        params,
      ),
    ]);

    return {
      filters: { ...q, granularity },
      summary: { ...summary.rows[0], avgMinutes: Math.round(Number(summary.rows[0].avg_minutes || 0)) },
      series: series.rows,
      topMembers: topMembers.rows,
      byWeekday: byWeekday.rows.map((r) => ({ ...r, label: WEEKDAYS[r.weekday - 1] ?? String(r.weekday) })),
    };
  });
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export async function financeReport(tenantId, q = {}) {
  return withTenant(tenantId, async (client) => {
    const params = [tenantId];
    const payWhere = [`p.tenant_id = $1`];
    if (q.from) {
      params.push(q.from);
      payWhere.push(`p.paid_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      payWhere.push(`p.paid_at <= $${params.length}`);
    }
    if (q.method) {
      params.push(q.method);
      payWhere.push(`p.method = $${params.length}`);
    }
    const payWhereSql = payWhere.join(' AND ');

    const expenseParams = [tenantId];
    const expWhere = ['tenant_id = $1'];
    if (q.from) {
      expenseParams.push(q.from);
      expWhere.push(`expense_date >= $${expenseParams.length}`);
    }
    if (q.to) {
      expenseParams.push(q.to);
      expWhere.push(`expense_date <= $${expenseParams.length}`);
    }
    if (q.category) {
      expenseParams.push(q.category);
      expWhere.push(`category = $${expenseParams.length}`);
    }
    const expWhereSql = expWhere.join(' AND ');

    const [revenue, expenses, monthly, byMethod, outstanding] = await Promise.all([
      client.query(
        `SELECT COALESCE(SUM(amount_paid), 0)::numeric AS collected,
                COALESCE(SUM(amount), 0)::numeric AS billed,
                COALESCE(SUM(discount), 0)::numeric AS discounted,
                count(*)::int AS invoices
         FROM payments p WHERE ${payWhereSql} AND p.status IN ('paid','partial')`,
        params,
      ),
      client.query(`SELECT COALESCE(SUM(amount), 0)::numeric AS total, count(*)::int AS count FROM expenses WHERE ${expWhereSql}`, expenseParams),
      client.query(
        `SELECT to_char(m.month, 'YYYY-MM') AS month,
                COALESCE(rev.amount, 0)::numeric AS revenue, COALESCE(exp.amount, 0)::numeric AS expenses
         FROM generate_series(
                COALESCE(date_trunc('month', $2::date), date_trunc('month', CURRENT_DATE) - interval '11 months'),
                COALESCE(date_trunc('month', $3::date), date_trunc('month', CURRENT_DATE)),
                '1 month') AS m(month)
         LEFT JOIN (SELECT date_trunc('month', paid_at) AS month, SUM(amount_paid) AS amount
                    FROM payments WHERE tenant_id = $1 AND status IN ('paid','partial') GROUP BY 1) rev ON rev.month = m.month
         LEFT JOIN (SELECT date_trunc('month', expense_date) AS month, SUM(amount) AS amount
                    FROM expenses WHERE tenant_id = $1 GROUP BY 1) exp ON exp.month = m.month
         ORDER BY m.month`,
        [tenantId, q.from ?? null, q.to ?? null],
      ),
      client.query(
        `SELECT p.method, count(*)::int AS count, COALESCE(SUM(amount_paid), 0)::numeric AS collected
         FROM payments p WHERE ${payWhereSql} AND p.status IN ('paid','partial') GROUP BY 1 ORDER BY collected DESC`,
        params,
      ),
      client.query(
        `SELECT p.status, count(*)::int AS invoices, COALESCE(SUM(amount - amount_paid), 0)::numeric AS outstanding
         FROM payments p WHERE p.tenant_id = $1 AND p.status IN ('pending','partial') GROUP BY 1`,
        [tenantId],
      ),
    ]);

    const collected = Number(revenue.rows[0].collected);
    const expenseTotal = Number(expenses.rows[0].total);

    return {
      filters: q,
      summary: {
        collected,
        billed: Number(revenue.rows[0].billed),
        discounted: Number(revenue.rows[0].discounted),
        invoices: revenue.rows[0].invoices,
        expenses: expenseTotal,
        net: Math.round((collected - expenseTotal) * 100) / 100,
        marginPct: collected ? Math.round(((collected - expenseTotal) / collected) * 1000) / 10 : 0,
        outstanding: outstanding.rows.reduce((sum, r) => sum + Number(r.outstanding), 0),
      },
      monthly: monthly.rows.map((r) => ({
        month: r.month,
        revenue: Number(r.revenue),
        expenses: Number(r.expenses),
        net: Number(r.revenue) - Number(r.expenses),
      })),
      byMethod: byMethod.rows.map((r) => ({ ...r, collected: Number(r.collected) })),
      outstanding: outstanding.rows.map((r) => ({ ...r, outstanding: Number(r.outstanding) })),
    };
  });
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export async function membershipReport(tenantId, q = {}) {
  return withTenant(tenantId, async (client) => {
    const params = [tenantId];
    const where = [`ms.tenant_id = $1`];
    if (q.from) {
      params.push(q.from);
      where.push(`ms.start_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`ms.start_date <= $${params.length}`);
    }
    if (q.planId) {
      params.push(q.planId);
      where.push(`ms.plan_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`ms.status = $${params.length}`);
    }
    if (q.trainerId) {
      params.push(q.trainerId);
      where.push(`m.trainer_id = $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const [summary, byPlan, expiring, renewals] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ms.status = 'active')::int AS active,
                count(*) FILTER (WHERE ms.status = 'frozen')::int AS frozen,
                count(*) FILTER (WHERE ms.status = 'cancelled')::int AS cancelled,
                count(*) FILTER (WHERE ms.status = 'expired')::int AS expired,
                COALESCE(SUM(ms.price), 0)::numeric AS value
         FROM memberships ms JOIN members m ON m.id = ms.member_id WHERE ${whereSql}`,
        params,
      ),
      client.query(
        `SELECT ms.plan_name, ms.plan_id, count(*)::int AS subscriptions,
                count(*) FILTER (WHERE ms.status = 'active')::int AS active,
                count(*) FILTER (WHERE ms.change_type = 'renewal')::int AS renewals,
                COALESCE(SUM(ms.price), 0)::numeric AS value
         FROM memberships ms JOIN members m ON m.id = ms.member_id
         WHERE ${whereSql} GROUP BY 1, 2 ORDER BY subscriptions DESC LIMIT 20`,
        params,
      ),
      client.query(
        `SELECT ms.id, ms.plan_name, ms.end_date, concat(m.first_name, ' ', m.last_name) AS member_name,
                m.member_no, m.phone, (ms.end_date - CURRENT_DATE) AS days_remaining
         FROM memberships ms JOIN members m ON m.id = ms.member_id
         WHERE ms.tenant_id = $1 AND ms.status = 'active' AND ms.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '30 days'
         ORDER BY ms.end_date LIMIT 50`,
        [tenantId],
      ),
      client.query(
        `SELECT to_char(date_trunc('month', ms.start_date), 'YYYY-MM') AS month,
                count(*) FILTER (WHERE ms.change_type = 'new')::int AS new,
                count(*) FILTER (WHERE ms.change_type = 'renewal')::int AS renewals,
                count(*) FILTER (WHERE ms.change_type IN ('upgrade','downgrade'))::int AS changes
         FROM memberships ms JOIN members m ON m.id = ms.member_id
         WHERE ${whereSql} GROUP BY 1 ORDER BY 1`,
        params,
      ),
    ]);

    return {
      filters: q,
      summary: { ...summary.rows[0], value: Number(summary.rows[0].value) },
      byPlan: byPlan.rows.map((r) => ({ ...r, value: Number(r.value) })),
      expiring: expiring.rows,
      renewals: renewals.rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Registry + CSV export
// ---------------------------------------------------------------------------

export const REPORTS = {
  members: { handler: membersReport, label: 'Members' },
  attendance: { handler: attendanceReport, label: 'Attendance' },
  finance: { handler: financeReport, label: 'Finance' },
  memberships: { handler: membershipReport, label: 'Memberships' },
};

export async function runReport(tenantId, reportKey, filters = {}) {
  const report = REPORTS[reportKey];
  if (!report) throw ApiError.notFound(`Unknown report "${reportKey}"`);
  return report.handler(tenantId, filters);
}

/** Flatten a report result into CSV rows for export. */
export async function exportReport(tenantId, reportKey, filters = {}) {
  const data = await runReport(tenantId, reportKey, filters);

  if (reportKey === 'members') {
    return toCsv(
      [...data.byStatus.map((r) => ({ metric: `Status: ${r.status}`, value: r.count })),
       ...data.growth.map((r) => ({ metric: `Joined ${r.month}`, value: r.joined }))],
      [{ key: 'metric', header: 'Metric' }, { key: 'value', header: 'Value' }],
    );
  }
  if (reportKey === 'attendance') {
    return toCsv(data.series, [
      { key: 'period', header: 'Period' },
      { key: 'visits', header: 'Visits' },
      { key: 'unique_members', header: 'Unique members' },
    ]);
  }
  if (reportKey === 'finance') {
    return toCsv(data.monthly, [
      { key: 'month', header: 'Month' },
      { key: 'revenue', header: 'Revenue' },
      { key: 'expenses', header: 'Expenses' },
      { key: 'net', header: 'Net' },
    ]);
  }
  return toCsv(data.byPlan, [
    { key: 'plan_name', header: 'Plan' },
    { key: 'subscriptions', header: 'Subscriptions' },
    { key: 'active', header: 'Active' },
    { key: 'renewals', header: 'Renewals' },
    { key: 'value', header: 'Value' },
  ]);
}
