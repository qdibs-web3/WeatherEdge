import type { Request, Response, NextFunction } from 'express';
import * as db from '../db';

/**
 * Rate limiting middleware for Express routes
 * Usage: app.post('/api/endpoint', rateLimitMiddleware('endpoint-name'), handler)
 */
export function rateLimitMiddleware(
  endpointName: string,
  maxRequests: number = 100,
  windowMinutes: number = 15
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Use IP address as identifier (or user ID if authenticated)
      const identifier = req.ip || req.socket.remoteAddress || 'unknown';
      
      const { allowed, remaining } = await db.checkRateLimit(
        identifier,
        endpointName,
        maxRequests,
        windowMinutes
      );

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + windowMinutes * 60 * 1000).toISOString());

      if (!allowed) {
        console.warn(`[Rate Limit] Blocked request from ${identifier} to ${endpointName}`);
        return res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Please try again in ${windowMinutes} minutes.`,
          retryAfter: windowMinutes * 60,
        });
      }

      next();
    } catch (error) {
      console.error('[Rate Limit] Error checking rate limit:', error);
      // On error, allow the request to proceed (fail open)
      next();
    }
  };
}

/**
 * Stricter rate limiting for payment endpoints
 */
export const paymentRateLimit = rateLimitMiddleware('payment', 10, 60); // 10 requests per hour

/**
 * Standard rate limiting for API endpoints
 */
export const apiRateLimit = rateLimitMiddleware('api', 100, 15); // 100 requests per 15 minutes

/**
 * Lenient rate limiting for public endpoints
 */
export const publicRateLimit = rateLimitMiddleware('public', 1000, 15); // 1000 requests per 15 minutes