import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../models';

interface JwtPayload {
    id: string;
    role: UserRole;
    email: string;
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'No token provided' });
        return;
    }
    try {
        const token = header.split(' ')[1];
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'supersecret') as JwtPayload;
        const user = await User.findByPk(payload.id, { attributes: { exclude: ['password'] } });
        if (!user || !user.is_active) {
            res.status(401).json({ error: 'User not found or inactive' });
            return;
        }
        req.user = user;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
};

export const authorize = (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
    }
    next();
};
