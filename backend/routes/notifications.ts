import { Router, Request, Response } from 'express';
import { Notification } from '../models';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET /api/notifications
router.get('/', authenticate, async (req: Request, res: Response) => {
    const notifications = await Notification.findAll({
        where: { user_id: req.user!.id },
        order: [['createdAt', 'DESC']],
        limit: 50,
    });
    const unread_count = notifications.filter(n => !n.is_read).length;
    res.json({ notifications, unread_count });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, async (req: Request, res: Response) => {
    await Notification.update({ is_read: true }, { where: { id: req.params.id, user_id: req.user!.id } });
    res.json({ message: 'Marked as read' });
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, async (req: Request, res: Response) => {
    await Notification.update({ is_read: true }, { where: { user_id: req.user!.id, is_read: false } });
    res.json({ message: 'All notifications marked as read' });
});

// POST /api/notifications  (admin: send to specific user or dept)
router.post('/', authenticate, authorize('admin'), async (req: Request, res: Response) => {
    const { user_id, department_id, type, title_en, title_ar, message_en, message_ar, priority } = req.body;
    const notif = await Notification.create({ user_id, department_id, type: type || 'system', title_en, title_ar, message_en, message_ar, priority: priority || 'normal' });
    res.status(201).json({ notification: notif });
});

export default router;
