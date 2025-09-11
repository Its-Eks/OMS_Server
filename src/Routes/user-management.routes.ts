import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { 
  getUserStats,
  listUsers,
  createUserAdmin,
  updateUserAdmin,
  deactivateUserAdmin,
  reactivateUserAdmin,
  resetPasswordAdmin,
  deleteUserAdmin,
  getUserDetail
} from '../Controllers/user-management.controller.ts';

const router = Router();

router.use(authenticate);

// Stats
router.get('/stats', authorize(['admin:manage_users']), getUserStats);

// List with filters: role, status, search
router.get('/', authorize(['admin:manage_users']), listUsers);
router.get('/:id', authorize(['admin:manage_users']), getUserDetail);

// CRUD
router.post('/', authorize(['admin:manage_users']), createUserAdmin);
router.put('/:id', authorize(['admin:manage_users']), updateUserAdmin);
router.post('/:id/deactivate', authorize(['admin:manage_users']), deactivateUserAdmin);
router.post('/:id/reactivate', authorize(['admin:manage_users']), reactivateUserAdmin);
router.post('/:id/reset-password', authorize(['admin:manage_users']), resetPasswordAdmin);
router.delete('/:id', authorize(['admin:manage_users']), deleteUserAdmin);

export default router;


