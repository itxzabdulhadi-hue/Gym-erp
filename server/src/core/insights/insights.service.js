import { withTenant } from '../../db/index.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Business insights + the AI integration boundary.
 *
 * Everything here is computed from real tenant data with SQL. There is no
 * simulated "AI": `createAiProvider()` returns the port an LLM integration
 * would implement, and calling it before one is configured raises a clear
 * NOT_CONFIGURED error instead of inventing an answer.
 */

/** Revenue and expense trend for a period, with month over month deltas. */
export async function financeInsights(tenantId, { months = 6 } = {}) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT to_char(m.month, 'YYYY-MM') AS month,
              COALESCE(rev.amount, 0)::numeric AS revenue,
              COALESCE(exp.amount, 0)::numeric AS expenses
       FROM generate_series(date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval, date_trunc('month', CURRENT_DATE), '1 month') AS m(month)
       LEFT JOIN (
         SELECT date_trunc('month', paid_at) AS month, SUM(amount_paid) AS amount
         FROM payments WHERE tenant_id = $1 AND status IN ('paid','partial') GROUP BY 1
       ) rev ON rev.month = m.month
       LEFT JOIN (
         SELECT date_trunc('month', expense_date) AS month, SUM(amount) AS amount
         FROM expenses WHERE tenant_id = $1 GROUP BY 1
       ) exp ON exp.month = m.month
       ORDER BY m.month`,
      [tenantId, String(months - 1)],
    );

    const rows = res.rows.map((r) => ({
      month: r.month,
      revenue: Number(r.revenue),
      expenses: Number(r.expenses),
      net: Number(r.revenue) - Number(r.expenses),
    }));

    const last = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    return {
      series: rows,
      summary: {
        revenue: last?.revenue ?? 0,
        expenses: last?.expenses ?? 0,
        net: last?.net ?? 0,
        revenueDelta: delta(last?.revenue, previous?.revenue),
        expenseDelta: delta(last?.expenses, previous?.expenses),
      },
    };
  });
}

/** Members who are likely to lapse: expired or expiring without a renewal. */
export async function churnRisk(tenantId, { days = 30, limit = 25 } = {}) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT m.id, m.member_no, concat(m.first_name, ' ', m.last_name) AS member_name,
              m.phone, m.email, m.status,
              latest.plan_name, latest.end_date,
              (latest.end_date - CURRENT_DATE) AS days_remaining,
              COALESCE(visits.visits, 0)::int AS visits_30d,
              latest.last_payment
       FROM members m
       JOIN LATERAL (
         SELECT ms.plan_name, ms.end_date, ms.status,
                (SELECT max(paid_at) FROM payments p WHERE p.member_id = m.id AND p.status IN ('paid','partial')) AS last_payment
         FROM memberships ms WHERE ms.member_id = m.id ORDER BY ms.end_date DESC LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS visits FROM attendance a
         WHERE a.member_id = m.id AND a.visit_date >= CURRENT_DATE - interval '30 days'
       ) visits ON true
       WHERE m.tenant_id = $1
         AND m.status NOT IN ('suspended', 'inactive')
         AND (latest.status = 'expired' OR latest.end_date <= CURRENT_DATE + $2::int)
       ORDER BY visits_30d ASC, days_remaining ASC
       LIMIT $3`,
      [tenantId, days, limit],
    );

    return res.rows.map((row) => ({
      ...row,
      risk: riskScore(row),
      reasons: riskReasons(row),
    }));
  });
}

function riskScore(row) {
  let score = 0;
  if (row.days_remaining !== null && row.days_remaining < 0) score += 40;
  else if (row.days_remaining <= 7) score += 30;
  else if (row.days_remaining <= 30) score += 15;
  if (row.visits_30d === 0) score += 35;
  else if (row.visits_30d <= 3) score += 15;
  if (!row.last_payment) score += 15;
  return Math.min(100, score);
}

function riskReasons(row) {
  const reasons = [];
  if (row.days_remaining !== null && row.days_remaining < 0) reasons.push('Membership already expired');
  else if (row.days_remaining <= 7) reasons.push('Expires within a week');
  if (row.visits_30d === 0) reasons.push('No visits in the last 30 days');
  else if (row.visits_30d <= 3) reasons.push('Low attendance recently');
  if (!row.last_payment) reasons.push('No payment on record');
  return reasons;
}

/** Attendance pattern per weekday/hour - useful for staffing decisions. */
export async function attendanceInsights(tenantId, { weeks = 8 } = {}) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT extract(isodow FROM check_in_at)::int AS weekday,
              extract(hour FROM check_in_at)::int AS hour,
              count(*)::int AS visits
       FROM attendance
       WHERE tenant_id = $1 AND visit_date >= CURRENT_DATE - ($2 || ' weeks')::interval
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [tenantId, String(weeks)],
    );
    return res.rows;
  });
}

/** Plan popularity + renewal rate per plan. */
export async function planInsights(tenantId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT mp.id, mp.name, mp.price, mp.billing_cycle,
              count(ms.id)::int AS subscriptions,
              count(ms.id) FILTER (WHERE ms.status = 'active')::int AS active,
              count(ms.id) FILTER (WHERE ms.change_type = 'renewal')::int AS renewals,
              COALESCE(SUM(p.amount_paid), 0)::numeric AS revenue
       FROM membership_plans mp
       LEFT JOIN memberships ms ON ms.plan_id = mp.id
       LEFT JOIN payments p ON p.membership_id = ms.id AND p.status IN ('paid','partial')
       WHERE mp.tenant_id = $1
       GROUP BY mp.id ORDER BY revenue DESC`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      ...r,
      revenue: Number(r.revenue),
      renewalRate: r.subscriptions ? Math.round((r.renewals / r.subscriptions) * 100) : 0,
    }));
  });
}

/** Revenue currently owed, grouped by age bucket. */
export async function receivablesInsights(tenantId) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT CASE
                WHEN CURRENT_DATE - paid_at <= 7 THEN '0-7 days'
                WHEN CURRENT_DATE - paid_at <= 30 THEN '8-30 days'
                WHEN CURRENT_DATE - paid_at <= 60 THEN '31-60 days'
                ELSE '60+ days'
              END AS bucket,
              count(*)::int AS invoices,
              COALESCE(SUM(amount - amount_paid), 0)::numeric AS outstanding
       FROM payments
       WHERE tenant_id = $1 AND status IN ('pending','partial')
       GROUP BY 1 ORDER BY min(paid_at)`,
      [tenantId],
    );
    return res.rows.map((r) => ({ ...r, outstanding: Number(r.outstanding) }));
  });
}

export const INSIGHT_ENDPOINTS = {
  finance: financeInsights,
  churn: churnRisk,
  attendance: attendanceInsights,
  plans: planInsights,
  receivables: receivablesInsights,
};

function delta(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// AI port (not implemented on purpose)
// ---------------------------------------------------------------------------

/**
 * The shape an AI provider must satisfy. Nothing in the app calls this until a
 * provider is registered, so there is no fake intelligence in the product:
 *
 *   registerAiProvider({
 *     name: 'openai',
 *     async answer({ question, tenantId, context }) { ... }
 *   })
 */
let aiProvider = null;

export function registerAiProvider(provider) {
  if (!provider || typeof provider.answer !== 'function') throw new Error('An AI provider needs an answer() function');
  aiProvider = provider;
}

export function aiProviderStatus() {
  return { configured: Boolean(aiProvider), name: aiProvider?.name ?? null };
}

export async function askAi({ tenantId, question, context }) {
  if (!aiProvider) {
    throw new ApiError(501, 'AI insights are not configured on this deployment', { code: 'NOT_CONFIGURED' });
  }
  return aiProvider.answer({ tenantId, question, context });
}
