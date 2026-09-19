import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, likePattern, resolveSort } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { toCsv } from '../../../utils/csv.js';
import { todayISO, toISODate, lastDays } from '../../../utils/dates.js';
import { randomToken } from '../../../utils/ids.js';

/**
 * Attendance.
 *
 * Built for the front desk: a single keystroke-driven check-in endpoint that
 * resolves a member by number, name, phone or QR token and returns the result
 * immediately. `checkin_token` is already stored per visit so QR scanning can be
 * added later without a schema change.
 */

const SORTABLE = {
  check_in_at: 'a.check_in_at',
  member: 'm.last_name, m.first_name',
  visit_date: 'a.visit_date',
};

export async function listAttendance(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [];
  const where = [`a.tenant_id = ${param(params, tenantId)}`];

  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(`(m.first_name ILIKE ${param(params, pattern)} OR m.last_name ILIKE ${param(params, pattern)}
      OR m.member_no ILIKE ${param(params, pattern)} OR (m.first_name || ' ' || m.last_name) ILIKE ${param(params, pattern)})`);
  }
  if (q.memberId) where.push(`a.member_id = ${param(params, q.memberId)}`);
  if (q.date) where.push(`a.visit_date = ${param(params, q.date)}`);
  if (q.from) where.push(`a.visit_date >= ${param(params, q.from)}`);
  if (q.to) where.push(`a.visit_date <= ${param(params, q.to)}`);
  if (q.openOnly === true || q.openOnly === 'true') where.push('a.check_out_at IS NULL');

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, SORTABLE, 'a.check_in_at DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT a.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no, m.photo_url, m.status AS member_status
         FROM attendance a JOIN members m ON m.id = a.member_id
         WHERE ${whereSql} ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM attendance a JOIN members m ON m.id = a.member_id WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapeVisit), pageMeta({ page, limit }, count.rows[0].total));
  });
}

/** One screen's worth of state for the reception desk. */
export async function dailySummary(tenantId, date = todayISO()) {
  return withTenant(tenantId, async (client) => {
    const [summary, recent, inside] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS checkins, count(DISTINCT member_id)::int AS unique_members,
                count(*) FILTER (WHERE check_out_at IS NULL)::int AS still_inside,
                min(check_in_at) AS first_check_in, max(check_in_at) AS last_check_in
         FROM attendance WHERE tenant_id = $1 AND visit_date = $2`,
        [tenantId, date],
      ),
      client.query(
        `SELECT a.id, a.check_in_at, a.check_out_at, concat(m.first_name, ' ', m.last_name) AS member_name,
                m.member_no, m.photo_url
         FROM attendance a JOIN members m ON m.id = a.member_id
         WHERE a.tenant_id = $1 AND a.visit_date = $2
         ORDER BY a.check_in_at DESC LIMIT 15`,
        [tenantId, date],
      ),
      client.query(
        `SELECT a.id, a.check_in_at, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no, m.photo_url
         FROM attendance a JOIN members m ON m.id = a.member_id
         WHERE a.tenant_id = $1 AND a.visit_date = $2 AND a.check_out_at IS NULL
         ORDER BY a.check_in_at DESC LIMIT 30`,
        [tenantId, date],
      ),
    ]);

    const hourly = await client.query(
      `SELECT extract(hour FROM check_in_at)::int AS hour, count(*)::int AS visits
       FROM attendance WHERE tenant_id = $1 AND visit_date = $2 GROUP BY 1 ORDER BY 1`,
      [tenantId, date],
    );

    return {
      date,
      ...summary.rows[0],
      recent: recent.rows,
      inside: inside.rows,
      hourly: hourly.rows,
    };
  });
}

/**
 * Check in by anything the desk has to hand: member number, phone, name or QR
 * token. Returns the visit plus enough member context to show on screen.
 */
export async function checkIn(tenantId, { query: rawQuery, memberId, method = 'manual' }, actor) {
  return withTenant(tenantId, async (client) => {
    const member = await resolveMember(client, tenantId, { query: rawQuery, memberId });

    const settings = await client.query('SELECT settings FROM tenants WHERE id = $1', [tenantId]);
    const allowMultiple = settings.rows[0]?.settings?.attendance?.allowMultipleCheckinsPerDay !== false;

    if (!allowMultiple) {
      const existing = await client.query(
        'SELECT id, check_in_at FROM attendance WHERE tenant_id = $1 AND member_id = $2 AND visit_date = CURRENT_DATE',
        [tenantId, member.id],
      );
      if (existing.rowCount) {
        return { alreadyCheckedIn: true, visit: shapeVisit({ ...existing.rows[0], ...member }) };
      }
    }

    if (['suspended'].includes(member.status)) {
      throw ApiError.forbidden(`${member.full_name} is suspended and cannot check in`);
    }

    const inserted = await client.query(
      `INSERT INTO attendance (tenant_id, member_id, check_in_at, visit_date, method, checkin_token, note, recorded_by)
       VALUES ($1, $2, now(), CURRENT_DATE, $3, $4, $5, $6) RETURNING *`,
      [tenantId, member.id, method, randomToken(12), null, actor?.userId ?? null],
    );

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'attendance.check_in', entity: 'attendance', entityId: inserted.rows[0].id,
      metadata: { memberNo: member.member_no, method },
    });

    const membership = await client.query(
      `SELECT plan_name, end_date, status FROM memberships
       WHERE member_id = $1 AND status IN ('active','frozen') ORDER BY end_date DESC LIMIT 1`,
      [member.id],
    );

    return {
      alreadyCheckedIn: false,
      visit: shapeVisit(inserted.rows[0]),
      member: {
        id: member.id,
        memberNo: member.member_no,
        fullName: member.full_name,
        photoUrl: member.photo_url,
        status: member.status,
        planName: membership.rows[0]?.plan_name ?? null,
        membershipEndDate: membership.rows[0]?.end_date ?? null,
        membershipStatus: membership.rows[0]?.status ?? 'none',
      },
    };
  });
}

export async function checkOut(tenantId, { attendanceId, memberId }, actor) {
  return withTenant(tenantId, async (client) => {
    let targetId = attendanceId;
    if (!targetId && memberId) {
      const open = await client.query(
        `SELECT id FROM attendance WHERE tenant_id = $1 AND member_id = $2 AND check_out_at IS NULL
         ORDER BY check_in_at DESC LIMIT 1`,
        [tenantId, memberId],
      );
      targetId = open.rows[0]?.id;
      if (!targetId) throw ApiError.badRequest('This member has no open visit');
    }
    if (!targetId) throw ApiError.badRequest('Provide attendanceId or memberId');

    const res = await client.query(
      `UPDATE attendance SET check_out_at = now()
       WHERE tenant_id = $1 AND id = $2 AND check_out_at IS NULL RETURNING *`,
      [tenantId, targetId],
    );
    if (!res.rows[0]) throw ApiError.badRequest('That visit is already closed');

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'attendance.check_out', entity: 'attendance', entityId: targetId,
    });
    return shapeVisit(res.rows[0]);
  });
}

export async function updateVisit(tenantId, attendanceId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const sets = [];
    const params = [tenantId, attendanceId];
    if (input.checkInAt) {
      params.push(new Date(input.checkInAt));
      sets.push(`check_in_at = $${params.length}`);
    }
    if (input.checkOutAt !== undefined) {
      params.push(input.checkOutAt ? new Date(input.checkOutAt) : null);
      sets.push(`check_out_at = $${params.length}`);
    }
    if (input.note !== undefined) {
      params.push(input.note);
      sets.push(`note = $${params.length}`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(
      `UPDATE attendance SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params,
    );
    if (!res.rows[0]) throw ApiError.notFound('Attendance record not found');

    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'attendance.updated', entity: 'attendance', entityId: attendanceId,
      metadata: { changed: Object.keys(input) },
    });
    return shapeVisit(res.rows[0]);
  });
}

export async function deleteVisit(tenantId, attendanceId, actor) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query('DELETE FROM attendance WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, attendanceId]);
    if (!res.rows[0]) throw ApiError.notFound('Attendance record not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'attendance.deleted', entity: 'attendance', entityId: attendanceId,
    });
    return { ok: true };
  });
}

/** Monthly statistics for the attendance report screen. */
export async function monthlyStats(tenantId, { months = 6 } = {}) {
  const count = Math.min(Number(months) || 6, 24);
  return withTenant(tenantId, async (client) => {
    const res = await client.query(
      `SELECT to_char(date_trunc('month', visit_date), 'YYYY-MM') AS month,
              count(*)::int AS visits,
              count(DISTINCT member_id)::int AS unique_members,
              count(DISTINCT visit_date)::int AS active_days
       FROM attendance
       WHERE tenant_id = $1 AND visit_date >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
       GROUP BY 1 ORDER BY 1`,
      [tenantId, String(count - 1)],
    );
    return res.rows.map((r) => ({
      ...r,
      averagePerDay: r.active_days ? Math.round((r.visits / r.active_days) * 10) / 10 : 0,
    }));
  });
}

export async function exportCsv(tenantId, q = {}) {
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
  params.push(10_000);

  const res = await withTenant(tenantId, (client) =>
    client.query(
      `SELECT m.member_no, concat(m.first_name, ' ', m.last_name) AS member_name,
              a.visit_date, a.check_in_at, a.check_out_at, a.method,
              EXTRACT(EPOCH FROM (COALESCE(a.check_out_at, now()) - a.check_in_at)) / 60 AS minutes
       FROM attendance a JOIN members m ON m.id = a.member_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.check_in_at DESC LIMIT $${params.length}`,
      params,
    ),
  );

  return toCsv(res.rows, [
    { key: 'member_no', header: 'Member No' },
    { key: 'member_name', header: 'Member' },
    { key: 'visit_date', header: 'Date' },
    { key: 'check_in_at', header: 'Check in' },
    { key: 'check_out_at', header: 'Check out' },
    { key: 'method', header: 'Method' },
    { key: 'minutes', header: 'Minutes', value: (r) => (r.minutes ? Math.round(Number(r.minutes)) : '') },
  ]);
}

// ---------------------------------------------------------------------------

async function resolveMember(client, tenantId, { query: rawQuery, memberId }) {
  if (memberId) {
    const res = await client.query(
      "SELECT id, member_no, first_name, last_name, photo_url, status, concat(first_name, ' ', last_name) AS full_name FROM members WHERE tenant_id = $1 AND id = $2",
      [tenantId, memberId],
    );
    if (!res.rows[0]) throw ApiError.notFound('Member not found');
    return res.rows[0];
  }

  const term = String(rawQuery || '').trim();
  if (!term) throw ApiError.badRequest('Search for a member to check in');

  const exact = await client.query(
    `SELECT id, member_no, first_name, last_name, photo_url, status, concat(first_name, ' ', last_name) AS full_name
     FROM members WHERE tenant_id = $1 AND (member_no = $2 OR phone = $2 OR lower(email) = lower($2)) LIMIT 1`,
    [tenantId, term],
  );
  if (exact.rows[0]) return exact.rows[0];

  const fuzzy = await client.query(
    `SELECT id, member_no, first_name, last_name, photo_url, status, concat(first_name, ' ', last_name) AS full_name
     FROM members
     WHERE tenant_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR (first_name || ' ' || last_name) ILIKE $2 OR member_no ILIKE $2)
     ORDER BY last_name LIMIT 6`,
    [tenantId, likePattern(term)],
  );
  if (fuzzy.rows.length === 1) return fuzzy.rows[0];
  if (fuzzy.rows.length > 1) {
    const err = ApiError.conflict('Several members match - pick one');
    err.details = { candidates: fuzzy.rows };
    throw err;
  }
  throw ApiError.notFound(`No member matches "${term}"`);
}

function shapeVisit(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name || row.full_name,
    memberNo: row.member_no,
    photoUrl: row.photo_url,
    memberStatus: row.member_status ?? row.status,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    visitDate: row.visit_date,
    method: row.method,
    note: row.note,
  };
}

export { lastDays, toISODate };
