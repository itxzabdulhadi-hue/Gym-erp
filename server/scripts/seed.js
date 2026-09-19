#!/usr/bin/env node
/**
 * Development seed.
 *
 *   npm run seed            seed (or top up) the demo businesses
 *   npm run db:reset        drop everything, migrate, then seed
 *
 * Creates two tenants on purpose - "Titan Fitness" (dark red/black) and
 * "Elite Fitness" (bright blue/white) - so white-labelling and tenant isolation
 * can be verified by simply logging into the other business.
 *
 * The data is generated from a fixed seed, so it is identical on every run and
 * safe to use in demos and tests.
 */
import bcrypt from 'bcryptjs';
import config from '../src/config/env.js';
import { pool, closePool, migrate } from '../src/db/index.js';
import { provisionTenant, seedTheme, DEFAULT_TENANT_SETTINGS } from '../src/core/tenants/tenants.service.js';
import { ensurePresetThemes } from '../src/core/themes/themes.service.js';
import { updateBranding } from '../src/core/branding/branding.service.js';
import { setModules } from '../src/core/modules/modules.service.js';
import { MODULES, sanitizeTheme, THEME_PRESETS } from '@erp/shared';
import { addDays, todayISO, toISODate } from '../src/utils/dates.js';
import { memberNumber } from '../src/utils/ids.js';
import logger from '../src/utils/logger.js';

// ---------------------------------------------------------------------------
// Deterministic pseudo-random source so demos are reproducible.
// ---------------------------------------------------------------------------
let seedState = 20240101;
function random() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const chance = (p) => random() < p;

const FIRST_NAMES = ['Ahmed', 'Sara', 'Omar', 'Lina', 'Yusuf', 'Maya', 'Karim', 'Nour', 'Tariq', 'Hana', 'Bilal', 'Dina', 'Zaid', 'Rania', 'Fadi', 'Layla', 'Hassan', 'Aya', 'Marwan', 'Salma', 'James', 'Emma', 'Noah', 'Olivia', 'Liam', 'Ava', 'Lucas', 'Mia', 'Ethan', 'Zoe', 'Daniel', 'Grace', 'Ryan', 'Chloe', 'Adam', 'Ella'];
const LAST_NAMES = ['Hassan', 'Khan', 'Ali', 'Farouk', 'Nasser', 'Mansour', 'Rahman', 'Saleh', 'Ibrahim', 'Yousef', 'Smith', 'Johnson', 'Brown', 'Taylor', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore', 'Clark'];
const SPECIALIZATIONS = ['Strength & Conditioning', 'CrossFit', 'Yoga & Mobility', 'Bodybuilding', 'HIIT', 'Boxing', 'Personal Training', 'Nutrition Coaching'];

async function main() {
  logger.info('seed', 'ensuring schema is up to date');
  await migrate({ logger: { log: () => {} } });

  const password = config.SEED_OWNER_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 11);

  const titan = await ensureTenant({
    slug: config.DEMO_TENANT_SLUG,
    name: 'Titan Fitness',
    shortName: 'TITAN',
    vertical: 'gym',
    themeName: 'Titan Fitness',
    branding: {
      tagline: 'Forge your strongest self',
      description: 'Strength, conditioning and personal training under one roof.',
      email: 'hello@titanfitness.test',
      phone: '+1 555 010 2030',
      address: '48 Ironworks Avenue',
      city: 'Austin',
      country: 'United States',
      website: 'https://titanfitness.test',
      currency: 'USD',
      currencySymbol: '$',
      themeColor: '#dc2626',
      backgroundColor: '#0a0a0a',
      socialLinks: { instagram: 'https://instagram.com/titanfitness', x: 'https://x.com/titanfitness' },
    },
  });

  const elite = await ensureTenant({
    slug: 'elite-fitness',
    name: 'Elite Fitness',
    shortName: 'ELITE',
    vertical: 'gym',
    themeName: 'Elite Fitness',
    branding: {
      tagline: 'Train elite, live well',
      description: 'Premium wellness club with classes, spa and coaching.',
      email: 'welcome@elitefitness.test',
      phone: '+44 20 7946 0821',
      address: '12 Harbour Court',
      city: 'London',
      country: 'United Kingdom',
      website: 'https://elitefitness.test',
      currency: 'GBP',
      currencySymbol: '£',
      themeColor: '#2563eb',
      backgroundColor: '#f8fafc',
    },
    modulesToDisable: ['progress', 'workouts'],
  });

  logger.info('seed', `seeding demo data for ${titan.slug}`);
  const titanSummary = await seedBusiness(titan.id, { memberCount: 36, deep: true, passwordHash });

  logger.info('seed', `seeding demo data for ${elite.slug}`);
  const eliteSummary = await seedBusiness(elite.id, { memberCount: 8, deep: false, passwordHash });

  // eslint-disable-next-line no-console
  console.log(`
Seed complete.

  Business      Code            Theme            Owner login
  -------------------------------------------------------------------
  Titan Fitness ${titan.slug.padEnd(15)} Titan Fitness    ${config.SEED_OWNER_EMAIL}
  Elite Fitness ${elite.slug.padEnd(15)} Elite Fitness    owner@elitefitness.test

  Password for every demo account: ${password}

  Titan Fitness: ${titanSummary.members} members, ${titanSummary.payments} payments, ${titanSummary.attendance} visits, ${titanSummary.expenses} expenses
  Elite Fitness: ${eliteSummary.members} members, ${eliteSummary.payments} payments, ${eliteSummary.attendance} visits, ${eliteSummary.expenses} expenses

  Other demo logins on ${titan.slug}: manager@demogym.test, front@demogym.test,
  coach@demogym.test (trainer), books@demogym.test (accountant)
`);
}

async function ensureTenant({ slug, name, shortName, vertical, themeName, branding, modulesToDisable = [] }) {
  let tenant = (await pool.query('SELECT * FROM tenants WHERE slug = $1', [slug])).rows[0];

  if (!tenant) {
    tenant = await provisionTenant({ name, slug, vertical });
  }

  await updateBranding(tenant.id, { businessName: name, shortName, appName: shortName, browserTitle: `${name} · Management`, ...branding });

  const preset = THEME_PRESETS.find((p) => p.name === themeName);
  const existing = (await pool.query('SELECT * FROM themes WHERE tenant_id = $1 AND name = $2', [tenant.id, themeName])).rows[0];
  if (!existing) {
    await seedTheme(pool, tenant.id, {
      name: themeName,
      description: preset?.description ?? 'Seeded theme',
      config: sanitizeTheme(preset?.config ?? THEME_PRESETS[0].config),
    });
  }
  await ensurePresetThemes(tenant.id, ['Default', 'Midnight', 'Modern Blue', 'Luxury']);
  await pool.query('UPDATE themes SET is_active = (name = $2) WHERE tenant_id = $1', [tenant.id, themeName]);

  const enabled = MODULES.map((m) => m.key).filter((k) => !modulesToDisable.includes(k));
  await setModules(tenant.id, enabled, { userLabel: 'Seed script' });

  await pool.query('UPDATE tenants SET onboarded_at = now(), settings = $2 WHERE id = $1', [
    tenant.id,
    JSON.stringify({
      ...DEFAULT_TENANT_SETTINGS,
      payments: { ...DEFAULT_TENANT_SETTINGS.payments, currency: branding.currency || 'USD' },
    }),
  ]);

  return tenant;
}

async function seedBusiness(tenantId, { memberCount, deep, passwordHash }) {
  const summary = { members: 0, payments: 0, attendance: 0, expenses: 0, plans: 0, workouts: 0, progress: 0 };

  // ------------------------------------------------------------------ users
  const ownerEmail = tenantId === (await pool.query('SELECT id FROM tenants WHERE slug = $1', [config.DEMO_TENANT_SLUG])).rows[0]?.id
    ? config.SEED_OWNER_EMAIL
    : 'owner@elitefitness.test';

  await ensureUser(tenantId, ownerEmail, 'Alexandra Reyes', passwordHash, 'owner');

  if (deep) {
    await ensureUser(tenantId, 'manager@demogym.test', 'Marcus Bell', passwordHash, 'manager');
    await ensureUser(tenantId, 'front@demogym.test', 'Priya Nair', passwordHash, 'receptionist');
    await ensureUser(tenantId, 'coach@demogym.test', 'Diego Santos', passwordHash, 'trainer');
    await ensureUser(tenantId, 'books@demogym.test', 'Hannah Kim', passwordHash, 'accountant');
  }

  // --------------------------------------------------------------- trainers
  const trainerIds = [];
  const trainerNames = deep
    ? [['Diego', 'Santos'], ['Amira', 'Haddad'], ['Victor', 'Petrov']]
    : [['Sofia', 'Marchetti']];

  for (const [first, last] of trainerNames) {
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${tenantId.slice(0, 8)}.test`;
    const userRow = (await pool.query('SELECT id FROM users WHERE tenant_id = $1 AND email = $2', [tenantId, email])).rows[0];
    const inserted = await pool.query(
      `INSERT INTO trainers (tenant_id, user_id, first_name, last_name, email, phone, specialization, bio, hire_date, salary, commission_rate, schedule, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
       ON CONFLICT (tenant_id, lower(email)) DO UPDATE SET specialization = EXCLUDED.specialization
       RETURNING id`,
      [
        tenantId, userRow?.id ?? null, first, last, email, `+1 555 0${int(10, 99)} ${int(1000, 9999)}`,
        pick(SPECIALIZATIONS),
        `${int(3, 14)} years of coaching experience. Focus: ${pick(SPECIALIZATIONS).toLowerCase()}.`,
        addDays(todayISO(), -int(120, 1400)),
        int(2200, 4800),
        int(3, 12),
        JSON.stringify([
          { day: 'monday', from: '06:00', to: '14:00' },
          { day: 'wednesday', from: '06:00', to: '14:00' },
          { day: 'friday', from: '14:00', to: '21:00' },
        ]),
      ],
    );
    trainerIds.push(inserted.rows[0].id);
  }

  // ------------------------------------------------------------------- plans
  const planDefs = [
    { name: 'Monthly', price: 49, cycle: 'monthly', days: 30, features: ['Gym floor access', 'Locker room', '1 guest pass / month'] },
    { name: 'Quarterly', price: 129, cycle: 'quarterly', days: 90, features: ['Gym floor access', 'Locker room', '3 guest passes', '1 PT session'] },
    { name: 'Half Yearly', price: 239, cycle: 'half_yearly', days: 182, features: ['Everything in Quarterly', '6 guest passes', '3 PT sessions', 'Nutrition consult'] },
    { name: 'Yearly', price: 429, cycle: 'yearly', days: 365, features: ['Everything in Half Yearly', 'Unlimited guest passes', '8 PT sessions', 'Body composition scans'] },
  ];
  if (deep) {
    planDefs.push({ name: 'Student', price: 29, cycle: 'monthly', days: 30, features: ['Off-peak access (10:00-16:00)', 'Locker room'] });
  }

  const planIds = [];
  for (const [index, plan] of planDefs.entries()) {
    const res = await pool.query(
      `INSERT INTO membership_plans (tenant_id, name, description, price, currency, billing_cycle, duration_days, features, access_rules, is_active, is_featured, sort_order)
       VALUES ($1,$2,$3,$4,'USD',$5,$6,$7,$8,true,$9,$10)
       ON CONFLICT (tenant_id, name) DO UPDATE SET price = EXCLUDED.price, features = EXCLUDED.features
       RETURNING id, name, duration_days, price`,
      [
        tenantId, plan.name, `${plan.name} membership`, plan.price, plan.cycle, plan.days,
        JSON.stringify(plan.features), JSON.stringify({ areas: ['gym', 'cardio'], classAccess: index >= 1, maxFreezeDays: 30 }),
        index === 3, index,
      ],
    );
    planIds.push(res.rows[0]);
    summary.plans += 1;
  }

  // ----------------------------------------------------------------- members
  const memberRows = [];
  for (let i = 0; i < memberCount; i += 1) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
    const joinOffset = -int(0, 540);
    const joinDate = addDays(todayISO(), joinOffset);

    const res = await pool.query(
      `INSERT INTO members (tenant_id, member_no, first_name, last_name, dob, gender, phone, email, address, city,
                            emergency_contact, emergency_phone, join_date, trainer_id, status, blood_group, occupation, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, $19)
       ON CONFLICT (tenant_id, member_no) DO UPDATE SET first_name = EXCLUDED.first_name
       RETURNING id, member_no, join_date, first_name, last_name`,
      [
        tenantId, memberNumber(1000 + i + 1), firstName, lastName,
        addDays(todayISO(), -int(6200, 15000)), pick(['male', 'female', 'male', 'female', 'unspecified']),
        `+1 555 ${int(100, 999)} ${int(1000, 9999)}`, email, `${int(1, 220)} ${pick(['Oak', 'Pine', 'Cedar', 'Maple', 'Harbour'])} ${pick(['Street', 'Road', 'Lane', 'Avenue'])}`,
        pick(['Austin', 'Round Rock', 'Pflugerville', 'Cedar Park']),
        `${pick(FIRST_NAMES)} ${lastName}`, `+1 555 ${int(100, 999)} ${int(1000, 9999)}`,
        joinDate, chance(0.75) ? pick(trainerIds) : null, 'active',
        pick(['O+', 'A+', 'B+', 'AB+', 'O-', 'A-']),
        pick(['Engineer', 'Teacher', 'Nurse', 'Designer', 'Student', 'Accountant', 'Trainer', 'Analyst']),
        chance(0.2) ? 'Referred by an existing member.' : null,
        `${joinDate}T09:0${int(0, 9)}:00Z`,
      ],
    );
    memberRows.push(res.rows[0]);
    summary.members += 1;
  }

  // ------------------------------------------------------------- memberships
  for (const [index, member] of memberRows.entries()) {
    const plan = planIds[index % planIds.length];
    // Stagger end dates so the dashboard has expiring / expired / active rows.
    const bucket = index % 10;
    let startDate;
    let endDate;
    if (bucket === 0) {
      endDate = addDays(todayISO(), -int(1, 20)); // expired
    } else if (bucket <= 2) {
      endDate = addDays(todayISO(), int(0, 6)); // expiring this week
    } else {
      endDate = addDays(todayISO(), int(7, plan.duration_days));
    }
    startDate = addDays(endDate, -plan.duration_days);
    const status = endDate < todayISO() ? 'expired' : 'active';
    const frozen = status === 'active' && chance(0.06);

    const ms = await pool.query(
      `INSERT INTO memberships (tenant_id, member_id, plan_id, plan_name, price, start_date, end_date, status, change_type, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9,$10) RETURNING id`,
      [
        tenantId, member.id, plan.id, plan.name, plan.price, startDate, endDate,
        frozen ? 'frozen' : status, frozen ? 'Travel - frozen for 30 days' : null,
        `${startDate}T10:00:00Z`,
      ],
    );

    // A renewal in the history for roughly a third of members.
    if (chance(0.33)) {
      const renewalStart = addDays(startDate, -plan.duration_days);
      await pool.query(
        `INSERT INTO memberships (tenant_id, member_id, plan_id, plan_name, price, start_date, end_date, status, change_type, previous_membership_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'expired','renewal',$8,$9)`,
        [tenantId, member.id, plan.id, plan.name, plan.price, renewalStart, addDays(startDate, -1), ms.rows[0].id, `${renewalStart}T10:00:00Z`],
      );
    }

    // ------------------------------------------------------------- payments
    const amount = Number(plan.price);
    const pending = status !== 'expired' && chance(0.12);
    const paidAmount = pending ? Math.round(amount * (chance(0.5) ? 0.5 : 0)) : amount;
    const payStatus = paidAmount === 0 ? 'pending' : paidAmount >= amount ? 'paid' : 'partial';

    await pool.query(
      `INSERT INTO payments (tenant_id, member_id, membership_id, invoice_no, amount, discount, amount_paid, currency, method, status, paid_at, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, invoice_no) DO NOTHING`,
      [
        tenantId, member.id, ms.rows[0].id, `INV-${new Date().getUTCFullYear()}-${String(1000 + index).padStart(5, '0')}`,
        amount, pending ? 0 : chance(0.1) ? 10 : 0, paidAmount, pick(['cash', 'card', 'card', 'bank_transfer', 'mobile_wallet']),
        payStatus, startDate, pending ? 'Awaiting transfer' : null, `${startDate}T11:00:00Z`,
      ],
    );
    summary.payments += 1;

    // Older payment for members with a renewal history.
    if (chance(0.4)) {
      const olderDate = addDays(startDate, -int(30, 200));
      await pool.query(
        `INSERT INTO payments (tenant_id, member_id, invoice_no, amount, discount, amount_paid, currency, method, status, paid_at, created_at)
         VALUES ($1,$2,$3,$4,0,$4,'USD',$5,'paid',$6,$7)
         ON CONFLICT (tenant_id, invoice_no) DO NOTHING`,
        [
          tenantId, member.id, `INV-${new Date(olderDate).getUTCFullYear()}-${String(5000 + index).padStart(5, '0')}`,
          amount, pick(['cash', 'card', 'bank_transfer']), olderDate, `${olderDate}T11:00:00Z`,
        ],
      );
      summary.payments += 1;
    }
  }

  // Sync member status with the memberships we just wrote.
  await pool.query(
    `WITH best AS (
       SELECT DISTINCT ON (m.id) m.id AS member_id, ms.status AS membership_status
       FROM members m
       LEFT JOIN LATERAL (SELECT status FROM memberships WHERE member_id = m.id AND status IN ('active','frozen') ORDER BY end_date DESC LIMIT 1) ms ON true
       WHERE m.tenant_id = $1
     )
     UPDATE members m SET status = CASE
       WHEN b.membership_status = 'frozen' THEN 'frozen'
       WHEN b.membership_status = 'active' THEN 'active'
       ELSE 'expired' END
     FROM best b WHERE m.id = b.member_id`,
    [tenantId],
  );
  await pool.query(`UPDATE members SET status = 'suspended' WHERE tenant_id = $1 AND member_no = $2`, [tenantId, memberNumber(1003)]);

  // --------------------------------------------------------------- attendance
  const daysBack = deep ? 90 : 21;
  const activeMembers = (await pool.query("SELECT id FROM members WHERE tenant_id = $1 AND status = 'active'", [tenantId])).rows;
  for (let day = daysBack; day >= 0; day -= 1) {
    const date = addDays(todayISO(), -day);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    // Weekends are quieter; Sundays quietest.
    const turnout = weekday === 0 ? 0.12 : weekday === 6 ? 0.22 : 0.42;
    for (const member of activeMembers) {
      if (!chance(turnout)) continue;
      const hour = pick([6, 7, 7, 8, 9, 12, 16, 17, 18, 19, 20]);
      const checkIn = `${date}T${String(hour).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00Z`;
      const minutes = int(35, 110);
      const checkOut = new Date(new Date(checkIn).getTime() + minutes * 60_000).toISOString();
      await pool.query(
        `INSERT INTO attendance (tenant_id, member_id, check_in_at, check_out_at, visit_date, method)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, member.id, checkIn, chance(0.85) ? checkOut : null, date, chance(0.2) ? 'qr' : 'manual'],
      );
      summary.attendance += 1;
    }
  }

  // ----------------------------------------------------------------- expenses
  const expenseDefs = [
    ['rent', 4200, 'Gym rent'],
    ['utilities', 640, 'Electricity & water'],
    ['salaries', 8600, 'Staff payroll'],
    ['equipment', 1850, 'Equipment maintenance'],
    ['marketing', 420, 'Social ads'],
    ['supplies', 260, 'Cleaning & supplies'],
    ['software', 129, 'Software subscriptions'],
  ];
  for (let month = 11; month >= 0; month -= 1) {
    for (const [category, base, title] of expenseDefs) {
      if (!deep && month > 3) continue;
      const day = addDays(todayISO(), -(month * 30) - int(1, 25));
      await pool.query(
        `INSERT INTO expenses (tenant_id, category, amount, expense_date, title, description, method, vendor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          tenantId, category, Math.round(base * (0.9 + random() * 0.25) * 100) / 100, day, title,
          `${title} for ${toISODate(day).slice(0, 7)}`, pick(['bank_transfer', 'bank_transfer', 'card', 'cash']),
          pick(['City Utilities', 'IronSupply Co', 'Payroll', 'MediaHouse', 'CleanPro']),
        ],
      );
      summary.expenses += 1;
    }
  }

  // ------------------------------------------------- exercises / plans / logs
  if (deep) {
    const exerciseDefs = [
      ['Barbell Back Squat', 'quadriceps', 'barbell', 'intermediate'],
      ['Romanian Deadlift', 'hamstrings', 'barbell', 'intermediate'],
      ['Bench Press', 'chest', 'barbell', 'intermediate'],
      ['Incline Dumbbell Press', 'chest', 'dumbbell', 'beginner'],
      ['Lat Pulldown', 'back', 'machine', 'beginner'],
      ['Seated Cable Row', 'back', 'cable', 'beginner'],
      ['Overhead Press', 'shoulders', 'barbell', 'intermediate'],
      ['Lateral Raise', 'shoulders', 'dumbbell', 'beginner'],
      ['Barbell Curl', 'biceps', 'barbell', 'beginner'],
      ['Triceps Rope Pushdown', 'triceps', 'cable', 'beginner'],
      ['Plank', 'core', 'bodyweight', 'beginner'],
      ['Hanging Leg Raise', 'core', 'bodyweight', 'intermediate'],
      ['Leg Press', 'quadriceps', 'machine', 'beginner'],
      ['Walking Lunge', 'glutes', 'dumbbell', 'beginner'],
      ['Hip Thrust', 'glutes', 'barbell', 'intermediate'],
      ['Standing Calf Raise', 'calves', 'machine', 'beginner'],
      ['Treadmill Intervals', 'cardio', 'cardio_machine', 'beginner'],
      ['Rowing Machine', 'cardio', 'cardio_machine', 'beginner'],
      ['Kettlebell Swing', 'full_body', 'kettlebell', 'intermediate'],
      ['Pull Up', 'back', 'bodyweight', 'advanced'],
    ];

    const exerciseIds = [];
    for (const [name, muscle, equipment, difficulty] of exerciseDefs) {
      const res = await pool.query(
        `INSERT INTO exercises (tenant_id, name, muscle_group, equipment, difficulty, instructions, media_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET muscle_group = EXCLUDED.muscle_group
         RETURNING id`,
        [
          tenantId, name, muscle, equipment, difficulty,
          `Brace your core, control the movement through the full range and breathe out on the effort. Target: ${muscle.replace('_', ' ')}.`,
          null,
        ],
      );
      exerciseIds.push(res.rows[0].id);
    }

    const planDefs2 = [
      ['Foundation Strength', 'beginner', 'Build a base of strength and technique', 0],
      ['Hypertrophy Push/Pull', 'intermediate', '4 day split for muscle growth', 1],
      ['Fat Loss Circuit', 'beginner', 'Conditioning focused full body circuit', 2],
      ['Athletic Performance', 'advanced', 'Power, speed and agility block', 0],
    ];

    for (const [name, level, goal, trainerIndex] of planDefs2) {
      const existingPlan = await pool.query(
        'SELECT id FROM workout_plans WHERE tenant_id = $1 AND name = $2',
        [tenantId, name],
      );
      let planId = existingPlan.rows[0]?.id;
      if (!planId) {
        const planRes = await pool.query(
          `INSERT INTO workout_plans (tenant_id, name, description, trainer_id, level, goal, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
          [tenantId, name, goal, trainerIds[trainerIndex] ?? trainerIds[0], level, goal],
        );
        planId = planRes.rows[0].id;
      } else {
        await pool.query('DELETE FROM workout_plan_items WHERE plan_id = $1', [planId]);
      }
      summary.workouts += 1;

      const chosen = [...exerciseIds].sort(() => random() - 0.5).slice(0, int(5, 7));
      let order = 0;
      for (const exerciseId of chosen) {
        order += 1;
        await pool.query(
          `INSERT INTO workout_plan_items (tenant_id, plan_id, exercise_id, sort_order, sets, reps, weight_kg, rest_sec, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tenantId, planId, exerciseId, order, int(3, 5), pick(['8-10', '10-12', '12-15', 'AMRAP']), int(20, 100), pick([60, 90, 120, 180]), null],
        );
      }

      // Assign to a few members.
      const assignees = memberRows.slice(order * 2, order * 2 + 3);
      for (const member of assignees) {
        const assigned = await pool.query(
          `INSERT INTO workout_assignments (tenant_id, plan_id, member_id, trainer_id, status, start_date)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [tenantId, planId, member.id, trainerIds[trainerIndex] ?? trainerIds[0], pick(['assigned', 'in_progress', 'completed']), addDays(todayISO(), -int(1, 60))],
        );
        for (let session = 0; session < int(1, 4); session += 1) {
          await pool.query(
            `INSERT INTO workout_logs (tenant_id, assignment_id, member_id, logged_at, data, notes)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              tenantId, assigned.rows[0].id, member.id,
              new Date(Date.now() - int(1, 30) * 86_400_000).toISOString(),
              JSON.stringify([{ sets: Array.from({ length: 3 }, () => ({ reps: int(8, 14), weightKg: int(20, 90) })) }]),
              chance(0.3) ? 'Felt strong, added weight.' : null,
            ],
          );
        }
      }
    }

    // -------------------------------------------------------- progress records
    for (const member of memberRows.slice(0, 14)) {
      const startWeight = int(58, 108) + random();
      const height = int(155, 195) + random() * 5;
      let weight = startWeight;
      for (let r = 0; r < int(3, 6); r += 1) {
        weight = Math.max(50, weight - random() * 2.2 + 0.3);
        const recordedAt = addDays(todayISO(), -(150 - r * 28));
        const bmi = Math.round((weight / ((height / 100) ** 2)) * 10) / 10;
        await pool.query(
          `INSERT INTO progress_records (tenant_id, member_id, recorded_at, weight_kg, height_cm, bmi, body_fat_pct, chest_cm, waist_cm, hips_cm, arms_cm, thighs_cm, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            tenantId, member.id, recordedAt, Math.round(weight * 10) / 10, Math.round(height * 10) / 10, bmi,
            Math.round((int(12, 30) - r) * 10) / 10, int(88, 112), int(70, 102), int(88, 112),
            int(28, 42), int(48, 66), chance(0.3) ? 'Feeling stronger each week.' : null,
          ],
        );
        summary.progress += 1;
      }
    }
  }

  // ----------------------------------------------------------- notifications
  await pool.query(
    `INSERT INTO notifications (tenant_id, type, title, body, level, data, created_at)
     VALUES ($1,'system',$2,$3,'info',$4, now())`,
    [
      tenantId,
      'Welcome aboard',
      'Your business is ready. Add members, create membership plans and start taking payments.',
      JSON.stringify({ source: 'seed' }),
    ],
  );

  return summary;
}

async function ensureUser(tenantId, email, fullName, passwordHash, roleKey) {
  const inserted = await pool.query(
    `INSERT INTO users (tenant_id, email, full_name, password_hash, status)
     VALUES ($1, lower($2), $3, $4, 'active')
     ON CONFLICT (tenant_id, lower(email)) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [tenantId, email, fullName, passwordHash],
  );
  const userId = inserted.rows[0].id;
  const role = (await pool.query('SELECT id FROM roles WHERE tenant_id = $1 AND key = $2', [tenantId, roleKey])).rows[0];
  if (role) {
    await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, role.id]);
  }
  return userId;
}

try {
  await main();
} catch (err) {
  console.error(`[seed] failed: ${err.message}`);
  if (err.position) console.error(`  postgres position: ${err.position}, detail: ${err.detail ?? '-'}`);
  console.error(err.stack?.split('\n').slice(1, 6).join('\n'));
  process.exitCode = 1;
} finally {
  await closePool();
}
