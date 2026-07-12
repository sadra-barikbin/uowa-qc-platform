import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { User } from '../models';
import { authenticate } from '../middleware/auth';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';

const signToken = (user: User) => jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES } as SignOptions
);

// POST /api/auth/login
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
], async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = await User.findOne({ where: { email, is_active: true } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    await user.update({ last_login: new Date() });
    const token = signToken(user);
    res.json({
        token,
        user: {
            id: user.id, email: user.email, full_name: user.full_name,
            full_name_ar: user.full_name_ar, role: user.role, avatar_url: user.avatar_url,
        },
    });
});

// GET /api/auth/me
router.get('/me', authenticate, (req: Request, res: Response) => {
    res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, [
    body('current_password').notEmpty(),
    body('new_password').isLength({ min: 8 }),
], async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { current_password, new_password } = req.body;
    const user = await User.findByPk(req.user!.id);
    if (!user || !(await bcrypt.compare(current_password, user.password))) {
        return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await user.update({ password: await bcrypt.hash(new_password, 12) });
    res.json({ message: 'Password updated successfully' });
});

export default router;
