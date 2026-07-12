// Thin wrappers around the aggregation SQL views (indicator_scores, department_period_scores,
// college_period_scores) defined in database/schema.sql, shared by the dashboard, reports and
// evaluations routes so the scoring logic only lives in one place.
import { QueryTypes } from 'sequelize';
import { sequelize } from '../models';

export interface IndicatorScoreRow {
    period_id: string;
    department_id: string;
    indicator_id: string;
    score: string | null;
    criteria_total: string;
    criteria_scored: string;
}

export interface DepartmentScoreRow {
    period_id: string;
    department_id: string;
    final_score: string | null;
}

export interface CollegeScoreRow {
    period_id: string;
    college_id: string;
    avg_score: string | null;
}

export async function getIndicatorScores(period_id: string, department_id: string | null = null): Promise<IndicatorScoreRow[]> {
    const where = department_id ? 'WHERE period_id = :period_id AND department_id = :department_id' : 'WHERE period_id = :period_id';
    return sequelize.query<IndicatorScoreRow>(
        `SELECT * FROM indicator_scores ${where}`,
        { replacements: { period_id, department_id }, type: QueryTypes.SELECT }
    );
}

export async function getDepartmentScores(period_id: string): Promise<DepartmentScoreRow[]> {
    return sequelize.query<DepartmentScoreRow>(
        `SELECT * FROM department_period_scores WHERE period_id = :period_id`,
        { replacements: { period_id }, type: QueryTypes.SELECT }
    );
}

export async function getCollegeScores(period_id: string): Promise<CollegeScoreRow[]> {
    return sequelize.query<CollegeScoreRow>(
        `SELECT * FROM college_period_scores WHERE period_id = :period_id`,
        { replacements: { period_id }, type: QueryTypes.SELECT }
    );
}
