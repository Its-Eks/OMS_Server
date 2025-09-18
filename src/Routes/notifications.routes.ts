import { Router } from 'express';
import { NotificationsController } from '../Controllers/notifications.controller.ts';
import { authenticate } from '../Middleware/authMiddleware.ts';

const router = Router();
const controller = new NotificationsController();

/**
 * GET /notifications/my
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns notifications targeted to the authenticated user's userId/role.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "_id": "...",
 *         "type": "user_first_login",
 *         "title": "First login successful",
 *         "message": "User user@example.com logged in for the first time.",
 *         "targets": { "roles": ["System Administrator"] },
 *         "status": "pending",
 *         "createdAt": "2025-09-18T09:00:00.000Z"
 *       }
 *     ]
 *   }
 */
router.get('/my', authenticate as any, (req, res) => controller.my(req, res));
/**
 * POST /notifications/read
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Body:
 *   { "notificationIds": ["<notifId1>", "<notifId2>"] }
 * Description:
 *   Marks the specified notifications as read for the current user.
 * Sample Response:
 *   { "success": true, "data": { "updated": 2 } }
 */
router.post('/read', authenticate as any, (req, res) => controller.markRead(req, res));

// Admin-only routes should be gated in middleware in real usage
/**
 * GET /notifications/admin
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns all pending/delivered notifications. Intended for System Administrators.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [ { "_id": "...", "type": "password_link_expired", ... } ]
 *   }
 */
router.get('/admin', authenticate as any, (req, res) => controller.admin(req, res));
/**
 * POST /notifications/rules
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Body (examples):
 *   {
 *     "eventType": "user_first_login",
 *     "routeTo": { "roles": ["System Administrator"] },
 *     "systemAdminOnly": true,
 *     "dedupeWindowMinutes": 1440
 *   }
 *   {
 *     "eventType": "password_link_expired",
 *     "routeTo": { "roles": ["System Administrator"] },
 *     "systemAdminOnly": true,
 *     "dedupeWindowMinutes": 60
 *   }
 * Description:
 *   Upserts a routing rule that maps an eventType to target roles/userIds with optional dedupe window.
 * Sample Response:
 *   { "success": true, "data": { "ok": true } }
 */
router.post('/rules', authenticate as any, (req, res) => controller.upsertRule(req, res));

// Internal event emitter (can be protected behind internal auth)
/**
 * POST /notifications/events
 * Headers:
 *   - Authorization: Bearer <TOKEN> (optional; protect as needed)
 * Body (examples):
 *   {
 *     "type": "user_first_login",
 *     "userId": "<USER_UUID>",
 *     "metadata": { "email": "user@example.com" }
 *   }
 *   {
 *     "type": "password_link_expired",
 *     "userId": "<USER_UUID>",
 *     "metadata": { "email": "user@example.com" }
 *   }
 * Description:
 *   Enqueues a user event. A background job converts events into notifications based on rules.
 * Sample Response:
 *   { "success": true, "data": { "id": "<insertedId>" } }
 */
router.post('/events', (req, res) => controller.emitEvent(req, res));

export default router;


