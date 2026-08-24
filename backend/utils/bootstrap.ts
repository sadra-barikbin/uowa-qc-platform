import bcrypt from 'bcryptjs';
import { Sequelize } from 'sequelize';
import {
    User, College, Department, Indicator, IndicatorCriterion,
    EvaluationPeriod, PeriodIndicator,
} from '../models';
import { INDICATOR_DATA, COLLEGE_DATA, EXCLUDED_FROM_COMPOSITE } from './seedData';

// First-run seed for the packaged desktop app: a CLEAN institutional start — the real colleges,
// departments and 13 indicators plus a single admin login. No demo users, submissions, evaluations
// or sample evidence (unlike the full `npm run seed`, which is for development).
//
// Idempotent by design: guarded on User.count(). Because the PGlite data dir lives in the app's
// userData folder and persists across launches and updates — and the desktop path never drops
// tables — the DB is non-empty on every run after the first, so this seeds exactly once, ever.
// It assumes tables already exist (server.ts runs sync() first); it never calls sync({ force }).

export async function ensureSeeded(_sequelize: Sequelize): Promise<void> {
    if ((await User.count()) > 0) return; // already seeded on a previous launch

    console.log('🌱  Empty database — seeding clean institutional data…');

    // Single admin (QC unit). Full control incl. reviewing/scoring. Password changed on first login.
    const admin = await User.create({
        email: 'admin@uowa.edu.iq',
        password: await bcrypt.hash('Admin@123', 12),
        full_name: 'QC Unit',
        full_name_ar: 'وحدة ضمان الجودة',
        role: 'admin',
    });

    // Colleges + departments
    let deptCount = 0;
    for (const c of COLLEGE_DATA) {
        const college = await College.create({ name_en: c.name_en, name_ar: c.name_ar, code: c.code });
        for (const d of c.depts) {
            await Department.create({ name_en: d.name_en, name_ar: d.name_ar, code: d.code, college_id: college.id });
            deptCount++;
        }
    }
    console.log(`✅  ${COLLEGE_DATA.length} colleges, ${deptCount} departments`);

    // Indicators + their weighted criteria
    const indicators: Indicator[] = [];
    for (let i = 0; i < INDICATOR_DATA.length; i++) {
        const ind = INDICATOR_DATA[i];
        const indicator = await Indicator.create({
            code: ind.code, name_en: ind.name_en, name_ar: ind.name_ar, sort_order: i, created_by: admin.id,
        });
        await IndicatorCriterion.bulkCreate(ind.criteria.map((cr, j) => ({
            indicator_id: indicator.id, code: cr.code, name_en: cr.name_ar, name_ar: cr.name_ar,
            criterion_type: cr.type, weight: cr.weight, config: cr.config || {}, sort_order: j,
        })));
        indicators.push(indicator);
    }
    console.log(`✅  ${indicators.length} indicators with criteria`);

    // One current, open evaluation period so the app is immediately usable. All indicators active
    // except those excluded from the composite (matches the real report).
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthNamesAr = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
        'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
    const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const deadline = new Date(year, month, 15); // 15th of next month

    const period = await EvaluationPeriod.create({
        year, month,
        label_en: `${monthNamesEn[month - 1]} ${year}`,
        label_ar: `${monthNamesAr[month - 1]} ${year}`,
        status: 'open',
        submission_deadline: deadline,
        created_by: admin.id,
    });
    await PeriodIndicator.bulkCreate(indicators.map((ind, i) => ({
        period_id: period.id, indicator_id: ind.id, weight: 1.0, sort_order: i,
        is_active: !EXCLUDED_FROM_COMPOSITE.includes(ind.code),
    })));
    console.log(`✅  Opened current period: ${period.label_en}`);

    console.log('🎉  Clean seed complete. Login: admin@uowa.edu.iq / Admin@123');
}
