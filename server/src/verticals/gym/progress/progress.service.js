import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { param, resolveSort } from '../../../utils/sql.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { todayISO } from '../../../utils/dates.js';

/**
 * Progress tracking: body metrics + photos over time.
 * BMI is derived from height/weight when both are present so it is always
 * consistent with the recorded measurements.
 */

export function computeBmi(weightKg, heightCm) {
  const w = Number(weightKg);
  const h = Number(heightCm) / 100;
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return Math.round((w / (h * h)) * 10) / 10;
}

export async function listRecords(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId];
  const where = ['pr.tenant_id = $1'];

  if (q.memberId) where.push(`pr.member_id = ${param(params, q.memberId)}`);
  if (q.from) where.push(`pr.recorded_at >= ${param(params, q.from)}`);
  if (q.to) where.push(`pr.recorded_at <= ${param(params, q.to)}`);

  const whereSql = where.join(' AND ');
  const orderSql = resolveSort(q.sort, q.order, { recorded_at: 'pr.recorded_at', weight_kg: 'pr.weight_kg', created_at: 'pr.created_at' }, 'pr.recorded_at DESC');

  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT pr.*, concat(m.first_name, ' ', m.last_name) AS member_name, m.member_no
         FROM progress_records pr JOIN members m ON m.id = pr.member_id
         WHERE ${whereSql} ORDER BY ${orderSql}
         LIMIT ${param(params, limit)} OFFSET ${param(params, offset)}`,
        params,
      ),
      client.query(`SELECT count(*)::int AS total FROM progress_records pr WHERE ${whereSql}`, countParams),
    ]);
    return listResponse(rows.rows.map(shapeRecord), pageMeta({ page, limit }, count.rows[0].total));
  });
}

/** Latest record per member - powers the progress overview table. */
export async function latestPerMember(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const params = [tenantId, limit, offset];
  return withTenant(tenantId, async (client) => {
    const countParams = [...params];
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT DISTINCT ON (m.id) m.id AS member_id, m.member_no, concat(m.first_name, ' ', m.last_name) AS member_name,
                m.photo_url, pr.*
         FROM members m
         JOIN progress_records pr ON pr.member_id = m.id
         WHERE m.tenant_id = $1
         ORDER BY m.id, pr.recorded_at DESC
         LIMIT $2 OFFSET $3`,
        params,
      ),
      client.query('SELECT count(DISTINCT member_id)::int AS total FROM progress_records WHERE tenant_id = $1', [tenantId]),
    ]);
    return listResponse(rows.rows.map((r) => ({ ...shapeRecord(r), memberId: r.member_id, memberNo: r.member_no, memberName: r.member_name })), pageMeta({ page, limit }, count.rows[0].total));
  });
}

export async function memberTimeline(tenantId, memberId) {
  const res = await withTenant(tenantId, (client) =>
    client.query('SELECT * FROM progress_records WHERE tenant_id = $1 AND member_id = $2 ORDER BY recorded_at ASC', [tenantId, memberId]),
  );
  const records = res.rows.map(shapeRecord);
  if (!records.length) return { records, change: null };

  const first = records[0];
  const last = records[records.length - 1];
  const diff = (key) => (first[key] !== null && last[key] !== null ? Math.round((last[key] - first[key]) * 10) / 10 : null);

  return {
    records,
    change: {
      weightKg: diff('weightKg'),
      bodyFatPct: diff('bodyFatPct'),
      bmi: diff('bmi'),
      waistCm: diff('waistCm'),
      chestCm: diff('chestCm'),
      armsCm: diff('armsCm'),
    },
  };
}

export async function createRecord(tenantId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const member = await client.query('SELECT id FROM members WHERE tenant_id = $1 AND id = $2', [tenantId, input.memberId]);
    if (!member.rows[0]) throw ApiError.notFound('Member not found');

    const bmi = input.bmi ?? computeBmi(input.weightKg, input.heightCm);

    const res = await client.query(
      `INSERT INTO progress_records (tenant_id, member_id, recorded_at, weight_kg, height_cm, bmi, body_fat_pct,
                                     chest_cm, waist_cm, hips_cm, arms_cm, thighs_cm, neck_cm, photo_urls, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        tenantId, input.memberId, input.recordedAt || todayISO(), input.weightKg ?? null, input.heightCm ?? null,
        bmi, input.bodyFatPct ?? null, input.chestCm ?? null, input.waistCm ?? null, input.hipsCm ?? null,
        input.armsCm ?? null, input.thighsCm ?? null, input.neckCm ?? null,
        JSON.stringify(input.photoUrls || []), input.notes ?? null, actor?.userId ?? null,
      ],
    );
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'progress.created', entity: 'progress_record', entityId: res.rows[0].id,
      metadata: { recordedAt: res.rows[0].recorded_at, weightKg: input.weightKg ?? null },
    });
    return shapeRecord(res.rows[0]);
  });
}

export async function updateRecord(tenantId, recordId, input, actor) {
  return withTenant(tenantId, async (client) => {
    const current = await client.query('SELECT * FROM progress_records WHERE tenant_id = $1 AND id = $2', [tenantId, recordId]);
    if (!current.rows[0]) throw ApiError.notFound('Progress record not found');

    const merged = { ...current.rows[0] };
    const columns = {
      recordedAt: 'recorded_at', weightKg: 'weight_kg', heightCm: 'height_cm', bodyFatPct: 'body_fat_pct',
      chestCm: 'chest_cm', waistCm: 'waist_cm', hipsCm: 'hips_cm', armsCm: 'arms_cm',
      thighsCm: 'thighs_cm', neckCm: 'neck_cm', notes: 'notes',
    };
    const sets = [];
    const params = [tenantId, recordId];
    for (const [key, column] of Object.entries(columns)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (input.photoUrls !== undefined) {
      params.push(JSON.stringify(input.photoUrls));
      sets.push(`photo_urls = $${params.length}::jsonb`);
    }

    const weight = input.weightKg !== undefined ? input.weightKg : merged.weight_kg;
    const height = input.heightCm !== undefined ? input.heightCm : merged.height_cm;
    const bmi = computeBmi(weight, height);
    if (bmi !== null) {
      params.push(bmi);
      sets.push(`bmi = $${params.length}`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const res = await client.query(`UPDATE progress_records SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`, params);
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'progress.updated', entity: 'progress_record', entityId: recordId,
      metadata: { changedKeys: Object.keys(input) },
    });
    return shapeRecord(res.rows[0]);
  });
}

export async function deleteRecord(tenantId, recordId, actor) {
  return withTenant(tenantId, async (client) => {
    const res = await client.query('DELETE FROM progress_records WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, recordId]);
    if (!res.rows[0]) throw ApiError.notFound('Progress record not found');
    await logAudit(client, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'progress.deleted', entity: 'progress_record', entityId: recordId,
    });
    return { ok: true };
  });
}

function shapeRecord(row) {
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberNo: row.member_no,
    recordedAt: row.recorded_at,
    weightKg: num(row.weight_kg),
    heightCm: num(row.height_cm),
    bmi: num(row.bmi),
    bodyFatPct: num(row.body_fat_pct),
    chestCm: num(row.chest_cm),
    waistCm: num(row.waist_cm),
    hipsCm: num(row.hips_cm),
    armsCm: num(row.arms_cm),
    thighsCm: num(row.thighs_cm),
    neckCm: num(row.neck_cm),
    photoUrls: row.photo_urls || [],
    notes: row.notes,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
  };
}
