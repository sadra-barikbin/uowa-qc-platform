const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

// ── User ──────────────────────────────────────────────────────
const User = sequelize.define('User', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:       { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } },
    password:    { type: DataTypes.STRING, allowNull: false },
    full_name:   { type: DataTypes.STRING, allowNull: false },
    full_name_ar:{ type: DataTypes.STRING },
    role:        { type: DataTypes.ENUM('admin', 'qc_head', 'dept_rep', 'viewer'), defaultValue: 'viewer' },
    is_active:   { type: DataTypes.BOOLEAN, defaultValue: true },
    avatar_url:  { type: DataTypes.STRING },
    last_login:  { type: DataTypes.DATE },
}, { tableName: 'users' });

// ── College ───────────────────────────────────────────────────
const College = sequelize.define('College', {
    id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name_en:  { type: DataTypes.STRING, allowNull: false },
    name_ar:  { type: DataTypes.STRING, allowNull: false },
    code:     { type: DataTypes.STRING(50), unique: true, allowNull: false },
    is_active:{ type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'colleges' });

// ── Department ────────────────────────────────────────────────
const Department = sequelize.define('Department', {
    id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name_en:          { type: DataTypes.STRING, allowNull: false },
    name_ar:          { type: DataTypes.STRING, allowNull: false },
    code:             { type: DataTypes.STRING(50), unique: true, allowNull: false },
    drive_folder_url: { type: DataTypes.STRING(1000) },
    is_active:        { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'departments' });

// ── DepartmentUser (join) ────────────────────────────────────
const DepartmentUser = sequelize.define('DepartmentUser', {
    department_id:      { type: DataTypes.UUID, primaryKey: true },
    user_id:             { type: DataTypes.UUID, primaryKey: true },
    is_primary_contact: { type: DataTypes.BOOLEAN, defaultValue: false },
    assigned_at:         { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'department_users', timestamps: false });

// ── Indicator ─────────────────────────────────────────────────
const Indicator = sequelize.define('Indicator', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code:           { type: DataTypes.STRING(50), unique: true, allowNull: false },
    name_en:        { type: DataTypes.STRING, allowNull: false },
    name_ar:        { type: DataTypes.STRING, allowNull: false },
    description_en: { type: DataTypes.TEXT },
    description_ar: { type: DataTypes.TEXT },
    sort_order:     { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active:      { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'indicators' });

// ── IndicatorCriterion ────────────────────────────────────────
const IndicatorCriterion = sequelize.define('IndicatorCriterion', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code:              { type: DataTypes.STRING(50), allowNull: false },
    name_en:           { type: DataTypes.STRING, allowNull: false },
    name_ar:           { type: DataTypes.STRING, allowNull: false },
    description_en:    { type: DataTypes.TEXT },
    description_ar:    { type: DataTypes.TEXT },
    criterion_type:    { type: DataTypes.ENUM('checklist', 'percentage', 'ratio', 'score_100'), defaultValue: 'checklist' },
    weight:            { type: DataTypes.DECIMAL(5, 4), defaultValue: 1.0 },
    config:            { type: DataTypes.JSONB, defaultValue: {} },
    requires_evidence: { type: DataTypes.BOOLEAN, defaultValue: true },
    sort_order:        { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active:         { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'indicator_criteria' });

// ── EvaluationPeriod ──────────────────────────────────────────
const EvaluationPeriod = sequelize.define('EvaluationPeriod', {
    id:                  { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    year:                { type: DataTypes.INTEGER, allowNull: false },
    month:               { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 12 } },
    label_en:            { type: DataTypes.STRING(100) },
    label_ar:            { type: DataTypes.STRING(100) },
    status:              { type: DataTypes.ENUM('draft', 'open', 'under_review', 'published', 'closed'), defaultValue: 'draft' },
    submission_deadline: { type: DataTypes.DATE },
}, { tableName: 'evaluation_periods' });

// ── PeriodIndicator (join) ────────────────────────────────────
const PeriodIndicator = sequelize.define('PeriodIndicator', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    weight:      { type: DataTypes.DECIMAL(5, 4), defaultValue: 1.0 },
    sort_order:  { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active:   { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'period_indicators' });

// ── Submission ────────────────────────────────────────────────
const Submission = sequelize.define('Submission', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    status:        { type: DataTypes.ENUM('pending', 'submitted', 'needs_revision', 'reviewed'), defaultValue: 'pending' },
    notes:         { type: DataTypes.TEXT },
    submitted_at:  { type: DataTypes.DATE },
}, { tableName: 'submissions' });

// ── SubmissionDocument ────────────────────────────────────────
const SubmissionDocument = sequelize.define('SubmissionDocument', {
    id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    file_name:        { type: DataTypes.STRING(500), allowNull: false },
    storage_provider: { type: DataTypes.ENUM('local', 'google_drive'), defaultValue: 'local' },
    storage_path:     { type: DataTypes.STRING(1000), allowNull: false },
    mime_type:        { type: DataTypes.STRING(100) },
    size_bytes:       { type: DataTypes.INTEGER },
    uploaded_at:      { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { tableName: 'submission_documents', timestamps: false });

// ── Evaluation ────────────────────────────────────────────────
const Evaluation = sequelize.define('Evaluation', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    score:             { type: DataTypes.DECIMAL(5, 4), validate: { min: 0, max: 1 } },
    raw_values:        { type: DataTypes.JSONB, defaultValue: {} },
    reviewer_notes:    { type: DataTypes.TEXT },
    evaluation_method: { type: DataTypes.ENUM('manual', 'ai'), defaultValue: 'manual' },
    ai_confidence:     { type: DataTypes.DECIMAL(5, 4) },
    ai_rationale:      { type: DataTypes.TEXT },
    evaluated_at:      { type: DataTypes.DATE },
}, { tableName: 'evaluations' });

// ── Notification ──────────────────────────────────────────────
const Notification = sequelize.define('Notification', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    type:        { type: DataTypes.ENUM('missing_submission', 'deadline', 'review_needed', 'system', 'reminder'), allowNull: false },
    title_en:    { type: DataTypes.STRING(500), allowNull: false },
    title_ar:    { type: DataTypes.STRING(500) },
    message_en:  { type: DataTypes.TEXT },
    message_ar:  { type: DataTypes.TEXT },
    is_read:     { type: DataTypes.BOOLEAN, defaultValue: false },
    priority:    { type: DataTypes.STRING(20), defaultValue: 'normal' },
    action_url:  { type: DataTypes.STRING(500) },
}, { tableName: 'notifications' });

// ── Associations ──────────────────────────────────────────────
College.hasMany(Department, { foreignKey: 'college_id', as: 'departments' });
Department.belongsTo(College, { foreignKey: 'college_id', as: 'college' });

Department.belongsToMany(User, { through: DepartmentUser, foreignKey: 'department_id', otherKey: 'user_id', as: 'representatives' });
User.belongsToMany(Department, { through: DepartmentUser, foreignKey: 'user_id', otherKey: 'department_id', as: 'departments' });

Indicator.hasMany(IndicatorCriterion, { foreignKey: 'indicator_id', as: 'criteria' });
IndicatorCriterion.belongsTo(Indicator, { foreignKey: 'indicator_id', as: 'indicator' });

EvaluationPeriod.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
Indicator.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

EvaluationPeriod.hasMany(PeriodIndicator, { foreignKey: 'period_id', as: 'period_indicators' });
PeriodIndicator.belongsTo(EvaluationPeriod, { foreignKey: 'period_id', as: 'period' });
Indicator.hasMany(PeriodIndicator, { foreignKey: 'indicator_id', as: 'period_indicators' });
PeriodIndicator.belongsTo(Indicator, { foreignKey: 'indicator_id', as: 'indicator' });

EvaluationPeriod.hasMany(Submission, { foreignKey: 'period_id', as: 'submissions' });
Submission.belongsTo(EvaluationPeriod, { foreignKey: 'period_id', as: 'period' });
Department.hasMany(Submission, { foreignKey: 'department_id', as: 'submissions' });
Submission.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
IndicatorCriterion.hasMany(Submission, { foreignKey: 'criterion_id', as: 'submissions' });
Submission.belongsTo(IndicatorCriterion, { foreignKey: 'criterion_id', as: 'criterion' });
Submission.belongsTo(User, { foreignKey: 'submitted_by', as: 'submitter' });

Submission.hasMany(SubmissionDocument, { foreignKey: 'submission_id', as: 'documents' });
SubmissionDocument.belongsTo(Submission, { foreignKey: 'submission_id', as: 'submission' });
SubmissionDocument.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

EvaluationPeriod.hasMany(Evaluation, { foreignKey: 'period_id', as: 'evaluations' });
Evaluation.belongsTo(EvaluationPeriod, { foreignKey: 'period_id', as: 'period' });
Department.hasMany(Evaluation, { foreignKey: 'department_id', as: 'evaluations' });
Evaluation.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
IndicatorCriterion.hasMany(Evaluation, { foreignKey: 'criterion_id', as: 'evaluations' });
Evaluation.belongsTo(IndicatorCriterion, { foreignKey: 'criterion_id', as: 'criterion' });
Evaluation.belongsTo(Submission, { foreignKey: 'submission_id', as: 'submission' });
Evaluation.belongsTo(User, { foreignKey: 'evaluated_by', as: 'evaluator' });

User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Notification.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Notification.belongsTo(EvaluationPeriod, { foreignKey: 'period_id', as: 'period' });

module.exports = {
    sequelize,
    User, College, Department, DepartmentUser,
    Indicator, IndicatorCriterion,
    EvaluationPeriod, PeriodIndicator,
    Submission, SubmissionDocument,
    Evaluation, Notification,
};
