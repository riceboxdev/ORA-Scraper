/**
 * Express routes for scraper job control and stats
 * Uses Firestore for persistent storage
 */

import { Router, Request, Response } from 'express';
import * as firestoreDb from '../firestore-db.js';

const router = Router();

// Reference to the runScrape function (set by index.ts)
let runScrapeFunction: (() => Promise<void>) | null = null;

export function setRunScrapeFunction(fn: () => Promise<void>): void {
    runScrapeFunction = fn;
}

// Manual trigger
router.post('/run', async (_req: Request, res: Response) => {
    try {
        if (!runScrapeFunction) {
            res.status(500).json({ error: 'Scraper not initialized' });
            return;
        }

        // Run async, don't wait
        runScrapeFunction().catch(console.error);

        res.json({ message: 'Scrape job started', startedAt: new Date().toISOString() });
    } catch (error) {
        console.error('Error starting scrape:', error);
        res.status(500).json({ error: 'Failed to start scrape' });
    }
});

// Get current status
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const config = await firestoreDb.getConfig();

        let nextRunAt: string | null = null;
        if (config.lastRunAt && config.enabled) {
            const next = new Date(config.lastRunAt);
            next.setHours(next.getHours() + config.intervalHours);
            nextRunAt = next.toISOString();
        }

        res.json({
            enabled: config.enabled,
            lastRunAt: config.lastRunAt,
            nextRunAt,
            intervalHours: config.intervalHours,
        });
    } catch (error) {
        console.error('Error fetching status:', error);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// Get today's stats
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const stats = await firestoreDb.getTodayStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Get historical stats for charts
router.get('/stats/history', async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 7;
        const stats = await firestoreDb.getStatsHistory(days);
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats history:', error);
        res.status(500).json({ error: 'Failed to fetch stats history' });
    }
});

// Get job history
router.get('/history', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const jobs = await firestoreDb.getJobHistory(limit);
        res.json(jobs);
    } catch (error) {
        console.error('Error fetching job history:', error);
        res.status(500).json({ error: 'Failed to fetch job history' });
    }
});

// Mark last run (exported for use by scheduler)
export async function markLastRun(): Promise<void> {
    await firestoreDb.markLastRun();
}

export default router;
