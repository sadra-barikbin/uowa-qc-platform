import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import {
    sequelize, User, College, Department, DepartmentUser,
    Indicator, IndicatorCriterion, EvaluationPeriod, PeriodIndicator,
    Submission, SubmissionDocument, Evaluation, CriterionType,
} from '../models';
import { ensureViews, dropViews } from './ensureViews';

const uploadDir = path.join(__dirname, '../uploads');

interface CriterionSeed {
    code: string;
    name_ar: string;
    type: CriterionType;
    weight: number;
    config?: Record<string, unknown>;
}

interface IndicatorSeed {
    code: string;
    name_ar: string;
    name_en: string;
    criteria: CriterionSeed[];
}

// Indicator + criteria definitions, reconstructed from the department's real monthly report
const INDICATOR_DATA: IndicatorSeed[] = [
    { code: 'program-accreditation', name_ar: 'الاعتماد البرامجي', name_en: 'Program Accreditation', criteria: [
        { code: 'workshops', name_ar: 'عقد ورش تثقيفية عن المتطلبات', type: 'checklist', weight: 1 },
        { code: 'committees', name_ar: 'تشكيل لجان خاصة لمتطلبات الاعتماد البرامجي', type: 'checklist', weight: 1 },
        { code: 'self-study-25', name_ar: 'اكمال 25% من تقرير التقييم الذاتي', type: 'checklist', weight: 1 },
        { code: 'self-study-50', name_ar: 'اكمال 50% من تقرير التقييم الذاتي', type: 'checklist', weight: 1 },
        { code: 'self-study-75', name_ar: 'اكمال 75% من تقرير التقييم الذاتي', type: 'checklist', weight: 1 },
        { code: 'self-study-100', name_ar: 'اكمال 100% من تقرير التقييم الذاتي', type: 'checklist', weight: 1 },
        { code: 'improvement-plan', name_ar: 'إعداد خطة التحسين', type: 'checklist', weight: 1 },
    ]},
    { code: 'labs-evaluation', name_ar: 'تقييم المختبرات', name_en: 'Labs Evaluation', criteria: [
        { code: 'labs-score', name_ar: 'تقييم المختبرات', type: 'percentage', weight: 1 },
    ]},
    { code: 'program-description', name_ar: 'وصف البرنامج', name_en: 'Program Description', criteria: [
        { code: 'program-desc', name_ar: 'دقة ومطابقة وصف البرنامج', type: 'checklist', weight: 1 },
    ]},
    { code: 'course-description', name_ar: 'وصف المقرر', name_en: 'Course Description', criteria: [
        { code: 'courses-uploaded', name_ar: 'نسبة رفع وصف المقررات', type: 'ratio', weight: 1,
          config: { numerator_label_ar: 'عدد المقررات المرفوع', denominator_label_ar: 'عدد المقررات المطلوب' } },
    ]},
    { code: 'curriculum-update', name_ar: 'المناهج والتحديث', name_en: 'Curriculum & Updates', criteria: [
        { code: 'update-form', name_ar: 'استمارة تحديث المقررات (وفق أهداف التنمية المستدامة)', type: 'binary', weight: 0.5,
          config: { ai_guidance: 'ابحث ضمن المستندات المرفقة عن استمارة تحديث المقررات الدراسية (نموذج وزارة التعليم العالي، رمز الاستمارة UOWA-00-11). اجعل met=true إذا توفّرت استمارة واحدة على الأقل مستوفية للشروط: (أ) أن تكون استمارة تحديث منهج/مقرر لا مستنداً آخر؛ (ب) أن تكون حقولها معبّأة فعلياً (القسم، اسم المقرر ورمزه، اسم التدريسي، جوانب التحديث وربطها بأهداف التنمية المستدامة)؛ (ج) أن تحمل توقيع التدريسي أو الجهة المخوّلة وتاريخاً. وإلا met=false. اذكر أسماء الملفات وما يدل على التوقيع.' } },
        { code: 'curriculum-comparison', name_ar: 'مقارنة المناهج مع الجامعات العالمية', type: 'binary', weight: 0.5,
          config: { ai_guidance: 'ابحث عن محضر اجتماع للجنة العلمية موضوعه مقارنة مناهج القسم مع مناهج جامعة عالمية رصينة. اجعل met=true إذا تضمّن المحضر: (أ) تاريخاً وأسماء أعضاء اللجنة (ويفضّل توقيعهم)؛ (ب) تحديد الجامعة أو الجهة المرجعية التي جرت المقارنة معها؛ (ج) نتيجة المقارنة (نسبة المطابقة أو التوصيات). وإلا met=false. اذكر اسم الملف والجامعة المرجعية ونتيجة المقارنة.' } },
    ]},
    { code: 'community-service', name_ar: 'خدمة مجتمع', name_en: 'Community Service', criteria: [
        { code: 'orders-minutes', name_ar: 'أوامر إدارية + محضر', type: 'checklist', weight: 0.5 },
        { code: 'service-plan', name_ar: 'خطة خدمة المجتمع', type: 'checklist', weight: 0.5 },
    ]},
    { code: 'compliance-rules', name_ar: 'قواعد الامتثال', name_en: 'Compliance Rules', criteria: [
        { code: 'student-faculty-ratio', name_ar: 'الامتثال لنسبة الطلبة إلى التدريسيين', type: 'ratio', weight: 1,
          config: { numerator_label_ar: 'عدد التدريسيين المتاح', denominator_label_ar: 'عدد التدريسيين المطلوب' } },
    ]},
    { code: 'faculty-evaluation', name_ar: 'تقييم التدرسيين', name_en: 'Faculty Evaluation', criteria: [
        { code: 'student-survey-avg', name_ar: 'متوسط تقييم الطلبة للتدريسيين', type: 'percentage', weight: 0.7 },
        { code: 'head-evaluation', name_ar: 'تقييم رئيس القسم للتدريسيين', type: 'percentage', weight: 0.3 },
    ]},
    { code: 'student-survey', name_ar: 'استبانة تقييم الطلبة', name_en: 'Student Survey', criteria: [
        { code: 'survey', name_ar: 'الاستبانة', type: 'checklist', weight: 0.5 },
        { code: 'recommendations', name_ar: 'التوصيات', type: 'checklist', weight: 0.5 },
    ]},
    { code: 'labor-market', name_ar: 'متطلبات سوق العمل', name_en: 'Labor Market Requirements', criteria: [
        { code: 'advisory-council', name_ar: 'المجلس الاستشاري', type: 'checklist', weight: 0.25 },
        { code: 'meeting-minutes', name_ar: 'محضر اجتماع', type: 'checklist', weight: 0.25 },
        { code: 'survey-analysis', name_ar: 'استمارة وتحليل سوق العمل', type: 'checklist', weight: 0.5 },
    ]},
    { code: 'institutional-accreditation', name_ar: 'الاعتماد المؤسسي', name_en: 'Institutional Accreditation', criteria: [
        { code: 'self-eval-report', name_ar: 'تقرير التقييم الذاتي', type: 'checklist', weight: 0.5 },
        { code: 'improvement-plan', name_ar: 'خطة التحسين المؤسسية', type: 'checklist', weight: 0.5 },
    ]},
    { code: 'student-representation', name_ar: 'ممثلية الطلبة', name_en: 'Student Representation', criteria: [
        { code: 'admin-order', name_ar: 'أمر إداري', type: 'checklist', weight: 0.5 },
        { code: 'meeting-minutes', name_ar: 'محضر اجتماع الطلبة', type: 'checklist', weight: 0.5 },
    ]},
    { code: 'learning-outcomes', name_ar: 'نتاجات التعلم', name_en: 'Learning Outcomes', criteria: [
        { code: 'published-on-website', name_ar: 'معلن على الموقع', type: 'checklist', weight: 0.5 },
        { code: 'meeting-minutes', name_ar: 'محضر اجتماع نتاجات التعلم', type: 'checklist', weight: 0.5 },
    ]},
];

interface DepartmentSeed { code: string; name_ar: string; name_en: string; }
interface CollegeSeed { code: string; name_ar: string; name_en: string; depts: DepartmentSeed[]; }

// real college / department structure, reconstructed from the department's report
const COLLEGE_DATA: CollegeSeed[] = [
    { code: 'ISL', name_ar: 'كلية العلوم الإسلامية', name_en: 'College of Islamic Sciences', depts: [
        { code: 'ISL-GEN', name_ar: 'العلوم الاسلاميه', name_en: 'Islamic Sciences (General)' },
        { code: 'QURAN', name_ar: 'علوم القران', name_en: 'Quran Sciences' },
        { code: 'FIQH', name_ar: 'الفقه والأصول', name_en: 'Jurisprudence & Fundamentals' },
    ]},
    { code: 'ADM', name_ar: 'كلية الإدارة والاقتصاد', name_en: 'College of Administration & Economics', depts: [
        { code: 'ADM-GEN', name_ar: 'ادارة واقتصاد', name_en: 'Administration & Economics (General)' },
        { code: 'FIN', name_ar: 'علوم مالية ومصرفية', name_en: 'Financial & Banking Sciences' },
        { code: 'BUS', name_ar: 'اداره اعمال', name_en: 'Business Administration' },
        { code: 'ACC', name_ar: 'المحاسبه', name_en: 'Accounting' },
        { code: 'HCM', name_ar: 'إدارة المؤسسات الصحية', name_en: 'Healthcare Management' },
        { code: 'OGE', name_ar: 'اقتصاديات النفط والغاز', name_en: 'Oil & Gas Economics' },
    ]},
    { code: 'SCI', name_ar: 'كلية العلوم', name_en: 'College of Science', depts: [
        { code: 'SCI-GEN', name_ar: 'العلوم', name_en: 'Science (General)' },
        { code: 'FORN', name_ar: 'الأدلة الجنائية', name_en: 'Forensic Science' },
        { code: 'MPHY', name_ar: 'الفيزياء الطبيه', name_en: 'Medical Physics' },
        { code: 'IT', name_ar: 'تكنلوجيا المعلومات', name_en: 'Information Technology' },
    ]},
    { code: 'ENG', name_ar: 'كلية الهندسة', name_en: 'College of Engineering', depts: [
        { code: 'CIVIL', name_ar: 'هندسة المدني', name_en: 'Civil Engineering' },
        { code: 'HVAC', name_ar: 'هندسة التكييف والتبريد', name_en: 'HVAC Engineering' },
        { code: 'BME', name_ar: 'هندسة الطب الحياتي', name_en: 'Biomedical Engineering' },
        { code: 'PETRO', name_ar: 'هندسة النفط والغاز', name_en: 'Petroleum Engineering' },
        { code: 'AERO', name_ar: 'هندسة الطائرات', name_en: 'Aerospace Engineering' },
    ]},
    { code: 'MED', name_ar: 'كلية الطب', name_en: 'College of Medicine', depts: [
        { code: 'MED-GEN', name_ar: 'الطب', name_en: 'Medicine' },
    ]},
    { code: 'LAW', name_ar: 'كلية القانون', name_en: 'College of Law', depts: [
        { code: 'LAW-GEN', name_ar: 'القانون', name_en: 'Law' },
    ]},
    { code: 'NRS', name_ar: 'كلية التمريض', name_en: 'College of Nursing', depts: [
        { code: 'NRS-GEN', name_ar: 'التمريض', name_en: 'Nursing' },
    ]},
    { code: 'MDA', name_ar: 'كلية الاعلام', name_en: 'College of Media', depts: [
        { code: 'MDA-GEN', name_ar: 'الاعلام', name_en: 'Media (General)' },
        { code: 'DMDA', name_ar: 'الاعلام الرقمي', name_en: 'Digital Media' },
        { code: 'ADMKT', name_ar: 'الإعلان والاتصال والتسويق', name_en: 'Advertising, Communication & Marketing' },
    ]},
    { code: 'MET', name_ar: 'كلية التقنيات الهندسة الحديثة', name_en: 'College of Modern Engineering Technologies', depts: [
        { code: 'ELEC-TECH', name_ar: 'تقنيات الهندسة الكهربائية', name_en: 'Electrical Engineering Technologies' },
        { code: 'RAD-TECH', name_ar: 'تقنيات الاشعة والطب النووي', name_en: 'Radiology & Nuclear Medicine Technologies' },
        { code: 'DHEALTH-TECH', name_ar: 'تقنيات الصحة الرقمية الحديثة', name_en: 'Modern Digital Health Technologies' },
        { code: 'ROBOT-TECH', name_ar: 'تقنيات الروبوتات والذكاء الاصطناعي', name_en: 'Robotics & AI Technologies' },
    ]},
    { code: 'CSIT', name_ar: 'كلية علوم الحاسوب وتكنلوجيا المعلومات', name_en: 'College of Computer Science & IT', depts: [
        { code: 'AI', name_ar: 'الذكاء الاصطناعي', name_en: 'Artificial Intelligence' },
        { code: 'CYBER', name_ar: 'الامن السيبراني', name_en: 'Cybersecurity' },
    ]},
    { code: 'DENT', name_ar: 'كلية طب الاسنان', name_en: 'College of Dentistry', depts: [
        { code: 'DENT-GEN', name_ar: 'طب الاسنان', name_en: 'Dentistry' },
    ]},
    { code: 'PHARM', name_ar: 'كلية الصيدلة', name_en: 'College of Pharmacy', depts: [
        { code: 'PHARM-GEN', name_ar: 'الصيدلة', name_en: 'Pharmacy' },
    ]},
];

// indicators excluded from the monthly composite score by default (tracked, but informational —
// matches the real report, where "قواعد الامتثال" doesn't feed into "تقييم شامل")
const EXCLUDED_FROM_COMPOSITE = ['compliance-rules'];

async function seed() {
    await dropViews(sequelize);
    await sequelize.sync({ force: true });
    console.log('✅  Tables created');
    await ensureViews(sequelize);
    console.log('✅  Aggregation views created');

    // Users
    const [admin, , rep1, rep2, , repHealth] = await Promise.all([
        User.create({ email: 'admin@uowa.edu.iq', password: await bcrypt.hash('Admin@123', 12), full_name: 'QC Unit', full_name_ar: 'وحدة ضمان الجودة', role: 'admin' }),
        User.create({ email: 'qc.head@uowa.edu.iq', password: await bcrypt.hash('Head@123', 12), full_name: 'Head of QC Department', full_name_ar: 'رئيس قسم ضمان الجودة', role: 'qc_head' }),
        User.create({ email: 'rep.islamic@uowa.edu.iq', password: await bcrypt.hash('Rep@123', 12), full_name: 'Islamic Sciences Rep', full_name_ar: 'ممثل العلوم الاسلامية', role: 'dept_rep' }),
        User.create({ email: 'rep.eng@uowa.edu.iq', password: await bcrypt.hash('Rep@123', 12), full_name: 'Engineering Rep', full_name_ar: 'ممثل الهندسة', role: 'dept_rep' }),
        User.create({ email: 'viewer@uowa.edu.iq', password: await bcrypt.hash('View@123', 12), full_name: 'Viewer', full_name_ar: 'مشاهد', role: 'viewer' }),
        User.create({ email: 'rep.health@uowa.edu.iq', password: await bcrypt.hash('Rep@123', 12), full_name: 'Healthcare Mgmt Rep', full_name_ar: 'ممثل إدارة المؤسسات الصحية', role: 'dept_rep' }),
    ]);
    console.log('✅  Users created');

    // Colleges & departments
    const departments: Department[] = [];
    let firstDept: Department | null = null;
    let engDept: Department | null = null;
    let hcmDept: Department | null = null;
    for (const c of COLLEGE_DATA) {
        const college = await College.create({ name_en: c.name_en, name_ar: c.name_ar, code: c.code });
        for (const d of c.depts) {
            const dept = await Department.create({ name_en: d.name_en, name_ar: d.name_ar, code: d.code, college_id: college.id });
            departments.push(dept);
            if (c.code === 'ISL' && d.code === 'ISL-GEN') firstDept = dept;
            if (c.code === 'ENG' && d.code === 'CIVIL') engDept = dept;
            if (c.code === 'ADM' && d.code === 'HCM') hcmDept = dept;
        }
    }
    if (!firstDept || !engDept || !hcmDept) throw new Error('Expected seed departments were not created');
    console.log(`✅  ${COLLEGE_DATA.length} colleges, ${departments.length} departments created`);

    await DepartmentUser.bulkCreate([
        { department_id: firstDept.id, user_id: rep1.id, is_primary_contact: true },
        { department_id: engDept.id, user_id: rep2.id, is_primary_contact: true },
        { department_id: hcmDept.id, user_id: repHealth.id, is_primary_contact: true },
    ]);

    // Indicators & criteria
    const indicators: Indicator[] = [];
    const criteriaByIndicatorCode: Record<string, IndicatorCriterion[]> = {};
    for (let i = 0; i < INDICATOR_DATA.length; i++) {
        const ind = INDICATOR_DATA[i];
        const indicator = await Indicator.create({
            code: ind.code, name_en: ind.name_en, name_ar: ind.name_ar, sort_order: i, created_by: admin.id,
        });
        indicators.push(indicator);
        const criteria = await IndicatorCriterion.bulkCreate(ind.criteria.map((c, j) => ({
            indicator_id: indicator.id, code: c.code, name_en: c.name_ar, name_ar: c.name_ar,
            criterion_type: c.type, weight: c.weight, config: c.config || {}, sort_order: j,
        })), { returning: true });
        criteriaByIndicatorCode[ind.code] = criteria;
    }
    console.log(`✅  ${indicators.length} indicators with criteria created`);

    // Evaluation period
    const period = await EvaluationPeriod.create({
        year: 2026, month: 3, label_en: 'March 2026', label_ar: 'مارس 2026',
        status: 'under_review', submission_deadline: new Date('2026-04-15'), created_by: admin.id,
    });
    await PeriodIndicator.bulkCreate(indicators.map((ind, i) => ({
        period_id: period.id, indicator_id: ind.id, weight: 1.0, sort_order: i,
        is_active: !EXCLUDED_FROM_COMPOSITE.includes(ind.code),
    })));
    console.log('✅  Evaluation period created');

    // Sample submissions + evaluations for the two departments with assigned reps
    for (const dept of [firstDept, engDept]) {
        for (const ind of indicators) {
            for (const criterion of criteriaByIndicatorCode[ind.code]) {
                const submission = await Submission.create({
                    period_id: period.id, department_id: dept.id, criterion_id: criterion.id,
                    status: 'reviewed', submitted_by: dept.id === firstDept.id ? rep1.id : rep2.id, submitted_at: new Date(),
                });
                const score = 0.75 + Math.random() * 0.25;
                await Evaluation.create({
                    period_id: period.id, department_id: dept.id, criterion_id: criterion.id, submission_id: submission.id,
                    score: Math.round(score * 100) / 100, evaluated_by: admin.id, evaluation_method: 'manual', evaluated_at: new Date(),
                });
            }
        }
    }
    console.log('✅  Sample submissions and evaluations created');

    // Real evidence for the AI assessor: the Healthcare-Management dept's actual
    // curriculum-update forms and global-comparison minutes (from the QC Drive folder),
    // attached — but left UNevaluated — so POST /api/evaluations/ai fills them in.
    // Source PDFs live in backend/seed-assets/hcm-curriculum/ (see its README).
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const seedAssetsDir = path.join(__dirname, '../seed-assets/hcm-curriculum');
    const curriculumEvidence: Record<string, Array<{ asset: string; display: string }>> = {
        'update-form': [
            { asset: 'forms/computer.pdf',           display: 'استمارة تحديث منهج الحاسوب.pdf' },
            { asset: 'forms/english.pdf',            display: 'استمارة تحديث منهج اللغة الانكليزية.pdf' },
            { asset: 'forms/economics.pdf',          display: 'استمارة تحديث مادة مبادئ الاقتصاد.pdf' },
            { asset: 'forms/statistics.pdf',         display: 'استمارة تحديث مادة الاحصاء.pdf' },
            { asset: 'forms/medical-terms.pdf',      display: 'استمارة تحديث مادة المصطلحات الطبية.pdf' },
            { asset: 'forms/health-it.pdf',          display: 'استمارة تحديث مادة تكنولوجيا المعلومات للمهن الصحية.pdf' },
            { asset: 'forms/behavioral-ethics.pdf',  display: 'استمارة تحديث العلوم السلوكية والاخلاقية.pdf' },
        ],
        'curriculum-comparison': [
            { asset: 'comparison/comparison-minutes.pdf', display: 'محضر اجتماع مقارنة المناهج مع الجامعات العالمية.pdf' },
        ],
    };
    const curriculumCriteria = criteriaByIndicatorCode['curriculum-update'];
    let evidenceCount = 0;
    for (const c of curriculumCriteria) {
        // Only attach assets that are actually present. If none are (e.g. you upload the
        // evidence through the frontend instead), leave the criterion blank for the rep.
        const files = (curriculumEvidence[c.code] || []).filter(f => fs.existsSync(path.join(seedAssetsDir, f.asset)));
        if (files.length === 0) continue;
        // Fresh submission for HCM (no manual Evaluation — the AI assessor scores it).
        const submission = await Submission.create({
            period_id: period.id, department_id: hcmDept.id, criterion_id: c.id,
            status: 'submitted', submitted_by: repHealth.id, submitted_at: new Date(),
        });
        for (const f of files) {
            const src = path.join(seedAssetsDir, f.asset);
            const storedName = `seed-hcm-${c.code}-${path.basename(f.asset)}`;
            fs.copyFileSync(src, path.join(uploadDir, storedName));
            await SubmissionDocument.create({
                submission_id: submission.id, file_name: f.display, storage_provider: 'local',
                storage_path: storedName, mime_type: 'application/pdf', size_bytes: fs.statSync(src).size, uploaded_by: repHealth.id,
            });
            evidenceCount++;
        }
    }
    if (evidenceCount > 0) {
        console.log(`✅  ${evidenceCount} real evidence documents attached (HCM / المناهج والتحديث)`);
    } else {
        console.log('ℹ️   No local seed-assets found — HCM curriculum left blank for upload via the frontend');
    }

    console.log('\n🎉  Seed complete!');
    console.log('\n📋  Login credentials:');
    console.log('   Admin (QC unit):  admin@uowa.edu.iq / Admin@123');
    console.log('   QC Head:          qc.head@uowa.edu.iq / Head@123');
    console.log('   Dept Rep:         rep.islamic@uowa.edu.iq / Rep@123');
    console.log('   Dept Rep:         rep.eng@uowa.edu.iq / Rep@123');
    console.log('   Dept Rep (HCM):   rep.health@uowa.edu.iq / Rep@123');
    console.log('   Viewer:           viewer@uowa.edu.iq / View@123');
    process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
