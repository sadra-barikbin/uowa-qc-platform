const router = require('express').Router();
const { Department, College, EvaluationPeriod, Indicator, Submission, Evaluation } = require('../models');
const { authenticate } = require('../middleware/auth');
const { getIndicatorScores, getDepartmentScores } = require('../utils/scores');

// GET /api/dashboard/summary?period_id=
router.get('/summary', authenticate, async (req, res) => {
    const { period_id } = req.query;

    const period = period_id
        ? await EvaluationPeriod.findByPk(period_id)
        : await EvaluationPeriod.findOne({ order: [['year', 'DESC'], ['month', 'DESC']] });

    const departments = await Department.findAll({ where: { is_active: true }, include: [{ model: College, as: 'college' }] });

    const deptScores = period ? await getDepartmentScores(period.id) : [];
    const scoreMap = {};
    deptScores.forEach(s => { scoreMap[s.department_id] = s.final_score; });

    const summaryDepts = departments.map(d => {
        const raw = scoreMap[d.id];
        const score = raw != null ? Math.round(Number(raw) * 10000) / 100 : null;
        return { id: d.id, name_ar: d.name_ar, name_en: d.name_en, college: d.college, score };
    });

    const scored = summaryDepts.filter(d => d.score !== null);
    const avgScore = scored.length ? scored.reduce((a, b) => a + b.score, 0) / scored.length : 0;
    const excellent = scored.filter(d => d.score >= 90).length;
    const needsAttention = scored.filter(d => d.score < 50).length;
    const notScored = summaryDepts.length - scored.length;

    res.json({
        period,
        summary: {
            total_departments: summaryDepts.length,
            avg_score: Math.round(avgScore * 100) / 100,
            excellent_count: excellent,
            needs_attention_count: needsAttention,
            departments_not_scored: notScored,
        },
        departments: summaryDepts.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    });
});

// GET /api/dashboard/trends — last 6 periods
router.get('/trends', authenticate, async (req, res) => {
    const periods = await EvaluationPeriod.findAll({ order: [['year', 'DESC'], ['month', 'DESC']], limit: 6 });

    const trends = await Promise.all(periods.map(async (p) => {
        const scores = await getDepartmentScores(p.id);
        const vals = scores.filter(s => s.final_score !== null).map(s => Number(s.final_score) * 100);
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        return { period: `${p.year}/${String(p.month).padStart(2, '0')}`, avg: Math.round(avg * 100) / 100, label: p.label_ar || `${p.month}/${p.year}` };
    }));

    res.json({ trends: trends.reverse() });
});

// GET /api/dashboard/indicator-scores?period_id= — average of each indicator across all departments
router.get('/indicator-scores', authenticate, async (req, res) => {
    const { period_id } = req.query;
    if (!period_id) return res.json({ indicators: [] });

    const [indicators, scores] = await Promise.all([
        Indicator.findAll({ where: { is_active: true }, order: [['sort_order', 'ASC']] }),
        getIndicatorScores(period_id),
    ]);

    const byIndicator = {};
    scores.forEach(s => {
        if (!byIndicator[s.indicator_id]) byIndicator[s.indicator_id] = [];
        if (s.score !== null) byIndicator[s.indicator_id].push(Number(s.score));
    });

    const results = indicators
        .filter(ind => byIndicator[ind.id]?.length)
        .map(ind => {
            const vals = byIndicator[ind.id];
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            return { id: ind.id, name_ar: ind.name_ar, name_en: ind.name_en, avg_score: Math.round(avg * 10000) / 100, count: vals.length };
        });

    res.json({ indicators: results });
});

// GET /api/dashboard/pending-reviews?period_id= — submissions awaiting a reviewer score
router.get('/pending-reviews', authenticate, async (req, res) => {
    const { period_id } = req.query;
    const where = { status: 'submitted' };
    if (period_id) where.period_id = period_id;
    const count = await Submission.count({ where });
    res.json({ pending_reviews: count });
});

module.exports = router;
