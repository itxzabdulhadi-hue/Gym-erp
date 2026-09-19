-- ===========================================================================
-- 0002 · Gym vertical
-- Domain tables for the first product built on the platform. A new vertical
-- adds its own migration file; it never edits this one.
-- ===========================================================================

-- ----------------------------------------------------------------- trainers
CREATE TABLE trainers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Optional link to a login account for this trainer.
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text,
  phone           text,
  photo_url       text,
  specialization  text,
  bio             text,
  hire_date       date,
  salary          numeric(12,2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
  -- Percentage of referred member revenue, 0-100.
  commission_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  -- Weekly schedule, e.g. [{ "day": "monday", "from": "06:00", "to": "12:00" }]
  schedule        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A trainer login must be unique per business, but NULL emails are allowed.
CREATE UNIQUE INDEX trainers_email_unique_idx ON trainers (tenant_id, lower(email));
CREATE INDEX trainers_tenant_idx ON trainers (tenant_id, status);
CREATE INDEX trainers_name_idx ON trainers (tenant_id, last_name, first_name);

-- ------------------------------------------------------------------ members
CREATE TABLE members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_no          text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  dob                date,
  gender             text CHECK (gender IN ('male', 'female', 'other', 'unspecified')),
  phone              text,
  email              text,
  address            text,
  city               text,
  emergency_contact  text,
  emergency_phone    text,
  photo_url          text,
  join_date          date NOT NULL DEFAULT CURRENT_DATE,
  trainer_id         uuid REFERENCES trainers(id) ON DELETE SET NULL,
  -- Lifecycle state. 'active' / 'expired' are recomputed from memberships by
  -- the membership service; 'frozen', 'suspended', 'inactive' are manual.
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'inactive', 'expired', 'frozen', 'suspended')),
  blood_group        text,
  occupation         text,
  notes              text,
  -- Free form extension point so a tenant can capture vertical specific data
  -- without a migration.
  custom_fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_no_unique UNIQUE (tenant_id, member_no)
);

CREATE INDEX members_tenant_idx ON members (tenant_id, created_at DESC);
CREATE INDEX members_status_idx ON members (tenant_id, status);
CREATE INDEX members_trainer_idx ON members (tenant_id, trainer_id);
CREATE INDEX members_name_idx ON members (tenant_id, last_name, first_name);
CREATE INDEX members_phone_idx ON members (tenant_id, phone);
-- Fast global search without a full scan.
CREATE INDEX members_search_idx ON members USING gin (
  to_tsvector('simple', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(member_no, ''))
);

-- ---------------------------------------------------------- membership plans
CREATE TABLE membership_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  price         numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency      text NOT NULL DEFAULT 'USD',
  billing_cycle text NOT NULL DEFAULT 'monthly'
                  CHECK (billing_cycle IN ('monthly', 'quarterly', 'half_yearly', 'yearly', 'custom')),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  -- ["Free locker", "1 PT session / month"]
  features      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { "areas": ["gym","pool"], "classAccess": true, "maxFreezeDays": 30 }
  access_rules  jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  is_featured   boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX plans_tenant_idx ON membership_plans (tenant_id, is_active);

-- --------------------------------------------------------------- memberships
CREATE TABLE memberships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id        uuid REFERENCES membership_plans(id) ON DELETE SET NULL,
  -- Denormalised plan snapshot so history survives plan edits / deletion.
  plan_name      text NOT NULL,
  price          numeric(12,2) NOT NULL DEFAULT 0,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'frozen', 'cancelled', 'expired')),
  freeze_days    integer NOT NULL DEFAULT 0 CHECK (freeze_days >= 0),
  frozen_from    date,
  frozen_to      date,
  -- new | renewal | upgrade | downgrade
  change_type    text NOT NULL DEFAULT 'new',
  previous_membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  notes          text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_dates_valid CHECK (end_date >= start_date)
);

CREATE INDEX memberships_tenant_idx ON memberships (tenant_id, created_at DESC);
CREATE INDEX memberships_member_idx ON memberships (member_id, end_date DESC);
CREATE INDEX memberships_status_idx ON memberships (tenant_id, status);
CREATE INDEX memberships_end_date_idx ON memberships (tenant_id, end_date);

-- ---------------------------------------------------------------- attendance
CREATE TABLE attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  check_in_at  timestamptz NOT NULL,
  -- Local business date of the visit. Stored (not derived) because it must
  -- respect the tenant timezone and stay indexable/immutable.
  visit_date   date NOT NULL DEFAULT CURRENT_DATE,
  check_out_at timestamptz,
  method       text NOT NULL DEFAULT 'manual'
                 CHECK (method IN ('manual', 'qr', 'web', 'import')),
  -- Stable token per member, printed as a QR code for future scanning flows.
  checkin_token text,
  note         text,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_checkout_valid CHECK (check_out_at IS NULL OR check_out_at > check_in_at)
);

CREATE INDEX attendance_tenant_time_idx ON attendance (tenant_id, check_in_at DESC);
CREATE INDEX attendance_member_idx ON attendance (member_id, check_in_at DESC);
CREATE INDEX attendance_day_idx ON attendance (tenant_id, visit_date);

-- --------------------------------------------------------------- exercises
CREATE TABLE exercises (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  muscle_group text NOT NULL DEFAULT 'full_body',
  equipment    text NOT NULL DEFAULT 'none',
  difficulty   text NOT NULL DEFAULT 'beginner'
                 CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  instructions text,
  media_url    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX exercises_name_unique_idx ON exercises (tenant_id, lower(name));
CREATE INDEX exercises_tenant_idx ON exercises (tenant_id, muscle_group);

-- ------------------------------------------------------------ workout plans
CREATE TABLE workout_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  trainer_id  uuid REFERENCES trainers(id) ON DELETE SET NULL,
  level       text NOT NULL DEFAULT 'beginner'
                CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  goal        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workout_plans_tenant_idx ON workout_plans (tenant_id, is_active);
CREATE INDEX workout_plans_trainer_idx ON workout_plans (tenant_id, trainer_id);

CREATE TABLE workout_plan_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id      uuid NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  exercise_id  uuid NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  sort_order   integer NOT NULL DEFAULT 0,
  sets         integer CHECK (sets IS NULL OR sets > 0),
  reps         text,
  weight_kg    numeric(6,2) CHECK (weight_kg IS NULL OR weight_kg >= 0),
  duration_sec integer CHECK (duration_sec IS NULL OR duration_sec > 0),
  rest_sec     integer CHECK (rest_sec IS NULL OR rest_sec >= 0),
  notes        text
);

CREATE INDEX workout_plan_items_plan_idx ON workout_plan_items (plan_id, sort_order);

CREATE TABLE workout_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id      uuid NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trainer_id   uuid REFERENCES trainers(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'assigned'
                 CHECK (status IN ('assigned', 'in_progress', 'completed', 'archived')),
  start_date   date NOT NULL DEFAULT CURRENT_DATE,
  end_date     date,
  assigned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workout_assignments_member_idx ON workout_assignments (member_id, assigned_at DESC);
CREATE INDEX workout_assignments_tenant_idx ON workout_assignments (tenant_id, status);

-- Logged training sessions: [{ itemId, sets: [{reps, weight}], note }]
CREATE TABLE workout_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id  uuid REFERENCES workout_assignments(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  logged_at      timestamptz NOT NULL DEFAULT now(),
  data           jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes          text,
  logged_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX workout_logs_member_idx ON workout_logs (member_id, logged_at DESC);

-- ---------------------------------------------------------- progress records
CREATE TABLE progress_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  recorded_at  date NOT NULL DEFAULT CURRENT_DATE,
  weight_kg    numeric(6,2) CHECK (weight_kg IS NULL OR weight_kg > 0),
  height_cm    numeric(5,1) CHECK (height_cm IS NULL OR height_cm > 0),
  -- Stored (not generated) because it is also used in reports without recompute.
  bmi          numeric(5,2) CHECK (bmi IS NULL OR bmi > 0),
  body_fat_pct numeric(4,1) CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 80)),
  chest_cm     numeric(5,1),
  waist_cm     numeric(5,1),
  hips_cm      numeric(5,1),
  arms_cm      numeric(5,1),
  thighs_cm    numeric(5,1),
  neck_cm      numeric(5,1),
  photo_urls   jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes        text,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX progress_member_idx ON progress_records (member_id, recorded_at DESC);
CREATE INDEX progress_tenant_idx ON progress_records (tenant_id, recorded_at DESC);

-- ------------------------------------------------------------------ payments
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  membership_id  uuid REFERENCES memberships(id) ON DELETE SET NULL,
  invoice_no     text NOT NULL,
  amount         numeric(12,2) NOT NULL CHECK (amount >= 0),
  discount       numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  amount_paid    numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  currency       text NOT NULL DEFAULT 'USD',
  method         text NOT NULL DEFAULT 'cash'
                   CHECK (method IN ('cash', 'card', 'bank_transfer', 'mobile_wallet', 'cheque', 'other')),
  status         text NOT NULL DEFAULT 'paid'
                   CHECK (status IN ('paid', 'pending', 'partial', 'refunded')),
  paid_at        date NOT NULL DEFAULT CURRENT_DATE,
  reference      text,
  notes          text,
  received_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  refunded_at    timestamptz,
  refunded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  refund_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_invoice_unique UNIQUE (tenant_id, invoice_no),
  CONSTRAINT payments_amounts_valid CHECK (amount_paid <= amount)
);

CREATE INDEX payments_tenant_idx ON payments (tenant_id, paid_at DESC);
CREATE INDEX payments_member_idx ON payments (member_id, paid_at DESC);
CREATE INDEX payments_status_idx ON payments (tenant_id, status);

-- ------------------------------------------------------------------ expenses
CREATE TABLE expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category       text NOT NULL DEFAULT 'other'
                   CHECK (category IN ('rent', 'utilities', 'salaries', 'equipment', 'maintenance', 'marketing', 'supplies', 'software', 'other')),
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  expense_date   date NOT NULL DEFAULT CURRENT_DATE,
  title          text NOT NULL,
  description    text,
  method         text NOT NULL DEFAULT 'cash'
                   CHECK (method IN ('cash', 'card', 'bank_transfer', 'mobile_wallet', 'cheque', 'other')),
  vendor         text,
  attachment_url text,
  notes          text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expenses_tenant_idx ON expenses (tenant_id, expense_date DESC);
CREATE INDEX expenses_category_idx ON expenses (tenant_id, category);

-- ------------------------------------------------------------- member files
CREATE TABLE member_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  file_id     uuid REFERENCES files(id) ON DELETE CASCADE,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX member_documents_member_idx ON member_documents (member_id);

CREATE TRIGGER members_touch BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER plans_touch BEFORE UPDATE ON membership_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER memberships_touch BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trainers_touch BEFORE UPDATE ON trainers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER exercises_touch BEFORE UPDATE ON exercises FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workout_plans_touch BEFORE UPDATE ON workout_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER expenses_touch BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
