// `sequelize.sync({ alter: true })` (used in development on every boot) cannot ALTER a column
// that one of our views depends on ("cannot alter type of a column used by a view or rule").
// Call this before sync and ensureViews() after, so the views never block a schema alteration.
async function dropViews(sequelize) {
    await sequelize.query('DROP VIEW IF EXISTS college_period_scores CASCADE;');
    await sequelize.query('DROP VIEW IF EXISTS department_period_scores CASCADE;');
    await sequelize.query('DROP VIEW IF EXISTS indicator_scores CASCADE;');
}

// sequelize.sync() only creates tables from the models — it knows nothing about the plain SQL
// views (indicator_scores, department_period_scores, college_period_scores) defined in
// database/schema.sql. Re-running this after every sync keeps them in place regardless of
// whether the database was bootstrapped via `psql -f schema.sql` or via Sequelize sync.
async function ensureViews(sequelize) {
    await sequelize.query(`
        CREATE OR REPLACE VIEW indicator_scores AS
        SELECT
            pi.period_id,
            d.id AS department_id,
            pi.indicator_id,
            CASE WHEN SUM(ic.weight) > 0
                 THEN SUM(COALESCE(e.score, 0) * ic.weight) / SUM(ic.weight)
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
    `);

    await sequelize.query(`
        CREATE OR REPLACE VIEW department_period_scores AS
        SELECT
            isr.period_id,
            isr.department_id,
            CASE WHEN SUM(pi.weight) > 0
                 THEN SUM(COALESCE(isr.score, 0) * pi.weight) / SUM(pi.weight)
                 ELSE NULL END AS final_score
        FROM indicator_scores isr
        JOIN period_indicators pi ON pi.period_id = isr.period_id AND pi.indicator_id = isr.indicator_id
        GROUP BY isr.period_id, isr.department_id;
    `);

    await sequelize.query(`
        CREATE OR REPLACE VIEW college_period_scores AS
        SELECT
            dps.period_id,
            d.college_id,
            AVG(dps.final_score) AS avg_score
        FROM department_period_scores dps
        JOIN departments d ON d.id = dps.department_id
        WHERE d.is_active = TRUE
        GROUP BY dps.period_id, d.college_id;
    `);
}

module.exports = { ensureViews, dropViews };
