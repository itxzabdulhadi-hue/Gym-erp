import { withTenant } from '../../db/index.js';
import { hasPermission } from '@erp/shared';
import { likePattern, param } from '../../utils/sql.js';

/**
 * Global search (Ctrl/Cmd+K).
 *
 * One request fans out to every entity the caller is allowed to see. Each
 * entity is permission-checked independently, so a trainer never sees payment
 * records in search results even though the endpoint is shared.
 */

const ENTITY_LIMIT = 6;

export async function globalSearch(tenantId, { query, permissions = [], limit = ENTITY_LIMIT }) {
  const term = String(query || '').trim();
  if (term.length < 2) return { query: term, results: {}, total: 0 };

  const pattern = likePattern(term);
  const perEntity = Math.min(Number(limit) || ENTITY_LIMIT, 20);

  const jobs = [];
  const push = (key, permission, sql) => {
    if (!hasPermission(permissions, permission)) return;
    jobs.push(
      withTenant(tenantId, (client) => client.query(sql, [tenantId, pattern, perEntity])).then((res) => [key, res.rows]),
    );
  };

  push(
    'members',
    'members.view',
    `SELECT id, member_no, first_name, last_name, status, phone, email, photo_url
     FROM members
     WHERE tenant_id = $1 AND (
        first_name ILIKE $2 OR last_name ILIKE $2 OR member_no ILIKE $2
        OR phone ILIKE $2 OR email ILIKE $2
        OR (first_name || ' ' || last_name) ILIKE $2
     )
     ORDER BY last_name, first_name LIMIT $3`,
  );

  push(
    'payments',
    'payments.view',
    `SELECT p.id, p.invoice_no, p.amount, p.status, p.paid_at, p.method,
            concat(m.first_name, ' ', m.last_name) AS member_name, p.member_id
     FROM payments p JOIN members m ON m.id = p.member_id
     WHERE p.tenant_id = $1 AND (p.invoice_no ILIKE $2 OR p.reference ILIKE $2 OR concat(m.first_name,' ',m.last_name) ILIKE $2)
     ORDER BY p.paid_at DESC LIMIT $3`,
  );

  push(
    'memberships',
    'memberships.view',
    `SELECT ms.id, ms.plan_name, ms.status, ms.start_date, ms.end_date, ms.member_id,
            concat(m.first_name, ' ', m.last_name) AS member_name
     FROM memberships ms JOIN members m ON m.id = ms.member_id
     WHERE ms.tenant_id = $1 AND (ms.plan_name ILIKE $2 OR concat(m.first_name,' ',m.last_name) ILIKE $2)
     ORDER BY ms.end_date ASC LIMIT $3`,
  );

  push(
    'trainers',
    'trainers.view',
    `SELECT id, first_name, last_name, specialization, email, phone, photo_url, status
     FROM trainers
     WHERE tenant_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR specialization ILIKE $2)
     ORDER BY last_name LIMIT $3`,
  );

  push(
    'workoutPlans',
    'workouts.view',
    `SELECT id, name, level, goal, is_active, trainer_id
     FROM workout_plans WHERE tenant_id = $1 AND (name ILIKE $2 OR goal ILIKE $2)
     ORDER BY updated_at DESC LIMIT $3`,
  );

  push(
    'expenses',
    'expenses.view',
    `SELECT id, title, category, amount, expense_date
     FROM expenses WHERE tenant_id = $1 AND (title ILIKE $2 OR vendor ILIKE $2 OR description ILIKE $2)
     ORDER BY expense_date DESC LIMIT $3`,
  );

  const settled = await Promise.allSettled(jobs);
  const results = {};
  let total = 0;
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    const [key, rows] = outcome.value;
    results[key] = rows;
    total += rows.length;
  }

  return { query: term, results, total };
}
