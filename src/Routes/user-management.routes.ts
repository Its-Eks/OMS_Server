import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { auditMiddleware } from '../Middleware/audit.middleware.ts';
import { 
  getUserStats,
  listUsers,
  createUserAdmin,
  updateUserAdmin,
  deactivateUserAdmin,
  reactivateUserAdmin,
  resetPasswordAdmin,
  deleteUserAdmin,
  getUserDetail,
  getUserActivities
} from '../Controllers/user-management.controller.ts';

const router = Router();

router.use(authenticate);

// Stats
router.get('/stats', authorize(['admin:manage_users']), getUserStats);

// List with filters: role, status, search
router.get('/', authorize(['admin:manage_users']), listUsers);
router.get('/:id', authorize(['admin:manage_users']), getUserDetail);
router.get('/:id/activities', authorize(['admin:manage_users']), getUserActivities);

// CRUD
router.post('/', authorize(['admin:manage_users']), auditMiddleware('create', 'user'), createUserAdmin);
router.put('/:id', authorize(['admin:manage_users']), auditMiddleware('update', 'user'), updateUserAdmin);
router.post('/:id/deactivate', authorize(['admin:manage_users']), auditMiddleware('deactivate', 'user'), deactivateUserAdmin);
router.post('/:id/reactivate', authorize(['admin:manage_users']), auditMiddleware('reactivate', 'user'), reactivateUserAdmin);
router.post('/:id/reset-password', authorize(['admin:manage_users']), auditMiddleware('reset_password_request', 'user'), resetPasswordAdmin);
router.delete('/:id', authorize(['admin:manage_users']), auditMiddleware('delete', 'user'), deleteUserAdmin);

export default router;


