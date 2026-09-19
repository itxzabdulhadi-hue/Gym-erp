import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { toCsv } from '../../../utils/csv.js';
import { todayISO } from '../../../utils/dates.js';
import { EXPENSE_CATEGORY_LABELS } from '@erp/shared';

/** Expenses with category reporting. */

const SORTABLE = {
  expense_date: 'expense_date',
  amount: 'amount',
  category: 'category',
  created_at: 'created_at',
  title: 'title',
};

export async function listExpenses(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['e.tenant_id = $1'];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(title ILIKE ${param(params, pattern)} OR description ILIKE ${param(params, pattern)} OR vendor ILIKE ${param(params, pattern)})`);
  }
  if (q.category) where.push(`category = ${param(params, q.category)}`);
  if (q.method) where.push(`method = ${param(params, q.method)}`);
  if (q.from) where.push(`expense_date >= ${param(params, q.from)}`);
  if (q.to) where.push(`expense_date <= ${param(params, q.to)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, SORTABLE, 'expense_date DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count, totals] = await Promise.all([
      client.query(
        `SELECT e.*, u.full_name AS created_by_name
         FROM expenses e LEFT JOIN users u ON u.id = e.created_by
         WHERE ${whereSql} ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM expenses e WHERE ${whereSql}`, countParams),
      client.query(`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM expenses e WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapeExpense), pageMeta({ page, limit }, count.rows[0].total), {
      totals: { amount: Number(totals.rows[0].total) },
    });
  });
}

export async function getExpense(tenantId, expenseId) {
  const res = await withTenant(tenantId, (client) =>
    client.query('SELECT * FROM expenses WHERE tenant_id = $1 AND id = $2', [tenantId, expenseId]),
  );
  if (!res.rows[0]) throw ApiError.notFound('Expense not found');
  return shapeExpense(res.rows[0]);
}

export async function createExpense(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO expenses (tenant_id, category, amount, expense_date, title, description, method, vendor, attachment_url, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        tenantId, input.category || 'other', input.amount, input.expenseDate || todayISO(), input.title,
        input.description ?? null, input.method || 'cash', input.vendor ?? null,
        input.attachmentUrl ?? null, input.notes ?? null, actor?.userId ?? null,
      ],
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'expense.created', entity: 'expense', entityId: inserted.rows[0].id,
      metadata: { title: input.title, amount: input.amount, category: input.category },
    });
    return shapeExpense(inserted.rows[0]);
  });
}

export async function updateExpense(tenantId, expenseId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM expenses WHERE tenant_id = $1 AND id = $2', [tenantId, expenseId]);
    if (!current.rows[0]) throw ApiError.notFound('Expense not found');

    const columns = {
      category: 'category', amount: 'amount', expenseDate: 'expense_date', title: 'title',
      description: 'description', method: 'method', vendor: 'vendor', attachmentUrl: 'attachment_url', notes: 'notes',
    };
    const sets = [];
    const params = [tenantId, expenseId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(`UPDATE expenses SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'expense.updated', entity: 'expense', entityId: expenseId,
      metadata: { changedKeys: Object.keys(input) },
    });
    return shapeExpense(res.rows[0]);
  });
}

export async function deleteExpense(tenantId, expenseId, actor) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query('DELETE FROM expenses WHERE tenant_id = $1 AND id = $2 RETURNING title', [tenantId, expenseId]);
    if (!res.rows[0]) throw ApiError.notFound('Expense not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'expense.deleted', entity: 'expense', entityId: expenseId,
      metadata: { title: res.rows[0].title },
    });
    return { ok: true };
  });
}

export async function summary(tenantId, { from, to } = {}) {
  return withTenant(tenantId, async (client) => {
    const params = [tenantId];
    const where = ['e.tenant_id = $1'];
    if (from) {
      params.push(from);
      where.push(`expense_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`expense_date <= $${params.length}`);
    }
    const whereSql = where.join(' AND ');

    const [byCategory, byMonth, total] = await Promise.all([
      client.query(
        `SELECT category, count(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount
         FROM expenses e WHERE ${whereSql} GROUP BY category ORDER BY amount DESC`,
        params,
      ),
      client.query(
        `SELECT to_char(date_trunc('month', expense_date), 'YYYY-MM') AS month, COALESCE(SUM(amount),0)::numeric AS amount
         FROM expenses e WHERE ${whereSql} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      client.query(`SELECT COALESCE(SUM(amount),0)::numeric AS amount, count(*)::int AS count FROM expenses e WHERE ${whereSql}`, params),
    ]);

    return {
      total: Number(total.rows[0].amount),
      count: total.rows[0].count,
      byCategory: byCategory.rows.map((r) => ({
        category: r.category,
        label: EXPENSE_CATEGORY_LABELS[r.category] ?? r.category,
        count: r.count,
        amount: Number(r.amount),
      })),
      byMonth: byMonth.rows.map((r) => ({ month: r.month, amount: Number(r.amount) })),
    };
  });
}

export async function exportCsv(tenantId, q = {}) {
  const params = [tenantId];
  const where = ['e.tenant_id = $1'];
  if (q.from) {
    params.push(q.from);
    where.push(`expense_date >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`expense_date <= $${params.length}`);
  }
  params.push(10_000);
  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT expense_date, category, title, amount, method, vendor, description
       FROM expenses e WHERE ${where.join(' AND ')} ORDER BY expense_date DESC LIMIT $${params.length}`,
      params,
    ),
  );
  return toCsv(res.rows, [
    { key: 'expense_date', header: 'Date' },
    { key: 'category', header: 'Category' },
    { key: 'title', header: 'Title' },
    { key: 'amount', header: 'Amount' },
    { key: 'method', header: 'Method' },
    { key: 'vendor', header: 'Vendor' },
    { key: 'description', header: 'Description' },
  ]);
}

function shapeExpense(row) {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: EXPENSE_CATEGORY_LABELS[row.category] ?? row.category,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    title: row.title,
    description: row.description,
    method: row.method,
    vendor: row.vendor,
    attachmentUrl: row.attachment_url,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}
