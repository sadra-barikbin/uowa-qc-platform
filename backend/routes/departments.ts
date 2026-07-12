import { Router, Request, Response } from 'express';
import { Department, College, User, DepartmentUser } from '../models';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET /api/departments
router.get('/', authenticate, async (req: Request, res: Response) => {
    const departments = await Department.findAll({
        where: { is_active: true },
        include: [
            { model: College, as: 'college', attributes: ['id', 'name_en', 'name_ar'] },
            { model: User, as: 'representatives', attributes: ['id', 'full_name', 'full_name_ar', 'email'], through: { attributes: ['is_primary_contact'] } },
        ],
        order: [['name_ar', 'ASC']],
    });
    res.json({ departments });
});

// GET /api/departments/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
    const dept = await Department.findByPk(req.params.id, {
        include: [
            { model: College, as: 'college' },
            { model: User, as: 'representatives', attributes: ['id', 'full_name', 'full_name_ar', 'email'], through: { attributes: ['is_primary_contact'] } },
        ],
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    res.json({ department: dept });
});

// POST /api/departments
router.post('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { name_en, name_ar, code, college_id, drive_folder_url } = req.body;
    if (!name_ar || !code) return res.status(400).json({ error: 'name_ar and code are required' });
    const dept = await Department.create({ name_en: name_en || name_ar, name_ar, code, college_id, drive_folder_url });
    res.status(201).json({ department: dept });
});

// PUT /api/departments/:id
router.put('/:id', authenticate, authorize('admin', 'qc_head'), async (req: Request, res: Response) => {
    const dept = await Department.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    await dept.update(req.body);
    res.json({ department: dept });
});

// DELETE /api/departments/:id
router.delete('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const dept = await Department.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    await dept.update({ is_active: false });
    res.json({ message: 'Department deactivated' });
});

// GET /api/departments/colleges/list
router.get('/colleges/list', authenticate, async (req: Request, res: Response) => {
    const colleges = await College.findAll({ where: { is_active: true }, order: [['name_ar', 'ASC']] });
    res.json({ colleges });
});

// POST /api/departments/:id/representatives — assign a dept_rep user to this department
router.post('/:id/representatives', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { user_id, is_primary_contact } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const dept = await Department.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const [link] = await DepartmentUser.findOrCreate({
        where: { department_id: req.params.id, user_id },
        defaults: { department_id: req.params.id, user_id, is_primary_contact: !!is_primary_contact },
    });
    res.status(201).json({ link });
});

// DELETE /api/departments/:id/representatives/:userId
router.delete('/:id/representatives/:userId', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    await DepartmentUser.destroy({ where: { department_id: req.params.id, user_id: req.params.userId } });
    res.json({ message: 'Representative unassigned' });
});

export default router;
