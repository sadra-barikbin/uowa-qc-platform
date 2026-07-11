const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { User, Department } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/users  (admin only)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
    const users = await User.findAll({
        attributes: { exclude: ['password'] },
        order: [['created_at', 'DESC']],
    });
    res.json({ users });
});

// POST /api/users  (admin only)
router.post('/', authenticate, authorize('admin'), [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('full_name').notEmpty().trim(),
    body('role').isIn(['admin', 'qc_head', 'dept_rep', 'viewer']),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, full_name, full_name_ar, role } = req.body;
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const user = await User.create({
        email, full_name, full_name_ar, role,
        password: await bcrypt.hash(password, 12),
    });
    const { password: _, ...safeUser } = user.toJSON();
    res.status(201).json({ user: safeUser });
});

// PUT /api/users/:id
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { full_name, full_name_ar, role, is_active, password } = req.body;
    const updates = { full_name, full_name_ar, role, is_active };
    if (password) updates.password = await bcrypt.hash(password, 12);

    await user.update(updates);
    const { password: _, ...safeUser } = user.toJSON();
    res.json({ user: safeUser });
});

// DELETE /api/users/:id
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await user.update({ is_active: false });
    res.json({ message: 'User deactivated' });
});

module.exports = router;
