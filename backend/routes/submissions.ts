import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
    Submission, SubmissionDocument, IndicatorCriterion, Indicator,
    DepartmentUser, EvaluationPeriod, PeriodIndicator, User,
} from '../models';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// A dept_rep may only act on departments they are assigned to; admin/qc_head can act on any
async function assertDepartmentAccess(req: Request, department_id: string): Promise<boolean> {
    if (['admin', 'qc_head'].includes(req.user!.role)) return true;
    const link = await DepartmentUser.findOne({ where: { department_id, user_id: req.user!.id } });
    return !!link;
}

// GET /api/submissions?period_id=&department_id=
router.get('/', authenticate, authorize('admin', 'qc_head', 'dept_rep'), async (req: Request, res: Response) => {
    const { period_id, department_id, criterion_id } = req.query as Record<string, string | undefined>;
    if (!department_id && !['admin', 'qc_head'].includes(req.user!.role)) {
        return res.status(400).json({ error: 'department_id is required' });
    }
    const where: Record<string, string> = {};
    if (period_id) where.period_id = period_id;
    if (department_id) where.department_id = department_id;
    if (criterion_id) where.criterion_id = criterion_id;

    if (department_id && !(await assertDepartmentAccess(req, department_id))) {
        return res.status(403).json({ error: 'Not assigned to this department' });
    }

    const submissions = await Submission.findAll({
        where,
        include: [
            { model: IndicatorCriterion, as: 'criterion', include: [{ model: Indicator, as: 'indicator' }] },
            { model: SubmissionDocument, as: 'documents' },
            { model: User, as: 'submitter', attributes: ['id', 'full_name', 'full_name_ar'] },
        ],
        order: [['updatedAt', 'DESC']],
    });
    res.json({ submissions });
});

// GET /api/submissions/matrix?period_id=&department_id= — every criterion for the period,
// merged with this department's existing submission (or null if nothing uploaded yet)
router.get('/matrix', authenticate, async (req: Request, res: Response) => {
    const { period_id, department_id } = req.query as Record<string, string | undefined>;
    if (!period_id || !department_id) return res.status(400).json({ error: 'period_id and department_id are required' });
    if (!(await assertDepartmentAccess(req, department_id))) return res.status(403).json({ error: 'Not assigned to this department' });

    const period = await EvaluationPeriod.findByPk(period_id, {
        include: [{
            model: PeriodIndicator, as: 'period_indicators', where: { is_active: true }, required: false,
            include: [{ model: Indicator, as: 'indicator', include: [{ model: IndicatorCriterion, as: 'criteria', where: { is_active: true }, required: false }] }],
        }],
    });
    if (!period) return res.status(404).json({ error: 'Period not found' });

    const submissions = await Submission.findAll({
        where: { period_id, department_id },
        include: [{ model: SubmissionDocument, as: 'documents' }],
    });
    const byCriterion: Record<string, Submission> = {};
    submissions.forEach(s => { byCriterion[s.criterion_id] = s; });

    const matrix = (period.period_indicators || []).map(pi => ({
        indicator: { id: pi.indicator!.id, code: pi.indicator!.code, name_ar: pi.indicator!.name_ar, name_en: pi.indicator!.name_en },
        criteria: (pi.indicator!.criteria || []).map(c => ({
            criterion: c,
            submission: byCriterion[c.id] || null,
        })),
    }));

    res.json({ period, matrix });
});

// POST /api/submissions — create/update a submission (notes) for a dept/period/criterion
router.post('/', authenticate, authorize('admin', 'qc_head', 'dept_rep'), async (req: Request, res: Response) => {
    const { period_id, department_id, criterion_id, notes } = req.body;
    if (!period_id || !department_id || !criterion_id) {
        return res.status(400).json({ error: 'period_id, department_id, criterion_id are required' });
    }
    if (!(await assertDepartmentAccess(req, department_id))) return res.status(403).json({ error: 'Not assigned to this department' });

    const [submission, created] = await Submission.findOrCreate({
        where: { period_id, department_id, criterion_id },
        defaults: { period_id, department_id, criterion_id, notes, status: 'submitted', submitted_by: req.user!.id, submitted_at: new Date() },
    });
    if (!created) await submission.update({ notes, status: 'submitted', submitted_by: req.user!.id, submitted_at: new Date() });
    res.status(created ? 201 : 200).json({ submission });
});

// POST /api/submissions/:id/documents — attach evidence file(s)
router.post('/:id/documents', authenticate, authorize('admin', 'qc_head', 'dept_rep'), upload.array('files', 10), async (req: Request, res: Response) => {
    const submission = await Submission.findByPk(req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (!(await assertDepartmentAccess(req, submission.department_id))) return res.status(403).json({ error: 'Not assigned to this department' });
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ error: 'No files uploaded' });

    // multer/busboy decodes the multipart filename header as latin1, which mangles UTF-8
    // (Arabic) names; re-interpret the original bytes as UTF-8 to store the real name.
    const documents = await SubmissionDocument.bulkCreate(files.map(f => ({
        submission_id: submission.id, file_name: Buffer.from(f.originalname, 'latin1').toString('utf8'), storage_provider: 'local' as const,
        storage_path: f.filename, mime_type: f.mimetype, size_bytes: f.size, uploaded_by: req.user!.id,
    })));
    if (submission.status === 'pending') await submission.update({ status: 'submitted', submitted_by: req.user!.id, submitted_at: new Date() });
    res.status(201).json({ documents });
});

// GET /api/submissions/documents/:docId/download
router.get('/documents/:docId/download', authenticate, async (req: Request, res: Response) => {
    const doc = await SubmissionDocument.findByPk(req.params.docId, { include: [{ model: Submission, as: 'submission' }] });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!(await assertDepartmentAccess(req, doc.submission!.department_id))) return res.status(403).json({ error: 'Not assigned to this department' });
    if (doc.storage_provider !== 'local') return res.status(400).json({ error: 'Document is not stored locally' });
    res.download(path.join(uploadDir, doc.storage_path), doc.file_name);
});

// DELETE /api/submissions/documents/:docId
router.delete('/documents/:docId', authenticate, authorize('admin', 'qc_head', 'dept_rep'), async (req: Request, res: Response) => {
    const doc = await SubmissionDocument.findByPk(req.params.docId, { include: [{ model: Submission, as: 'submission' }] });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!(await assertDepartmentAccess(req, doc.submission!.department_id))) return res.status(403).json({ error: 'Not assigned to this department' });

    if (doc.storage_provider === 'local') {
        const filePath = path.join(uploadDir, doc.storage_path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await doc.destroy();
    res.json({ message: 'Document removed' });
});

export default router;
