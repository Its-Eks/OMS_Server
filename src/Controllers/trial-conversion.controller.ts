import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';
import { triggerOrderStatusEmail } from '../services/order-email-hooks.service.ts';

// Service packages for conversion
export const SERVICE_PACKAGES = {
  fiber: [
    {
      id: 'fiber-100',
      name: 'Fiber 100/50 Mbps',
      description: 'High-speed fiber internet with 100 Mbps download and 50 Mbps upload',
      price: 599,
      bandwidth: '100/50 Mbps',
      serviceType: 'fiber',
      features: ['Unlimited data', '24/7 support', 'Professional installation']
    },
    {
      id: 'fiber-200',
      name: 'Fiber 200/100 Mbps',
      description: 'Ultra-fast fiber internet with 200 Mbps download and 100 Mbps upload',
      price: 899,
      bandwidth: '200/100 Mbps',
      serviceType: 'fiber',
      features: ['Unlimited data', '24/7 support', 'Professional installation', 'Priority support']
    },
    {
      id: 'fiber-500',
      name: 'Fiber 500/250 Mbps',
      description: 'Premium fiber internet with 500 Mbps download and 250 Mbps upload',
      price: 1299,
      bandwidth: '500/250 Mbps',
      serviceType: 'fiber',
      features: ['Unlimited data', '24/7 support', 'Professional installation', 'Priority support', 'Static IP']
    }
  ],
  wireless: [
    {
      id: 'wireless-25',
      name: 'Wireless 25/5 Mbps',
      description: 'Reliable wireless internet with 25 Mbps download and 5 Mbps upload',
      price: 299,
      bandwidth: '25/5 Mbps',
      serviceType: 'wireless',
      features: ['Unlimited data', 'Self-installation', '24/7 support']
    },
    {
      id: 'wireless-50',
      name: 'Wireless 50/10 Mbps',
      description: 'Fast wireless internet with 50 Mbps download and 10 Mbps upload',
      price: 499,
      bandwidth: '50/10 Mbps',
      serviceType: 'wireless',
      features: ['Unlimited data', 'Self-installation', '24/7 support', 'Equipment included']
    },
    {
      id: 'wireless-100',
      name: 'Wireless 100/20 Mbps',
      description: 'High-speed wireless internet with 100 Mbps download and 20 Mbps upload',
      price: 799,
      bandwidth: '100/20 Mbps',
      serviceType: 'wireless',
      features: ['Unlimited data', 'Self-installation', '24/7 support', 'Premium equipment', 'Priority support']
    }
  ]
};

// Payment methods
export const PAYMENT_METHODS = [
  {
    id: 'debit_order',
    name: 'Debit Order',
    description: 'Automatic monthly deduction from your bank account',
    icon: '🏦',
    requiresBankDetails: true
  },
  {
    id: 'peach_payments',
    name: 'Peach Payments',
    description: 'Secure online payment with card or EFT',
    icon: '💳',
    requiresBankDetails: false
  }
];

// Get available packages for a trial order
export async function getConversionPackages(req: Request, res: Response): Promise<void> {
  try {
    const { id: orderId } = req.params;
    const db: Pool = req.app.get('pgPool');

    // Get order details to determine service type
    const orderResult = await db.query(
      'SELECT service_details, service_type FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const order = orderResult.rows[0];
    const serviceType = order.service_details?.serviceType || order.service_type || 'fiber';
    
    // Get packages based on service type
    const packages = serviceType.toLowerCase() === 'wireless' 
      ? SERVICE_PACKAGES.wireless 
      : SERVICE_PACKAGES.fiber;

    res.json({
      success: true,
      data: {
        serviceType: serviceType.toLowerCase(),
        packages,
        paymentMethods: PAYMENT_METHODS
      }
    });
  } catch (error) {
    console.error('Error getting conversion packages:', error);
    res.status(500).json({ success: false, error: 'Failed to get conversion packages' });
  }
}

// Process trial conversion
export async function processTrialConversion(req: Request, res: Response): Promise<void> {
  try {
    const { id: orderId } = req.params;
    const { packageId, paymentMethod, customerDetails, bankDetails } = req.body;
    
    const db: Pool = req.app.get('pgPool');
    const mongoClient: MongoClient = req.app.get('mongoClient');

    // Validate required fields
    if (!packageId || !paymentMethod) {
      res.status(400).json({ 
        success: false, 
        error: 'Package ID and payment method are required' 
      });
      return;
    }

    // Get order details
    const orderResult = await db.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const order = orderResult.rows[0];

    // Find the selected package
    const serviceType = order.service_details?.serviceType || order.service_type || 'fiber';
    const packages = serviceType.toLowerCase() === 'wireless' 
      ? SERVICE_PACKAGES.wireless 
      : SERVICE_PACKAGES.fiber;
    
    const selectedPackage = packages.find(pkg => pkg.id === packageId);
    if (!selectedPackage) {
      res.status(400).json({ success: false, error: 'Invalid package selected' });
      return;
    }

    // Create conversion record in MongoDB
    const conversionData = {
      orderId,
      customerId: order.customer_id,
      packageId,
      packageName: selectedPackage.name,
      packagePrice: selectedPackage.price,
      serviceType: selectedPackage.serviceType,
      bandwidth: selectedPackage.bandwidth,
      paymentMethod,
      customerDetails: customerDetails || {},
      bankDetails: bankDetails || {},
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const conversionCollection = mongoClient.db('oms').collection('trial_conversions');
    const conversionResult = await conversionCollection.insertOne(conversionData);

    // Update order status to converted
    await db.query(
      'UPDATE orders SET status = $1, current_state = $1, service_type = $2, updated_at = NOW() WHERE id = $3',
      ['trial_converted', 'paid_service', orderId]
    );

    // Add order history
    await db.query(
      `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, order.status, 'trial_converted', 'Trial converted to paid service', null]
    );

    // Process payment based on method
    let paymentResult;
    if (paymentMethod === 'peach_payments') {
      // TODO: Integrate with Peach Payments API
      paymentResult = await processPeachPayment(conversionData);
    } else if (paymentMethod === 'debit_order') {
      // TODO: Set up debit order with bank
      paymentResult = await processDebitOrder(conversionData);
    }

    // Update conversion record with payment result
    await conversionCollection.updateOne(
      { _id: conversionResult.insertedId },
      { 
        $set: { 
          paymentResult,
          status: paymentResult?.success ? 'completed' : 'failed',
          updatedAt: new Date()
        }
      }
    );

    // Send confirmation email
    try {
      await triggerOrderStatusEmail(
        db,
        mongoClient,
        {
          orderId,
          orderNumber: order.order_number,
          customerEmail: order.customer?.email || customerDetails?.email,
          customerName: order.customer?.first_name || customerDetails?.firstName,
          previousStatus: order.status,
          newStatus: 'trial_converted',
          orderType: 'new_installation',
          orderData: {
            serviceType: selectedPackage.serviceType,
            packageName: selectedPackage.name,
            packagePrice: selectedPackage.price,
            bandwidth: selectedPackage.bandwidth
          }
        }
      );
    } catch (emailError) {
      console.error('Failed to send conversion email:', emailError);
    }

    res.json({
      success: true,
      data: {
        conversionId: conversionResult.insertedId,
        orderId,
        package: selectedPackage,
        paymentMethod,
        status: paymentResult?.success ? 'completed' : 'pending',
        message: 'Trial conversion processed successfully'
      }
    });

  } catch (error) {
    console.error('Error processing trial conversion:', error);
    res.status(500).json({ success: false, error: 'Failed to process trial conversion' });
  }
}

// Get conversion status
export async function getConversionStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id: orderId } = req.params;
    const mongoClient: MongoClient = req.app.get('mongoClient');

    const conversionCollection = mongoClient.db('oms').collection('trial_conversions');
    const conversion = await conversionCollection.findOne({ orderId });

    if (!conversion) {
      res.status(404).json({ success: false, error: 'Conversion not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        conversionId: conversion._id,
        orderId: conversion.orderId,
        package: {
          id: conversion.packageId,
          name: conversion.packageName,
          price: conversion.packagePrice,
          serviceType: conversion.serviceType,
          bandwidth: conversion.bandwidth
        },
        paymentMethod: conversion.paymentMethod,
        status: conversion.status,
        createdAt: conversion.createdAt,
        updatedAt: conversion.updatedAt
      }
    });

  } catch (error) {
    console.error('Error getting conversion status:', error);
    res.status(500).json({ success: false, error: 'Failed to get conversion status' });
  }
}

// Placeholder functions for payment processing
async function processPeachPayment(conversionData: any): Promise<any> {
  // TODO: Integrate with Peach Payments API
  console.log('Processing Peach Payment for conversion:', conversionData.orderId);
  
  // Simulate payment processing
  return {
    success: true,
    transactionId: `peach_${Date.now()}`,
    amount: conversionData.packagePrice,
    currency: 'ZAR',
    status: 'completed'
  };
}

async function processDebitOrder(conversionData: any): Promise<any> {
  // TODO: Set up debit order with bank
  console.log('Setting up Debit Order for conversion:', conversionData.orderId);
  
  // Simulate debit order setup
  return {
    success: true,
    debitOrderId: `debit_${Date.now()}`,
    amount: conversionData.packagePrice,
    currency: 'ZAR',
    status: 'pending_activation',
    nextDeductionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
  };
}
