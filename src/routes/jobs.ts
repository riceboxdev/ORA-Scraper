/**
 * Express routes for scraper job control and stats
 */

import { Router, Request, Response } from 'express';
import { db, queries, getSetting, setSetting } from '../db.js';
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

// Get historical stats for charts
router.get('/stats/history', (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 7;

        const stats = db.prepare(`
            SELECT * FROM daily_stats 
            WHERE date >= date('now', '-' || ? || ' days')
            ORDER BY date ASC
        `).all(days) as DailyStats[];

        // Fill in missing days with zeros
        const result: DailyStats[] = [];
        const today = new Date();

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const existing = stats.find(s => s.date === dateStr);
            result.push(existing || {
                date: dateStr,
                imagesScraped: 0,
                imagesUploaded: 0,
                imagesFailed: 0,
                qualityFiltered: 0,
            });
        }

        res.json(result);
    } catch (error) {
        console.error('Error fetching stats history:', error);
        res.status(500).json({ error: 'Failed to fetch stats history' });
    }
});

// Get job history (using daily stats as proxy for now)
router.get('/history', (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;

        // Check if job_runs table exists
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='job_runs'
        `).get();

        if (tableExists) {
            const jobs = db.prepare(`
                SELECT * FROM job_runs
                ORDER BY startedAt DESC
                LIMIT ?
            `).all(limit);
            res.json(jobs);
            return;
        }

        // Fallback: use daily_stats to generate pseudo job history
        const stats = db.prepare(`
            SELECT * FROM daily_stats 
            ORDER BY date DESC
            LIMIT ?
        `).all(limit) as DailyStats[];

        const jobs = stats.map((stat, index) => ({
            id: index + 1,
            startedAt: `${stat.date}T10:00:00Z`,
            completedAt: `${stat.date}T10:05:00Z`,
            status: 'completed',
            imagesScraped: stat.imagesScraped,
            imagesUploaded: stat.imagesUploaded,
            imagesFailed: stat.imagesFailed,
            qualityFiltered: stat.qualityFiltered,
            errorMessage: null,
        }));

        res.json(jobs);
    } catch (error) {
        console.error('Error fetching job history:', error);
        res.status(500).json({ error: 'Failed to fetch job history' });
    }
});

// Mark last run
export function markLastRun(): void {
    setSetting('lastRunAt', new Date().toISOString());
}

export default router;
