import { Op } from 'sequelize';
import { Notification, User, Department, EvaluationPeriod, IndicatorCriterion, Submission } from '../models';

export async function sendDeadlineReminders(): Promise<void> {
    const openPeriods = await EvaluationPeriod.findAll({
        where: { status: 'open', submission_deadline: { [Op.gte]: new Date() } },
    });

    for (const period of openPeriods) {
        const daysLeft = Math.ceil((new Date(period.submission_deadline!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 7) continue;

        const reps = await User.findAll({
            where: { is_active: true, role: 'dept_rep' },
            include: [{ model: Department, as: 'departments', attributes: ['id'], through: { attributes: [] } }],
        });

        for (const user of reps) {
            const existing = await Notification.findOne({
                where: { user_id: user.id, type: 'deadline', period_id: period.id, createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
            });
            if (existing) continue;

            await Notification.create({
                user_id: user.id, period_id: period.id, type: 'deadline', priority: daysLeft <= 2 ? 'urgent' : 'high',
                title_en: `Deadline Reminder: ${period.label_en}`,
                title_ar: `تذكير بالموعد النهائي: ${period.label_ar}`,
                message_en: `${daysLeft} days remaining to submit evidence for ${period.label_en}`,
                message_ar: `متبقي ${daysLeft} يوم لرفع مستندات ${period.label_ar}`,
                action_url: '/submissions',
            });
        }
    }
}

// Notify the user who started a background AI-evaluation run that it has finished. The run
// happens server-side and the user may have navigated away (the in-page toast only fires if
// they're still on the Evaluations page), so this leaves a durable, badge-counted record they
// can find later. Reuses the existing `review_needed` type — its ✔ icon reads as "graded, look
// it over". Best-effort: a notification failure must never fail the job, so callers don't await
// this for correctness and it swallows its own errors.
export async function notifyAiEvaluationComplete(args: {
    user_id: string;
    period_id: string;
    department_id: string;
    evaluated: number;   // criteria the AI scored
    skipped: number;     // criteria skipped (no documents)
    failed: number;      // indicators that errored out
}): Promise<void> {
    try {
        const dept = await Department.findByPk(args.department_id);
        const nameAr = dept?.name_ar || '';
        const nameEn = dept?.name_en || '';
        await Notification.create({
            user_id: args.user_id,
            department_id: args.department_id,
            period_id: args.period_id,
            type: 'review_needed',
            priority: args.failed ? 'high' : 'normal',
            title_en: `AI evaluation complete — ${nameEn}`,
            title_ar: `اكتمل التقييم الآلي — ${nameAr}`,
            message_en: `${args.evaluated} criteria scored`
                + (args.skipped ? `, ${args.skipped} skipped (no documents)` : '')
                + (args.failed ? ` · ${args.failed} indicator(s) failed` : ''),
            message_ar: `تم تقييم ${args.evaluated} معياراً`
                + (args.skipped ? `، وتُخطّي ${args.skipped} بلا مستندات` : '')
                + (args.failed ? ` · فشل ${args.failed} مؤشر` : ''),
            action_url: `/evaluations?period=${args.period_id}&department=${args.department_id}`,
        });
    } catch (err) {
        console.error('notifyAiEvaluationComplete failed', err);
    }
}

// notify QC staff that a department has unsubmitted criteria as the deadline nears
export async function notifyMissingSubmissions(period_id: string): Promise<void> {
    const period = await EvaluationPeriod.findByPk(period_id);
    if (!period) return;

    const [departments, allCriteria, submissions, reviewers] = await Promise.all([
        Department.findAll({ where: { is_active: true } }),
        IndicatorCriterion.findAll({ where: { is_active: true } }),
        Submission.findAll({ where: { period_id }, attributes: ['department_id', 'criterion_id'] }),
        User.findAll({ where: { is_active: true, role: { [Op.in]: ['admin', 'qc_head'] } } }),
    ]);

    const submitted = new Set(submissions.map(s => `${s.department_id}__${s.criterion_id}`));
    const criteriaCount = allCriteria.length;

    for (const dept of departments) {
        const missing = allCriteria.filter(c => !submitted.has(`${dept.id}__${c.id}`)).length;
        if (missing === 0) continue;

        for (const user of reviewers) {
            await Notification.create({
                user_id: user.id, department_id: dept.id, period_id, type: 'missing_submission', priority: 'high',
                title_en: `Missing evidence: ${dept.name_en}`,
                title_ar: `مستندات ناقصة: ${dept.name_ar}`,
                message_en: `${dept.name_en} has not submitted ${missing}/${criteriaCount} criteria for ${period.label_en}.`,
                message_ar: `لم يقم قسم ${dept.name_ar} برفع ${missing} من ${criteriaCount} معيار لفترة ${period.label_ar}.`,
                action_url: `/departments/${dept.id}`,
            });
        }
    }
}
