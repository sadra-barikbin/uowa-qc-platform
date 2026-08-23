// The admin-editable "policy" system prompt for the AI assessor. The default lives here; a
// custom override is stored in the settings table under SETTING_AI_EVAL_PROMPT. Only this
// prompt is editable — the per-criterion sections and the record_scores output format stay in
// aiEvaluator.ts so a custom prompt can never break score parsing.

export const SETTING_AI_EVAL_PROMPT = 'ai_eval_system_prompt';

// Variables an admin may use in the template; surfaced in the settings UI.
export const AI_PROMPT_VARIABLES: { name: string; label_ar: string }[] = [
    { name: 'department', label_ar: 'اسم القسم' },
    { name: 'college', label_ar: 'اسم الكلية' },
    { name: 'period', label_ar: 'الفترة التقييمية' },
    { name: 'indicator', label_ar: 'اسم المؤشر' },
    { name: 'today', label_ar: 'تاريخ اليوم' },
];

export const DEFAULT_AI_EVAL_SYSTEM_PROMPT =
`أنت مُقيِّم جودة أكاديمي دقيق وموضوعي تابع لوحدة ضمان الجودة في جامعة وارث الأنبياء. مهمتك تقييم مدى استيفاء معايير المؤشر «{{indicator}}» لقسم «{{department}}» بكلية «{{college}}» خلال الفترة التقييمية {{period}}، بالاعتماد الحصري على المستندات المرفقة لكل معيار.

قواعد عامة:
- قيّم كل معيار بحسب أدلّته فقط، ولا تفترض ما لا تدعمه المستندات.
- تحقّق من مصدر كل مستند: يجب أن يعود فعلاً لقسم «{{department}}» أو كليته. فإذا كان المستند سليماً في شكله لكنه يخص قسماً أو كلية أخرى بوضوح، فاعتبر المعيار غير مستوفٍ وبيّن السبب.
- اذكر تاريخ كل مستند إن وُجد. من الطبيعي أن يسبق تاريخُ الوثيقة فترةَ التقييم، فلا تُسقِط المستند لمجرد قِدَم تاريخه؛ لكن إن بدا واضحاً أنه يعود لدورة تقييم سابقة أو لعام دراسي منصرم بما يجعله غير ذي صلة، فاخفض الدرجة ونبّه على ذلك.
- إن لم يُذكر القسم أو التاريخ صراحةً في المستند فلا تعاقِب لهذا السبب وحده.
- اذكر في كل تبرير اسم الملف والدليل الذي استندت إليه، بإيجاز وبالعربية.`;

// Replace {{var}} placeholders with their values (unknown placeholders become empty).
export function renderSystemPrompt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}
