/**
 * Main entry point for ORA Scraper Service
 * With Firebase Authentication for admin access
 */

import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { ensureSystemAccount } from './firebase.js';
import * as firestoreDb from './firestore-db.js';
import { requireAdminAuth } from './middleware/auth.js';
import sourcesRouter from './routes/sources.js';
import jobsRouter, { setRunScrapeFunction, markLastRun } from './routes/jobs.js';
import imagesRouter from './routes/images.js';
import settingsRouter from './routes/settings.js';
import cmsRouter from './routes/cms.js';
import { runScrapeJob } from './services/scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check (public)
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth check endpoint (public - used by frontend to verify tokens)
app.post('/api/auth/verify', requireAdminAuth, (req, res) => {
    res.json({
        authenticated: true,
        uid: req.user?.uid,
        email: req.user?.email,
        isAdmin: req.user?.isAdmin,
    });
});

// Protected API routes - require admin auth
app.use('/api/sources', requireAdminAuth, sourcesRouter);
app.use('/api/jobs', requireAdminAuth, jobsRouter);
app.use('/api/images', requireAdminAuth, imagesRouter);
app.use('/api/settings', requireAdminAuth, settingsRouter);
app.use('/api/cms', requireAdminAuth, cmsRouter);

// Fallback to index.html for SPA
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Scheduled job
let scheduledTask: cron.ScheduledTask | null = null;

async function updateSchedule(): Promise<void> {
    const scheduleConfig = await firestoreDb.getScheduleConfig();

    // Stop existing task
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }

    if (!scheduleConfig.enabled) {
        console.log('Scheduler disabled');
        return;
    }

    // Schedule new task (run at start of each interval)
    // e.g., every 4 hours: "0 */4 * * *"
    const cronExpression = `0 */${scheduleConfig.intervalHours} * * *`;
    console.log(`Scheduling scrape job with cron: ${cronExpression}`);

    scheduledTask = cron.schedule(cronExpression, async () => {
        console.log('Scheduled scrape starting...');
        await runScrape();
    });
}

async function runScrape(): Promise<void> {
    const scheduleConfig = await firestoreDb.getScheduleConfig();

    if (!scheduleConfig.enabled) {
        console.log('Scraping disabled, skipping');
        return;
    }

    console.log(`Starting scrape with batch size: ${scheduleConfig.batchSize}`);
    await markLastRun();

    try {
        await runScrapeJob(scheduleConfig.batchSize);
        console.log('Scrape completed');
    } catch (error) {
        console.error('Scrape failed:', error);
    }
}

// Register the run function with jobs router
setRunScrapeFunction(runScrape);

// Start server
async function start(): Promise<void> {
    try {
        // Ensure system account exists
        await ensureSystemAccount();

        // Initialize config (creates default if doesn't exist)
        await firestoreDb.getConfig();

        // Start scheduler
        await updateSchedule();

        // Start Express
        app.listen(config.port, () => {
            console.log(`ORA Scraper running at http://localhost:${config.port}`);
            console.log(`Environment: ${config.nodeEnv}`);
            console.log('Authentication: Admin claim required');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
