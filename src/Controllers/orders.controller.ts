import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';
import { OrdersService } from '../services/orders.service.ts';
import { FNOCommunicationService } from '../services/fno-communication.service.ts';
import { PolicyService } from '../services/policy.service.ts';

function makeOrdersService(req: Request): OrdersService {
  const db: Pool = req.app.get('pgPool');
  let mongo: MongoClient | null = req.app.get('mongoClient');
  if (!mongo) {
    // Fallback no-op Mongo client to avoid crashes if Mongo isn’t connected yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noop = {
      db: () => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        collection: () => ({ insertOne: async () => ({}), find: () => ({ sort: () => ({ toArray: async () => [] }) }), updateOne: async () => ({}) })
      })
    } as any;
    mongo = noop as unknown as MongoClient;
    // eslint-disable-next-line no-console
    console.warn('[orders] Mongo client not initialized; using no-op stub for FNO/Policy services');
  }
  const fnoComm = new FNOCommunicationService(mongo);
  const policy = new PolicyService(mongo);
  return new OrdersService(db, fnoComm, policy);
}

export async function getOrders(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 30); // 30 second cache for orders
    const cacheKey = buildCacheKey([
      'orders:list',
      JSON.stringify(req.query),
      String((req as any).user?.userId || 'anonymous')
    ]);

    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get orders with all necessary fields for the frontend
    const result = await db.query(`
      SELECT o.id, o.order_number, o.customer_id, o.order_type, o.service_type, o.status as current_state, 
             o.priority, o.installation_address as service_address, o.service_package, o.service_details,
             o.fno_id, o.fno_reference, o.created_at, o.updated_at, o.estimated_completion,
             o.is_paid, c.first_name, c.last_name, c.email as customer_email,
             f.name as fno_name, f.code as fno_code
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN fnos f ON f.id = o.fno_id
      ORDER BY o.created_at DESC
      LIMIT 50
    `);

    // Transform the data to match frontend expectations
    const transformedOrders = result.rows.map((row: any) => ({
      id: row.id,
      order_number: row.order_number,
      customer_id: row.customer_id,
      order_type: row.order_type || 'new_install',
      current_state: row.current_state,
      priority: row.priority,
      service_address: row.service_address,
      service_details: row.service_details || {
        serviceType: row.service_type,
        bandwidth: row.service_package,
        installationType: 'professional_install'
      },
      fno_id: row.fno_id,
      fno_reference: row.fno_reference,
      created_at: row.created_at,
      updated_at: row.updated_at,
      estimated_completion: row.estimated_completion,
      isPaid: row.is_paid || false,
      customer: {
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.customer_email
      },
      fno: row.fno_name ? {
        name: row.fno_name,
        code: row.fno_code
      } : null,
      // Direct mapping for frontend compatibility
      service_type: row.service_type,
      service_package: row.service_package
    }));

    const payload = { success: true, data: transformedOrders, total: transformedOrders.length };
    await cache.setJson(cacheKey, payload, 30);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function createOrder(req: Request, res: Response) {
  const redis = req.app.get('redis');
  try {
    const service = makeOrdersService(req);

    const createdBy = (req as any).user?.userId || 'system';
    const payload = req.body || {};

    const normalizedServiceAddress = payload.serviceAddress || payload.service_address || payload.installation_address || {};
    const normalizedServiceDetails = payload.serviceDetails || payload.service_details || {};

    const order = await service.createOrder(
      {
        customerId: payload.customerId || payload.customer_id,
        orderType: payload.orderType || payload.order_type || 'new_install',
        priority: payload.priority || 'medium',
        serviceAddress: normalizedServiceAddress,
        serviceDetails: {
          serviceType: normalizedServiceDetails.serviceType || normalizedServiceDetails.service_type || payload.service_type || 'internet',
          bandwidth: normalizedServiceDetails.bandwidth || payload.bandwidth || normalizedServiceDetails.band_width || 'unknown',
          installationType: normalizedServiceDetails.installationType || normalizedServiceDetails.installation_type || payload.installation_type || 'professional_install',
          equipment: normalizedServiceDetails.equipment || payload.equipment
        },
      },
      createdBy
    );

    // Re-read with standard normalization so response fields are complete/consistent
    const normalized = await service.getOrder(order.id);

    // Invalidate orders and dashboard cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['orders:list']));
    await cache.delByPrefix(buildCacheKey(['dashboard:data']));

    res.status(201).json({ success: true, orderId: order.id, order: normalized });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getOrderById(req: Request, res: Response) {
  try {
    const service = makeOrdersService(req);
    const orderId = String(req.params.id || '');
    if (!orderId) {
      return res.status(400).json({ success: false, error: { message: 'Order ID is required' } });
    }
    const order = await service.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    }
    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function updateOrder(req: Request, res: Response) {
  try {
    const service = makeOrdersService(req);
    const payload = req.body || {};
    // Allow partial updates; map common snake_case to columns used by OrdersService.updateOrder
    const updates: any = {};
    if (payload.orderType || payload.order_type) updates.order_type = payload.orderType || payload.order_type;
    if (payload.priority) updates.priority = payload.priority;
    if (payload.serviceAddress || payload.service_address) updates.service_address = payload.serviceAddress || payload.service_address;
    if (payload.serviceDetails || payload.service_details) updates.service_details = payload.serviceDetails || payload.service_details;
    if (payload.fnoId || payload.fno_id) updates.fno_id = payload.fnoId || payload.fno_id;
    if (payload.fnoReference || payload.fno_reference) updates.fno_reference = payload.fnoReference || payload.fno_reference;
    if (payload.estimatedCompletionDate || payload.estimated_completion_date) updates.estimated_completion_date = payload.estimatedCompletionDate || payload.estimated_completion_date;
    if (payload.actualCompletionDate || payload.actual_completion_date) updates.actual_completion_date = payload.actualCompletionDate || payload.actual_completion_date;

    const orderId = String(req.params.id);
    const before = await service.getOrder(orderId);
    const updated = await service.updateOrder(orderId, updates);

    // If enrichment-like fields were provided and the previous state was validated, auto-transition to enriched
    const touchedEnrichment = Boolean(
      payload.serviceDetails || payload.service_details ||
      payload.technicalSpecs || payload.technical_specs ||
      payload.installationDetails || payload.installation_details ||
      payload.fnoId || payload.fno_id || payload.fnoReference || payload.fno_reference
    );

    if (before && before.status === 'validated' && touchedEnrichment) {
      try {
        await service.transitionToEnrichedInternal(orderId, (req as any).user?.userId || 'system', 'Order enriched via enrichment form');
        const after = await service.getOrder(orderId);
        // Invalidate caches after transition
        try {
          const redis = req.app.get('redis');
          const cache = new CacheService(redis);
          await cache.delByPrefix(buildCacheKey(['orders:list']));
          await cache.delByPrefix(buildCacheKey(['dashboard:data']));
        } catch {}
        return res.json({ success: true, order: after });
      } catch (e: any) {
        // If transition fails, still return the updated order, but include warning
        return res.json({ success: true, order: updated, warning: e?.message || 'Failed to auto-transition to enriched' });
      }
    }

    // If FNO information present and order already enriched, auto-transition to fno_submitted
    const touchedFno = Boolean(payload.fnoId || payload.fno_id || payload.fnoReference || payload.fno_reference);
    if (before && before.status === 'enriched' && touchedFno) {
      try {
        await service.transitionOrder(orderId, 'fno_submitted' as any, (req as any).user?.userId || 'system', 'Submitted to FNO via submission form');
        const after = await service.getOrder(orderId);
        // Invalidate caches after transition
        try {
          const redis = req.app.get('redis');
          const cache = new CacheService(redis);
          await cache.delByPrefix(buildCacheKey(['orders:list']));
          await cache.delByPrefix(buildCacheKey(['dashboard:data']));
        } catch {}
        return res.json({ success: true, order: after });
      } catch (e: any) {
        return res.json({ success: true, order: updated, warning: e?.message || 'Failed to auto-transition to fno_submitted' });
      }
    }

    // Invalidate caches after standard update as well
    try {
      const redis = req.app.get('redis');
      const cache = new CacheService(redis);
      await cache.delByPrefix(buildCacheKey(['orders:list']));
      await cache.delByPrefix(buildCacheKey(['dashboard:data']));
    } catch {}

    res.json({ success: true, order: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}
