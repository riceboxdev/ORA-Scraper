/**
 * Firebase Authentication middleware
 * Verifies JWT tokens and checks for admin claim
 */

import { Request, Response, NextFunction } from 'express';
import { auth } from '../firebase.js';

// Extend Express Request to include user info
declare global {
    namespace Express {
        interface Request {
            user?: {
                uid: string;
                email?: string;
                isAdmin: boolean;
            };
        }
    }
}

/**
 * Middleware to verify Firebase Auth tokens
 * Extracts Bearer token from Authorization header
 */
export async function verifyAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await auth.verifyIdToken(token);

        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            isAdmin: decodedToken.admin === true,
        };

        next();
    } catch (error) {
        console.error('Auth verification failed:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Middleware to require admin access
 * Must be used AFTER verifyAuth
 */
export function requireAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }

    if (!req.user.isAdmin) {
        res.status(403).json({
            error: 'Access denied. Admin privileges required.',
            uid: req.user.uid,
        });
        return;
    }

    next();
}

/**
 * Combined middleware: verify auth + require admin
 */
export async function requireAdminAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    await verifyAuth(req, res, () => {
        requireAdmin(req, res, next);
    });
}
