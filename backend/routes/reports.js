const router = require('express').Router();
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const {
    Department, College, EvaluationPeriod, PeriodIndicator, Indicator,
    IndicatorCriterion, Evaluation,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { getIndicatorScores, getDepartmentScores, getCollegeScores } = require('../utils/scores');

async function loadReportData(period_id) {
    const [period, departments, periodIndicators, evaluations, indicatorScores, departmentScores, collegeScores] = await Promise.all([
        EvaluationPeriod.findByPk(period_id),
        Department.findAll({ where: { is_active: true }, include: [{ model: College, as: 'college' }], order: [['name_ar', 'ASC']] }),
        PeriodIndicator.findAll({
            where: { period_id, is_active: true },
            include: [{ model: Indicator, as: 'indicator', include: [{ model: IndicatorCriterion, as: 'criteria', where: { is_active: true }, required: false }] }],
            order: [['sort_order', 'ASC']],
        }),
        Evaluation.findAll({ where: { period_id } }),
        getIndicatorScores(period_id),
        getDepartmentScores(period_id),
        getCollegeScores(period_id),
    ]);

    const evalMap = {};
    evaluations.forEach(e => { evalMap[`${e.department_id}__${e.criterion_id}`] = e; });
    const indicatorScoreMap = {};
    indicatorScores.forEach(s => { indicatorScoreMap[`${s.department_id}__${s.indicator_id}`] = s.score; });
    const departmentScoreMap = {};
    departmentScores.forEach(s => { departmentScoreMap[s.department_id] = s.final_score; });
    const collegeScoreMap = {};
    collegeScores.forEach(s => { collegeScoreMap[s.college_id] = s.avg_score; });

    return { period, departments, periodIndicators, evalMap, indicatorScoreMap, departmentScoreMap, collegeScoreMap };
}

function num(v) { return v == null ? null : Math.round(Number(v) * 10000) / 10000; }

// GET /api/reports/export/excel?period_id= — one sheet per indicator + two aggregation sheets,
// mirroring the department's original manual report layout
router.get('/export/excel', authenticate, async (req, res) => {
    const { period_id } = req.query;
    if (!period_id) return res.status(400).json({ error: 'period_id required' });

    const { period, departments, periodIndicators, evalMap, indicatorScoreMap, departmentScoreMap, collegeScoreMap } = await loadReportData(period_id);
    if (!period) return res.status(404).json({ error: 'Period not found' });

    const wb = XLSX.utils.book_new();

    // one sheet per indicator: rows = departments, columns = weighted criteria + completion
    periodIndicators.forEach(pi => {
        const criteria = pi.indicator.criteria || [];
        const headers = ['الكلية/القسم', ...criteria.map(c => `${c.name_ar} (${Math.round(Number(c.weight) * 100)}%)`), 'الإنجاز'];
        const rows = [headers];
        departments.forEach(dept => {
            const values = criteria.map(c => num(evalMap[`${dept.id}__${c.id}`]?.score));
            const completion = num(indicatorScoreMap[`${dept.id}__${pi.indicator_id}`]);
            rows.push([dept.name_ar, ...values, completion]);
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = headers.map(() => ({ wch: 22 }));
        const sheetName = pi.indicator.name_ar.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // "تقييم شامل" — per-department composite across all indicators
    const deptHeaders = ['الكلية/القسم', ...periodIndicators.map(pi => pi.indicator.name_ar), 'التقييم النهائي'];
    const deptRows = [deptHeaders];
    departments.forEach(dept => {
        const values = periodIndicators.map(pi => num(indicatorScoreMap[`${dept.id}__${pi.indicator_id}`]));
        deptRows.push([dept.name_ar, ...values, num(departmentScoreMap[dept.id])]);
    });
    const deptWs = XLSX.utils.aoa_to_sheet(deptRows);
    deptWs['!cols'] = deptHeaders.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, deptWs, 'تقييم شامل');

    // "التقييم الكلية" — per-college rollup
    const colleges = [...new Map(departments.map(d => [d.college?.id, d.college]).filter(([id]) => id)).values()];
    const collegeHeaders = ['الكلية', ...periodIndicators.map(pi => pi.indicator.name_ar), 'التقييم النهائي'];
    const collegeRows = [collegeHeaders];
    colleges.forEach(college => {
        const collegeDepts = departments.filter(d => d.college_id === college.id);
        const values = periodIndicators.map(pi => {
            const vals = collegeDepts.map(d => indicatorScoreMap[`${d.id}__${pi.indicator_id}`]).filter(v => v != null);
            return vals.length ? num(vals.reduce((a, b) => a + Number(b), 0) / vals.length) : null;
        });
        collegeRows.push([college.name_ar, ...values, num(collegeScoreMap[college.id])]);
    });
    const collegeWs = XLSX.utils.aoa_to_sheet(collegeRows);
    collegeWs['!cols'] = collegeHeaders.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, collegeWs, 'التقييم الكلية');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `report-${period.year}-${String(period.month).padStart(2, '0')}.xlsx`;
    res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(period.label_ar || filename)}.xlsx`,
    });
    res.send(buf);
});

// GET /api/reports/export/pdf?period_id=
router.get('/export/pdf', authenticate, async (req, res) => {
    const { period_id } = req.query;
    const { period, departments, departmentScoreMap } = await loadReportData(period_id);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="report.pdf"` });
    doc.pipe(res);

    doc.fontSize(18).text('University QC Report', { align: 'center' });
    doc.fontSize(12).text(`Period: ${period?.label_en || period_id}`, { align: 'center' });
    doc.moveDown();

    departments.forEach(dept => {
        const score = departmentScoreMap[dept.id];
        const pct = score != null ? Number(score) * 100 : null;
        doc.fontSize(11).text(`${dept.name_en} (${dept.name_ar})`, { continued: true });
        doc.fillColor(pct == null ? 'gray' : pct >= 90 ? 'green' : pct >= 70 ? 'orange' : 'red')
           .text(pct == null ? ' — not scored' : ` — ${pct.toFixed(1)}%`)
           .fillColor('black');
    });

    doc.end();
});

// GET /api/reports/comparison?period1_id=&period2_id=
router.get('/comparison', authenticate, async (req, res) => {
    const { period1_id, period2_id } = req.query;
    if (!period1_id || !period2_id) return res.status(400).json({ error: 'Both period IDs required' });

    const [scores1, scores2, depts] = await Promise.all([
        getDepartmentScores(period1_id),
        getDepartmentScores(period2_id),
        Department.findAll({ where: { is_active: true }, attributes: ['id', 'name_ar', 'name_en'] }),
    ]);
    const map1 = Object.fromEntries(scores1.map(s => [s.department_id, s.final_score]));
    const map2 = Object.fromEntries(scores2.map(s => [s.department_id, s.final_score]));

    const comparison = depts.map(d => {
        const s1 = map1[d.id] != null ? Number(map1[d.id]) * 100 : null;
        const s2 = map2[d.id] != null ? Number(map2[d.id]) * 100 : null;
        return {
            department: d,
            period1_score: s1 != null ? Math.round(s1) : null,
            period2_score: s2 != null ? Math.round(s2) : null,
            change: s1 != null && s2 != null ? Math.round(s2 - s1) : null,
        };
    });

    res.json({ comparison });
});

module.exports = router;
