import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { listRoles, createRole, updateRole, assignUserRole } from '../Controllers/roles.controller.ts';

const router = Router();

router.use(authenticate);

router.get('/', authorize(['admin:manage_roles']), listRoles);
router.post('/', authorize(['admin:manage_roles']), createRole);
router.put('/:id', authorize(['admin:manage_roles']), updateRole);
router.post('/assign', authorize(['admin:manage_users']), assignUserRole);

export default router;

