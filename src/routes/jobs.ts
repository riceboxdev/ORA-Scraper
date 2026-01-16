/**
 * Express routes for scraper job control and stats
 */

import { Router, Request, Response } from 'express';
import { queries, getSetting, setSetting } from '../db.js';
import type { DailyStats } from '../types.js';

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
router.get('/status', (_req: Request, res: Response) => {
    try {
        const lastRunAt = getSetting('lastRunAt');
        const intervalHours = parseInt(getSetting('intervalHours') || '4', 10);
        const enabled = getSetting('enabled') === 'true';

        let nextRunAt: string | null = null;
        if (lastRunAt && enabled) {
            const next = new Date(lastRunAt);
            next.setHours(next.getHours() + intervalHours);
            nextRunAt = next.toISOString();
        }

        res.json({
            enabled,
            lastRunAt: lastRunAt || null,
            nextRunAt,
            intervalHours,
        });
    } catch (error) {
        console.error('Error fetching status:', error);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// Get today's stats
router.get('/stats', (_req: Request, res: Response) => {
    try {
        const stats = queries.getTodayStats.get() as DailyStats | undefined;

        if (!stats) {
            res.json({
                date: new Date().toISOString().split('T')[0],
                imagesScraped: 0,
                imagesUploaded: 0,
                imagesFailed: 0,
                qualityFiltered: 0,
            });
            return;
        }

        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Mark last run
export function markLastRun(): void {
    setSetting('lastRunAt', new Date().toISOString());
}

export default router;
