// Thin wrappers around the aggregation SQL views (indicator_scores, department_period_scores,
// college_period_scores) defined in database/schema.sql, shared by the dashboard, reports and
// evaluations routes so the scoring logic only lives in one place.
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

async function getIndicatorScores(period_id, department_id = null) {
    const where = department_id ? 'WHERE period_id = :period_id AND department_id = :department_id' : 'WHERE period_id = :period_id';
    return sequelize.query(
        `SELECT * FROM indicator_scores ${where}`,
        { replacements: { period_id, department_id }, type: QueryTypes.SELECT }
    );
}

async function getDepartmentScores(period_id) {
    return sequelize.query(
        `SELECT * FROM department_period_scores WHERE period_id = :period_id`,
        { replacements: { period_id }, type: QueryTypes.SELECT }
    );
}

async function getCollegeScores(period_id) {
    return sequelize.query(
        `SELECT * FROM college_period_scores WHERE period_id = :period_id`,
        { replacements: { period_id }, type: QueryTypes.SELECT }
    );
}

module.exports = { getIndicatorScores, getDepartmentScores, getCollegeScores };
