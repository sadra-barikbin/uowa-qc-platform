// Unit tests for the AI-assessor system-prompt templating (utils/aiPrompt.ts).
//
// aiPrompt.ts is a pure module (no models / no Anthropic SDK), so these tests need no mocks:
// they lock in that every {{var}} in the shipped default prompt actually gets interpolated
// before the prompt is fed to the model — a silently-unreplaced or typo'd placeholder would
// otherwise reach Claude verbatim (or vanish to ''), which manual testing wouldn't catch.

import {
    renderSystemPrompt,
    DEFAULT_AI_EVAL_SYSTEM_PROMPT,
    AI_PROMPT_VARIABLES,
} from './aiPrompt';

// The concrete values aiEvaluator.ts passes at grade time (shape of the vars object).
const vars = {
    department: 'إدارة المؤسسات الصحية',
    college: 'كلية الإدارة والاقتصاد',
    period: 'أيلول 2025',
    indicator: 'تحديث المقررات',
    today: '2026-09-14',
};

describe('renderSystemPrompt', () => {
    it('replaces every placeholder with its value', () => {
        const out = renderSystemPrompt('{{department}} / {{college}} / {{period}}', vars);
        expect(out).toBe('إدارة المؤسسات الصحية / كلية الإدارة والاقتصاد / أيلول 2025');
    });

    it('interpolates a repeated placeholder every time it appears', () => {
        expect(renderSystemPrompt('{{department}}-{{department}}', vars))
            .toBe('إدارة المؤسسات الصحية-إدارة المؤسسات الصحية');
    });

    it('tolerates inner whitespace: {{ var }}', () => {
        expect(renderSystemPrompt('{{ college }}', vars)).toBe('كلية الإدارة والاقتصاد');
    });

    it('renders an unknown placeholder as an empty string', () => {
        expect(renderSystemPrompt('a{{nope}}b', vars)).toBe('ab');
    });

    it('leaves text without placeholders untouched', () => {
        expect(renderSystemPrompt('لا متغيرات هنا', vars)).toBe('لا متغيرات هنا');
    });
});

describe('DEFAULT_AI_EVAL_SYSTEM_PROMPT', () => {
    // Build the full var map the way aiEvaluator does (every declared var gets a value).
    const allVars = Object.fromEntries(AI_PROMPT_VARIABLES.map(v => [v.name, `«${v.name}»`]));

    it('references only declared variables (no typo\'d placeholder that would silently vanish)', () => {
        const known = new Set(AI_PROMPT_VARIABLES.map(v => v.name));
        const used = [...DEFAULT_AI_EVAL_SYSTEM_PROMPT.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]);
        expect(used.length).toBeGreaterThan(0);
        used.forEach(name => expect(known).toContain(name));
    });

    it('fully interpolates — no {{...}} survives into the prompt sent to the model', () => {
        const rendered = renderSystemPrompt(DEFAULT_AI_EVAL_SYSTEM_PROMPT, allVars);
        expect(rendered).not.toMatch(/\{\{.*?\}\}/);
    });

    it('injects the department into the rendered prompt', () => {
        const rendered = renderSystemPrompt(DEFAULT_AI_EVAL_SYSTEM_PROMPT, {
            ...allVars,
            department: 'إدارة المؤسسات الصحية',
        });
        expect(rendered).toContain('إدارة المؤسسات الصحية');
    });
});
