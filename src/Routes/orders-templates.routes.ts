import { Router } from 'express';
import { OrdersTemplatesController } from '../Controllers/orders-templates.controller.ts';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';

const router = Router();
const controller = new OrdersTemplatesController();

router.use(authenticate);

/**
 * GET /orders-templates
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query:
 *   - orderType?: 'new_installation' | 'service_change'
 *   - status?: string (order status)
 *   - isActive?: boolean
 * Description:
 *   Returns all order email templates, optionally filtered by order type and status.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "_id": "...",
 *         "key": "new_installation_confirmed",
 *         "orderType": "new_installation",
 *         "triggerStatus": "confirmed",
 *         "subject": "Installation Confirmed - Order {{orderNumber}}",
 *         "html": "<p>Hi {{customerName}}, your installation has been confirmed...</p>",
 *         "text": "Hi {{customerName}}, your installation has been confirmed...",
 *         "isActive": true,
 *         "createdAt": "2025-10-02T...",
 *         "updatedAt": "2025-10-02T..."
 *       }
 *     ]
 *   }
 */
router.get('/', authorize(['admin:manage_roles', 'orders:view']), (req, res) => controller.getTemplates(req, res));

/**
 * GET /orders-templates/:id
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns a specific order email template by ID.
 */
router.get('/:id', authorize(['admin:manage_roles', 'orders:view']), (req, res) => controller.getTemplate(req, res));

/**
 * POST /orders-templates
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Body:
 *   {
 *     "key": "new_installation_confirmed",
 *     "orderType": "new_installation",
 *     "triggerStatus": "confirmed",
 *     "subject": "Installation Confirmed - Order {{orderNumber}}",
 *     "html": "<p>Hi {{customerName}}, your installation has been confirmed for {{installationDate}}.</p>",
 *     "text": "Hi {{customerName}}, your installation has been confirmed for {{installationDate}}.",
 *     "isActive": true
 *   }
 * Description:
 *   Creates a new order email template.
 */
router.post('/', authorize(['admin:manage_roles']), (req, res) => controller.createTemplate(req, res));

/**
 * PUT /orders-templates/:id
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Body: (same as POST, all fields optional)
 * Description:
 *   Updates an existing order email template.
 */
router.put('/:id', authorize(['admin:manage_roles']), (req, res) => controller.updateTemplate(req, res));

/**
 * DELETE /orders-templates/:id
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Deletes an order email template.
 */
router.delete('/:id', authorize(['admin:manage_roles']), (req, res) => controller.deleteTemplate(req, res));

/**
 * POST /orders-templates/seed-defaults
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Seeds the database with default order email templates for new installation and service change workflows.
 */
router.post('/seed-defaults', authorize(['admin:manage_roles']), (req, res) => controller.seedDefaults(req, res));

/**
 * POST /orders-templates/trigger
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Body:
 *   {
 *     "orderId": "uuid",
 *     "orderType": "new_installation",
 *     "status": "confirmed",
 *     "customerEmail": "customer@example.com",
 *     "templateData": {
 *       "customerName": "John Doe",
 *       "orderNumber": "ORD-123",
 *       "installationDate": "2025-10-15"
 *     }
 *   }
 * Description:
 *   Manually trigger an order email based on order type and status.
 */
router.post('/trigger', authorize(['orders:manage', 'admin:manage_roles']), (req, res) => controller.triggerEmail(req, res));

/**
 * GET /orders-templates/preview/:id
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query:
 *   - customerName?: string
 *   - orderNumber?: string
 *   - installationDate?: string
 *   - (other template variables)
 * Description:
 *   Preview a template with sample data for testing.
 */
router.get('/preview/:id', authorize(['admin:manage_roles', 'orders:view']), (req, res) => controller.previewTemplate(req, res));

export default router;
