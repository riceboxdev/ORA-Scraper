/**
 * Main entry point for ORA Scraper Service
 */

import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { ensureSystemAccount } from './firebase.js';
import { getScheduleConfig } from './db.js';
import sourcesRouter from './routes/sources.js';
import jobsRouter, { setRunScrapeFunction, markLastRun } from './routes/jobs.js';
import { runScrapeJob } from './services/scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/sources', sourcesRouter);
app.use('/api/jobs', jobsRouter);

// Fallback to index.html for SPA
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Scheduled job
let scheduledTask: cron.ScheduledTask | null = null;

function updateSchedule(): void {
    const { intervalHours, enabled } = getScheduleConfig();

    // Stop existing task
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }

    if (!enabled) {
        console.log('Scheduler disabled');
        return;
    }

    // Schedule new task (run at start of each interval)
    // e.g., every 4 hours: "0 */4 * * *"
    const cronExpression = `0 */${intervalHours} * * *`;
    console.log(`Scheduling scrape job with cron: ${cronExpression}`);

    scheduledTask = cron.schedule(cronExpression, async () => {
        console.log('Scheduled scrape starting...');
        await runScrape();
    });
}

async function runScrape(): Promise<void> {
    const { batchSize, enabled } = getScheduleConfig();

    if (!enabled) {
        console.log('Scraping disabled, skipping');
        return;
    }

    console.log(`Starting scrape with batch size: ${batchSize}`);
    markLastRun();

    try {
        await runScrapeJob(batchSize);
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

        // Start scheduler
        updateSchedule();

        // Start Express
        app.listen(config.port, () => {
            console.log(`ORA Scraper running at http://localhost:${config.port}`);
            console.log(`Environment: ${config.nodeEnv}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
