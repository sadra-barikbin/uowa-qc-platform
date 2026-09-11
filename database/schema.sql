-- University QC Platform
-- PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS & AUTH
-- ============================================================
-- admin    = QC unit staff running the monthly evaluation (full control)
-- qc_head  = head of the QC department (oversight, read/approve everything)
-- dept_rep = faculty department representative (uploads evidence for their own department only)
-- viewer   = read-only access to published reports
CREATE TYPE user_role AS ENUM ('admin', 'qc_head', 'dept_rep', 'viewer');

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    full_name   VARCHAR(255) NOT NULL,
    full_name_ar VARCHAR(255),
    role        user_role NOT NULL DEFAULT 'viewer',
    is_active   BOOLEAN DEFAULT TRUE,
    avatar_url  VARCHAR(500),
    last_login  TIMESTAMP,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- COLLEGES & DEPARTMENTS
-- ============================================================
CREATE TABLE colleges (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_en     VARCHAR(255) NOT NULL,
    name_ar     VARCHAR(255) NOT NULL,
    code        VARCHAR(50) UNIQUE NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE departments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    college_id        UUID REFERENCES colleges(id) ON DELETE CASCADE,
    name_en           VARCHAR(255) NOT NULL,
    name_ar           VARCHAR(255) NOT NULL,
    code              VARCHAR(50) UNIQUE NOT NULL,
    -- reference link to the department's current shared-drive folder, kept during the
    -- transition away from manual Drive-based submission
    drive_folder_url  VARCHAR(1000),
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

-- Faculty representatives (and other users) assigned to a department
CREATE TABLE department_users (
    department_id   UUID REFERENCES departments(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    is_primary_contact BOOLEAN DEFAULT FALSE,
    assigned_at     TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (department_id, user_id)
);

-- ============================================================
-- INDICATORS (dynamic, reusable definitions)
-- ============================================================
CREATE TABLE indicators (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50) UNIQUE NOT NULL,
    name_en         VARCHAR(255) NOT NULL,
    name_ar         VARCHAR(255) NOT NULL,
    description_en  TEXT,
    description_ar  TEXT,
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- checklist = yes/no evidence item (score 0 or 1)
-- percentage = reviewer enters a 0-100% completion directly
-- ratio      = score derived from two raw numbers (e.g. submitted/required, capped at 1)
-- score_100  = reviewer/AI enters a raw 0-100 score (e.g. average survey rating)
CREATE TYPE criterion_type AS ENUM ('checklist', 'percentage', 'ratio', 'score_100');

CREATE TABLE indicator_criteria (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    indicator_id      UUID REFERENCES indicators(id) ON DELETE CASCADE,
    code              VARCHAR(50) NOT NULL,
    name_en           VARCHAR(255) NOT NULL,
    name_ar           VARCHAR(255) NOT NULL,
    description_en    TEXT,
    description_ar    TEXT,
    criterion_type    criterion_type NOT NULL DEFAULT 'checklist',
    weight            DECIMAL(5,4) NOT NULL DEFAULT 1.0,  -- relative weight within the indicator
    -- e.g. for 'ratio' criteria: {"numerator_label_ar": "...", "denominator_label_ar": "..."}
    config            JSONB DEFAULT '{}',
    requires_evidence BOOLEAN DEFAULT TRUE,
    sort_order        INTEGER DEFAULT 0,
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW(),
    UNIQUE(indicator_id, code)
);

-- ============================================================
-- EVALUATION PERIODS (monthly cycles)
-- ============================================================
CREATE TYPE period_status AS ENUM ('draft', 'open', 'under_review', 'published', 'closed');

CREATE TABLE evaluation_periods (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year                INTEGER NOT NULL,
    month               INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    label_en            VARCHAR(100),
    label_ar            VARCHAR(100),
    status              period_status NOT NULL DEFAULT 'draft',
    submission_deadline TIMESTAMP,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(year, month)
);

-- Which indicators apply to a given period, and their weight in that period's
-- composite score (indicators are dynamic — the set/weights can change month to month)
CREATE TABLE period_indicators (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id     UUID REFERENCES evaluation_periods(id) ON DELETE CASCADE,
    indicator_id  UUID REFERENCES indicators(id) ON DELETE CASCADE,
    weight        DECIMAL(5,4) NOT NULL DEFAULT 1.0,  -- contribution to the department's final score
    sort_order    INTEGER DEFAULT 0,
    is_active     BOOLEAN DEFAULT TRUE,
    UNIQUE(period_id, indicator_id)
);

-- ============================================================
-- SUBMISSIONS (department evidence per criterion per period)
-- ============================================================
CREATE TYPE submission_status AS ENUM ('pending', 'submitted', 'needs_revision', 'reviewed');

CREATE TABLE submissions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id     UUID REFERENCES evaluation_periods(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    criterion_id  UUID REFERENCES indicator_criteria(id) ON DELETE CASCADE,
    status        submission_status NOT NULL DEFAULT 'pending',
    notes         TEXT,
    submitted_by  UUID REFERENCES users(id),
    submitted_at  TIMESTAMP,
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(period_id, department_id, criterion_id)
);

CREATE TYPE storage_provider AS ENUM ('local', 'google_drive');

CREATE TABLE submission_documents (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id     UUID REFERENCES submissions(id) ON DELETE CASCADE,
    file_name         VARCHAR(500) NOT NULL,
    storage_provider  storage_provider NOT NULL DEFAULT 'local',
    storage_path      VARCHAR(1000) NOT NULL,  -- local path, or a Drive file id/url
    mime_type         VARCHAR(100),
    size_bytes        INTEGER,
    uploaded_by       UUID REFERENCES users(id),
    uploaded_at       TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- EVALUATIONS (reviewer or AI score per department per criterion per period)
-- ============================================================
CREATE TYPE evaluation_method AS ENUM ('manual', 'ai');

CREATE TABLE evaluations (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id         UUID REFERENCES evaluation_periods(id) ON DELETE CASCADE,
    department_id     UUID REFERENCES departments(id) ON DELETE CASCADE,
    criterion_id      UUID REFERENCES indicator_criteria(id) ON DELETE CASCADE,
    submission_id     UUID REFERENCES submissions(id),  -- evidence this score was based on, if any
    score             DECIMAL(5,4) CHECK (score BETWEEN 0 AND 1),  -- NULL = not yet evaluated
    raw_values        JSONB DEFAULT '{}',  -- e.g. {"numerator": 8, "denominator": 12} for ratio criteria
    reviewer_notes    TEXT,
    evaluated_by      UUID REFERENCES users(id),  -- NULL when evaluation_method = 'ai'
    evaluation_method evaluation_method NOT NULL DEFAULT 'manual',
    ai_confidence     DECIMAL(5,4),
    ai_rationale      TEXT,
    evaluated_at      TIMESTAMP,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW(),
    UNIQUE(period_id, department_id, criterion_id)
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TYPE notification_type AS ENUM ('missing_submission', 'deadline', 'review_needed', 'evaluation_complete', 'system', 'reminder');

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    department_id   UUID REFERENCES departments(id),
    period_id       UUID REFERENCES evaluation_periods(id),
    type            notification_type NOT NULL,
    title_en        VARCHAR(500) NOT NULL,
    title_ar        VARCHAR(500),
    message_en      TEXT,
    message_ar      TEXT,
    is_read         BOOLEAN DEFAULT FALSE,
    priority        VARCHAR(20) DEFAULT 'normal',  -- low | normal | high | urgent
    action_url      VARCHAR(500),
    created_at      TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id),
    action      VARCHAR(100) NOT NULL,
    table_name  VARCHAR(100),
    record_id   UUID,
    old_values  JSONB,
    new_values  JSONB,
    ip_address  INET,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AGGREGATION VIEWS
-- mirror the "تقييم شامل" (per-department) and "التقييم الكلية" (per-college) report sheets
-- ============================================================

-- weighted score of each indicator, per department, per period
CREATE VIEW indicator_scores AS
SELECT
    pi.period_id,
    d.id AS department_id,
    pi.indicator_id,
    -- NULL until at least one of this indicator's criteria has actually been evaluated,
    -- so "nobody has reviewed this yet" reads differently from "reviewed and scored 0"
    CASE WHEN COUNT(e.score) = 0 THEN NULL
         WHEN SUM(ic.weight) > 0 THEN SUM(COALESCE(e.score, 0) * ic.weight) / SUM(ic.weight)
         ELSE NULL END AS score,
    COUNT(ic.id) AS criteria_total,
    COUNT(e.score) AS criteria_scored
FROM period_indicators pi
JOIN indicator_criteria ic ON ic.indicator_id = pi.indicator_id AND ic.is_active = TRUE
CROSS JOIN departments d
LEFT JOIN evaluations e
    ON e.criterion_id = ic.id AND e.period_id = pi.period_id AND e.department_id = d.id
WHERE pi.is_active = TRUE AND d.is_active = TRUE
GROUP BY pi.period_id, d.id, pi.indicator_id;

-- final weighted score per department per period ("تقييم شامل")
CREATE VIEW department_period_scores AS
SELECT
    isr.period_id,
    isr.department_id,
    -- same rule one level up: NULL until at least one indicator has a score
    CASE WHEN COUNT(isr.score) = 0 THEN NULL
         WHEN SUM(pi.weight) > 0 THEN SUM(COALESCE(isr.score, 0) * pi.weight) / SUM(pi.weight)
         ELSE NULL END AS final_score
FROM indicator_scores isr
JOIN period_indicators pi ON pi.period_id = isr.period_id AND pi.indicator_id = isr.indicator_id
GROUP BY isr.period_id, isr.department_id;

-- college rollup = average of its departments' final scores ("التقييم الكلية")
CREATE VIEW college_period_scores AS
SELECT
    dps.period_id,
    d.college_id,
    AVG(dps.final_score) AS avg_score
FROM department_period_scores dps
JOIN departments d ON d.id = dps.department_id
WHERE d.is_active = TRUE
GROUP BY dps.period_id, d.college_id;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_departments_college ON departments(college_id);
CREATE INDEX idx_indicator_criteria_indicator ON indicator_criteria(indicator_id);
CREATE INDEX idx_period_indicators_period ON period_indicators(period_id);
CREATE INDEX idx_submissions_period_dept ON submissions(period_id, department_id);
CREATE INDEX idx_submission_documents_submission ON submission_documents(submission_id);
CREATE INDEX idx_evaluations_period_dept ON evaluations(period_id, department_id);
CREATE INDEX idx_evaluations_criterion ON evaluations(criterion_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at);
