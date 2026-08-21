import {
    Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute,
} from 'sequelize';
import { sequelize } from '../config/database';

export type UserRole = 'admin' | 'qc_head' | 'dept_rep' | 'viewer';
export type CriterionType = 'checklist' | 'percentage' | 'ratio' | 'score_100';
export type PeriodStatus = 'draft' | 'open' | 'under_review' | 'published' | 'closed';
export type SubmissionStatus = 'pending' | 'submitted' | 'needs_revision' | 'reviewed';
export type StorageProvider = 'local' | 'google_drive';
export type EvaluationMethod = 'manual' | 'ai';
export type NotificationType = 'missing_submission' | 'deadline' | 'review_needed' | 'system' | 'reminder';

// ── User ──────────────────────────────────────────────────────
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare id: CreationOptional<string>;
    declare email: string;
    declare password: string;
    declare full_name: string;
    declare full_name_ar: string | null;
    declare role: CreationOptional<UserRole>;
    declare is_active: CreationOptional<boolean>;
    declare avatar_url: string | null;
    declare last_login: Date | null;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;

    declare departments?: NonAttribute<Department[]>;
    declare notifications?: NonAttribute<Notification[]>;
}
User.init({
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:       { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } },
    password:    { type: DataTypes.STRING, allowNull: false },
    full_name:   { type: DataTypes.STRING, allowNull: false },
    full_name_ar:{ type: DataTypes.STRING },
    role:        { type: DataTypes.ENUM('admin', 'qc_head', 'dept_rep', 'viewer'), defaultValue: 'viewer' },
    is_active:   { type: DataTypes.BOOLEAN, defaultValue: true },
    avatar_url:  { type: DataTypes.STRING },
    last_login:  { type: DataTypes.DATE },
    createdAt:   DataTypes.DATE,
    updatedAt:   DataTypes.DATE,
}, { sequelize, tableName: 'users' });

// ── College ───────────────────────────────────────────────────
export class College extends Model<InferAttributes<College>, InferCreationAttributes<College>> {
    declare id: CreationOptional<string>;
    declare name_en: string;
    declare name_ar: string;
    declare code: string;
    declare is_active: CreationOptional<boolean>;

    declare departments?: NonAttribute<Department[]>;
}
College.init({
    id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name_en:  { type: DataTypes.STRING, allowNull: false },
    name_ar:  { type: DataTypes.STRING, allowNull: false },
    code:     { type: DataTypes.STRING(50), unique: true, allowNull: false },
    is_active:{ type: DataTypes.BOOLEAN, defaultValue: true },
}, { sequelize, tableName: 'colleges' });

// ── Department ────────────────────────────────────────────────
export class Department extends Model<InferAttributes<Department>, InferCreationAttributes<Department>> {
    declare id: CreationOptional<string>;
    declare name_en: string;
    declare name_ar: string;
    declare code: string;
    declare college_id: string | null;
    declare drive_folder_url: string | null;
    declare is_active: CreationOptional<boolean>;

    declare college?: NonAttribute<College>;
    declare representatives?: NonAttribute<User[]>;
    declare submissions?: NonAttribute<Submission[]>;
    declare evaluations?: NonAttribute<Evaluation[]>;
}
Department.init({
    id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name_en:          { type: DataTypes.STRING, allowNull: false },
    name_ar:          { type: DataTypes.STRING, allowNull: false },
    code:             { type: DataTypes.STRING(50), unique: true, allowNull: false },
    college_id:       { type: DataTypes.UUID },
    drive_folder_url: { type: DataTypes.STRING(1000) },
    is_active:        { type: DataTypes.BOOLEAN, defaultValue: true },
}, { sequelize, tableName: 'departments' });

// ── DepartmentUser (join) ─────────────────────────────────────
export class DepartmentUser extends Model<InferAttributes<DepartmentUser>, InferCreationAttributes<DepartmentUser>> {
    declare department_id: string;
    declare user_id: string;
    declare is_primary_contact: CreationOptional<boolean>;
    declare assigned_at: CreationOptional<Date>;
}
DepartmentUser.init({
    department_id:      { type: DataTypes.UUID, primaryKey: true },
    user_id:             { type: DataTypes.UUID, primaryKey: true },
    is_primary_contact: { type: DataTypes.BOOLEAN, defaultValue: false },
    assigned_at:         { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'department_users', timestamps: false });

// ── Indicator ─────────────────────────────────────────────────
export class Indicator extends Model<InferAttributes<Indicator>, InferCreationAttributes<Indicator>> {
    declare id: CreationOptional<string>;
    declare code: string;
    declare name_en: string;
    declare name_ar: string;
    declare description_en: string | null;
    declare description_ar: string | null;
    declare sort_order: CreationOptional<number>;
    declare is_active: CreationOptional<boolean>;
    declare created_by: string | null;

    declare criteria?: NonAttribute<IndicatorCriterion[]>;
    declare period_indicators?: NonAttribute<PeriodIndicator[]>;
}
Indicator.init({
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code:           { type: DataTypes.STRING(50), unique: true, allowNull: false },
    name_en:        { type: DataTypes.STRING, allowNull: false },
    name_ar:        { type: DataTypes.STRING, allowNull: false },
    description_en: { type: DataTypes.TEXT },
    description_ar: { type: DataTypes.TEXT },
    sort_order:     { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active:      { type: DataTypes.BOOLEAN, defaultValue: true },
    created_by:     { type: DataTypes.UUID },
}, { sequelize, tableName: 'indicators' });

// ── IndicatorCriterion ────────────────────────────────────────
export class IndicatorCriterion extends Model<InferAttributes<IndicatorCriterion>, InferCreationAttributes<IndicatorCriterion>> {
    declare id: CreationOptional<string>;
    declare indicator_id: string;
    declare code: string;
    declare name_en: string;
    declare name_ar: string;
    declare description_en: string | null;
    declare description_ar: string | null;
    declare criterion_type: CreationOptional<CriterionType>;
    declare weight: CreationOptional<number>;
    declare config: CreationOptional<Record<string, unknown>>;
    declare requires_evidence: CreationOptional<boolean>;
    declare sort_order: CreationOptional<number>;
    declare is_active: CreationOptional<boolean>;

    declare indicator?: NonAttribute<Indicator>;
}
IndicatorCriterion.init({
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    indicator_id:      { type: DataTypes.UUID, allowNull: false },
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
}, { sequelize, tableName: 'indicator_criteria' });

// ── EvaluationPeriod ──────────────────────────────────────────
export class EvaluationPeriod extends Model<InferAttributes<EvaluationPeriod>, InferCreationAttributes<EvaluationPeriod>> {
    declare id: CreationOptional<string>;
    declare year: number;
    declare month: number;
    declare label_en: string | null;
    declare label_ar: string | null;
    declare status: CreationOptional<PeriodStatus>;
    declare submission_deadline: Date | null;
    declare created_by: string | null;

    declare period_indicators?: NonAttribute<PeriodIndicator[]>;
}
EvaluationPeriod.init({
    id:                  { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    year:                { type: DataTypes.INTEGER, allowNull: false },
    month:               { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 12 } },
    label_en:            { type: DataTypes.STRING(100) },
    label_ar:            { type: DataTypes.STRING(100) },
    status:              { type: DataTypes.ENUM('draft', 'open', 'under_review', 'published', 'closed'), defaultValue: 'draft' },
    submission_deadline: { type: DataTypes.DATE },
    created_by:          { type: DataTypes.UUID },
}, { sequelize, tableName: 'evaluation_periods' });

// ── PeriodIndicator (join) ────────────────────────────────────
export class PeriodIndicator extends Model<InferAttributes<PeriodIndicator>, InferCreationAttributes<PeriodIndicator>> {
    declare id: CreationOptional<string>;
    declare period_id: string;
    declare indicator_id: string;
    declare weight: CreationOptional<number>;
    declare sort_order: CreationOptional<number>;
    declare is_active: CreationOptional<boolean>;

    declare period?: NonAttribute<EvaluationPeriod>;
    declare indicator?: NonAttribute<Indicator>;
}
PeriodIndicator.init({
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    period_id:   { type: DataTypes.UUID, allowNull: false },
    indicator_id:{ type: DataTypes.UUID, allowNull: false },
    weight:      { type: DataTypes.DECIMAL(5, 4), defaultValue: 1.0 },
    sort_order:  { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active:   { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
    sequelize, tableName: 'period_indicators',
    // Each (period, indicator) pair is unique — this backs the ON CONFLICT in the
    // "set period indicators" upsert (routes/periods.ts) and matches schema.sql.
    indexes: [{ unique: true, fields: ['period_id', 'indicator_id'] }],
});

// ── Submission ────────────────────────────────────────────────
export class Submission extends Model<InferAttributes<Submission>, InferCreationAttributes<Submission>> {
    declare id: CreationOptional<string>;
    declare period_id: string;
    declare department_id: string;
    declare criterion_id: string;
    declare status: CreationOptional<SubmissionStatus>;
    declare notes: string | null;
    declare submitted_by: string | null;
    declare submitted_at: Date | null;

    declare period?: NonAttribute<EvaluationPeriod>;
    declare department?: NonAttribute<Department>;
    declare criterion?: NonAttribute<IndicatorCriterion>;
    declare submitter?: NonAttribute<User>;
    declare documents?: NonAttribute<SubmissionDocument[]>;
}
Submission.init({
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    period_id:     { type: DataTypes.UUID, allowNull: false },
    department_id: { type: DataTypes.UUID, allowNull: false },
    criterion_id:  { type: DataTypes.UUID, allowNull: false },
    status:        { type: DataTypes.ENUM('pending', 'submitted', 'needs_revision', 'reviewed'), defaultValue: 'pending' },
    notes:         { type: DataTypes.TEXT },
    submitted_by:  { type: DataTypes.UUID },
    submitted_at:  { type: DataTypes.DATE },
}, { sequelize, tableName: 'submissions' });

// ── SubmissionDocument ────────────────────────────────────────
export class SubmissionDocument extends Model<InferAttributes<SubmissionDocument>, InferCreationAttributes<SubmissionDocument>> {
    declare id: CreationOptional<string>;
    declare submission_id: string;
    declare file_name: string;
    declare storage_provider: CreationOptional<StorageProvider>;
    declare storage_path: string;
    declare mime_type: string | null;
    declare size_bytes: number | null;
    declare uploaded_by: string | null;
    declare uploaded_at: CreationOptional<Date>;

    declare submission?: NonAttribute<Submission>;
    declare uploader?: NonAttribute<User>;
}
SubmissionDocument.init({
    id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    submission_id:    { type: DataTypes.UUID, allowNull: false },
    file_name:        { type: DataTypes.STRING(500), allowNull: false },
    storage_provider: { type: DataTypes.ENUM('local', 'google_drive'), defaultValue: 'local' },
    storage_path:     { type: DataTypes.STRING(1000), allowNull: false },
    mime_type:        { type: DataTypes.STRING(100) },
    size_bytes:       { type: DataTypes.INTEGER },
    uploaded_by:      { type: DataTypes.UUID },
    uploaded_at:      { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'submission_documents', timestamps: false });

// ── Evaluation ────────────────────────────────────────────────
export class Evaluation extends Model<InferAttributes<Evaluation>, InferCreationAttributes<Evaluation>> {
    declare id: CreationOptional<string>;
    declare period_id: string;
    declare department_id: string;
    declare criterion_id: string;
    declare submission_id: string | null;
    declare score: number | null;
    declare raw_values: CreationOptional<Record<string, unknown>>;
    declare reviewer_notes: string | null;
    declare evaluated_by: string | null;
    declare evaluation_method: CreationOptional<EvaluationMethod>;
    declare ai_confidence: number | null;
    declare ai_rationale: string | null;
    declare evaluated_at: Date | null;

    declare period?: NonAttribute<EvaluationPeriod>;
    declare department?: NonAttribute<Department>;
    declare criterion?: NonAttribute<IndicatorCriterion>;
    declare submission?: NonAttribute<Submission>;
    declare evaluator?: NonAttribute<User>;
}
Evaluation.init({
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    period_id:         { type: DataTypes.UUID, allowNull: false },
    department_id:     { type: DataTypes.UUID, allowNull: false },
    criterion_id:      { type: DataTypes.UUID, allowNull: false },
    submission_id:     { type: DataTypes.UUID },
    score:             { type: DataTypes.DECIMAL(5, 4), validate: { min: 0, max: 1 } },
    raw_values:        { type: DataTypes.JSONB, defaultValue: {} },
    reviewer_notes:    { type: DataTypes.TEXT },
    evaluated_by:      { type: DataTypes.UUID },
    evaluation_method: { type: DataTypes.ENUM('manual', 'ai'), defaultValue: 'manual' },
    ai_confidence:     { type: DataTypes.DECIMAL(5, 4) },
    ai_rationale:      { type: DataTypes.TEXT },
    evaluated_at:      { type: DataTypes.DATE },
}, { sequelize, tableName: 'evaluations' });

// ── Notification ──────────────────────────────────────────────
export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
    declare id: CreationOptional<string>;
    declare user_id: string;
    declare department_id: string | null;
    declare period_id: string | null;
    declare type: NotificationType;
    declare title_en: string;
    declare title_ar: string | null;
    declare message_en: string | null;
    declare message_ar: string | null;
    declare is_read: CreationOptional<boolean>;
    declare priority: CreationOptional<string>;
    declare action_url: string | null;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;

    declare user?: NonAttribute<User>;
    declare department?: NonAttribute<Department>;
    declare period?: NonAttribute<EvaluationPeriod>;
}
Notification.init({
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id:     { type: DataTypes.UUID, allowNull: false },
    department_id: { type: DataTypes.UUID },
    period_id:   { type: DataTypes.UUID },
    type:        { type: DataTypes.ENUM('missing_submission', 'deadline', 'review_needed', 'system', 'reminder'), allowNull: false },
    title_en:    { type: DataTypes.STRING(500), allowNull: false },
    title_ar:    { type: DataTypes.STRING(500) },
    message_en:  { type: DataTypes.TEXT },
    message_ar:  { type: DataTypes.TEXT },
    is_read:     { type: DataTypes.BOOLEAN, defaultValue: false },
    priority:    { type: DataTypes.STRING(20), defaultValue: 'normal' },
    action_url:  { type: DataTypes.STRING(500) },
    createdAt:   DataTypes.DATE,
    updatedAt:   DataTypes.DATE,
}, { sequelize, tableName: 'notifications' });

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

export { sequelize };
