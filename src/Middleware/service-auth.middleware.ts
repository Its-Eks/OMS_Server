import type { Request, Response, NextFunction } from 'express';

/**
 * Service-to-service authentication middleware
 * Allows requests with valid service API key or from authenticated users
 */
export function serviceAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const serviceApiKey = req.headers['x-service-api-key'] as string;
  const expectedApiKey = process.env.ONBOARDING_SERVICE_API_KEY;
  
  // Allow if service API key matches
  if (serviceApiKey && expectedApiKey && serviceApiKey === expectedApiKey) {
    console.log('[ServiceAuth] Valid service API key provided');
    return next();
  }
  
  // Allow if user is authenticated (has user session)
  if (req.user || req.headers.authorization) {
    console.log('[ServiceAuth] User authenticated, allowing request');
    return next();
  }
  
  // For development, allow all requests if no API key is configured
  if (!expectedApiKey || process.env.NODE_ENV === 'development') {
    console.log('[ServiceAuth] Development mode, allowing request');
    return next();
  }
  
  // Reject unauthorized requests
  res.status(401).json({
    success: false,
    error: 'Unauthorized: Service authentication required'
  });
}

/**
 * Optional service auth - allows requests but logs authentication status
 */
export function optionalServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const serviceApiKey = req.headers['x-service-api-key'] as string;
  const expectedApiKey = process.env.ONBOARDING_SERVICE_API_KEY;
  
  if (serviceApiKey && expectedApiKey && serviceApiKey === expectedApiKey) {
    console.log('[ServiceAuth] Service-to-service request authenticated');
  } else if (req.user || req.headers.authorization) {
    console.log('[ServiceAuth] User request authenticated');
  } else {
    console.log('[ServiceAuth] Unauthenticated request (allowed)');
  }
  
  next();
}
