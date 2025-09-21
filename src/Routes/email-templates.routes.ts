import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { mongodb } from '../Database/main.ts';

const router = Router();

router.use(authenticate);

router.get('/', authorize(['templates:view', 'notifications:templates_view', 'onboarding:manage', 'admin:system_config', 'admin']), async (req, res) => {
  try {
    if (!mongodb) return res.json({ success: true, data: [] });
    const docs = await mongodb.collection('email_templates').find({}, { projection: { _id: 0 } }).toArray();
    res.json({ success: true, data: docs });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to list templates' } });
  }
});

router.get('/:key', authorize(['templates:view', 'notifications:templates_view', 'onboarding:manage', 'admin:system_config', 'admin']), async (req, res) => {
  try {
    if (!mongodb) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    const doc = await mongodb.collection('email_templates').findOne({ key: req.params.key }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    res.json({ success: true, data: doc });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to get template' } });
  }
});

router.post('/', authorize(['templates:manage', 'notifications:templates_manage', 'onboarding:manage', 'admin:system_config', 'admin']), async (req, res) => {
  try {
    if (!mongodb) return res.status(503).json({ success: false, error: { message: 'MongoDB not connected' } });
    const { key, subject, html, text, isActive } = req.body || {};
    if (!key || !subject) return res.status(400).json({ success: false, error: { message: 'key and subject are required' } });
    await mongodb.collection('email_templates').updateOne(
      { key },
      { $set: { key, subject, html, text, isActive: isActive !== false, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    res.status(201).json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to upsert template' } });
  }
});

router.patch('/:key', authorize(['templates:manage', 'notifications:templates_manage', 'onboarding:manage', 'admin:system_config', 'admin']), async (req, res) => {
  try {
    if (!mongodb) return res.status(503).json({ success: false, error: { message: 'MongoDB not connected' } });
    const { subject, html, text, isActive } = req.body || {};
    const update: any = { updatedAt: new Date() };
    if (subject !== undefined) update.subject = subject;
    if (html !== undefined) update.html = html;
    if (text !== undefined) update.text = text;
    if (isActive !== undefined) update.isActive = isActive;
    const r = await mongodb.collection('email_templates').updateOne({ key: req.params.key }, { $set: update });
    if (!r.matchedCount) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to update template' } });
  }
});

router.delete('/:key', authorize(['templates:manage', 'notifications:templates_manage', 'onboarding:manage', 'admin:system_config', 'admin']), async (req, res) => {
  try {
    if (!mongodb) return res.status(503).json({ success: false, error: { message: 'MongoDB not connected' } });
    const r = await mongodb.collection('email_templates').deleteOne({ key: req.params.key });
    if (!r.deletedCount) return res.status(404).json({ success: false, error: { message: 'Not found' } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to delete template' } });
  }
});

export default router;


