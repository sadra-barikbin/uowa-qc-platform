import { EvaluationPeriod, PeriodStatus } from '../models';

// Which period states permit each write action. The workflow is strictly sequential:
// evidence is uploaded only while the period is `open`, and scored only while it is
// `under_review`. draft/published/closed are read-only for both actions, for everyone
// (including admins — an admin who needs to act moves the period into the right state first).
export const SUBMISSION_STATES: PeriodStatus[] = ['open'];
export const EVALUATION_STATES: PeriodStatus[] = ['under_review'];

// Arabic labels, matching the frontend STATUS_LABEL map — these messages surface directly
// in the UI toasts, so they must read naturally for the (Arabic-speaking) users.
const STATUS_LABEL_AR: Record<PeriodStatus, string> = {
    draft: 'مسودة', open: 'مفتوحة للرفع', under_review: 'قيد المراجعة', published: 'منشورة', closed: 'مغلقة',
};

export type PeriodGateResult =
    | { ok: true; period: EvaluationPeriod }
    | { ok: false; code: number; error: string };

// Load the period and confirm its status permits the action. Returns a ready-to-send
// { code, error } instead of throwing, matching the `return res.status(...).json(...)`
// style used throughout the route files.
export async function gatePeriod(
    period_id: string,
    allowed: PeriodStatus[],
    action: 'submission' | 'evaluation',
): Promise<PeriodGateResult> {
    const period = await EvaluationPeriod.findByPk(period_id);
    if (!period) return { ok: false, code: 404, error: 'Period not found' };
    if (!allowed.includes(period.status)) {
        const verb = action === 'submission' ? 'رفع المستندات' : 'التقييم';
        return {
            ok: false, code: 409,
            error: `لا يمكن ${verb} والفترة في حالة "${STATUS_LABEL_AR[period.status as PeriodStatus]}".`,
        };
    }
    return { ok: true, period };
}
