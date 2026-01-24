/**
 * SQLite database for source management and settings
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CrawlQueueItem } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'sources.db');

const db: Database.Database = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
    -- Sources table
    CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('unsplash', 'reddit', 'url')),
        query TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        lastScrapedAt TEXT,
        totalScraped INTEGER DEFAULT 0,
        createdAt TEXT DEFAULT (datetime('now'))
    );

    -- Settings table (key-value)
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    -- Scraped images log (for deduplication)
    CREATE TABLE IF NOT EXISTS scraped_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceId TEXT,
        imageUrl TEXT NOT NULL UNIQUE,
        postId TEXT,
        scrapedAt TEXT DEFAULT (datetime('now'))
    );

    -- Stats table
    CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        imagesScraped INTEGER DEFAULT 0,
        imagesUploaded INTEGER DEFAULT 0,
        imagesFailed INTEGER DEFAULT 0,
        qualityFiltered INTEGER DEFAULT 0
    );

    -- Failed images tracking (skip after 3 failures)
    CREATE TABLE IF NOT EXISTS failed_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imageUrl TEXT NOT NULL UNIQUE,
        failCount INTEGER DEFAULT 1,
        lastFailReason TEXT,
        firstFailedAt TEXT DEFAULT (datetime('now')),
        lastFailedAt TEXT DEFAULT (datetime('now'))
    );

    -- Quality filtered images (for preview/debugging)
    CREATE TABLE IF NOT EXISTS filtered_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sourceId TEXT,
        imageUrl TEXT NOT NULL,
        qualityScore REAL,
        qualityType TEXT,
        filterReason TEXT,
        filteredAt TEXT DEFAULT (datetime('now'))
    );

    -- Job execution history
    CREATE TABLE IF NOT EXISTS job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        status TEXT DEFAULT 'running',
        imagesScraped INTEGER DEFAULT 0,
        imagesUploaded INTEGER DEFAULT 0,
        imagesFailed INTEGER DEFAULT 0,
        qualityFiltered INTEGER DEFAULT 0,
        errorMessage TEXT
    );

    -- Crawl Queue (Persistent Frontier)
    CREATE TABLE IF NOT EXISTS crawl_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        sourceId TEXT NOT NULL,
        depth INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
        discoveredAt TEXT DEFAULT (datetime('now')),
        lastAttemptedAt TEXT,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status_priority ON crawl_queue(status, priority DESC);
`);

// Initialize default settings
const initSettings = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
`);
initSettings.run('batchSize', '30');
initSettings.run('intervalHours', '4');
initSettings.run('enabled', 'true');
initSettings.run('lastRunAt', '');

// Prepared statements
export const queries: Record<string, Database.Statement> = {
    // deduplication check only
    isImageScraped: db.prepare('SELECT 1 FROM scraped_images WHERE imageUrl = ?'),
    markImageScraped: db.prepare('INSERT INTO scraped_images (sourceId, imageUrl, postId) VALUES (?, ?, ?)'),

    // Settings
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),

    // Stats
    getTodayStats: db.prepare(`
        SELECT * FROM daily_stats WHERE date = date('now')
    `),

    // Crawl Queue
    insertCrawlItem: db.prepare(`
        INSERT OR IGNORE INTO crawl_queue (url, sourceId, depth, priority, status, discoveredAt)
        VALUES (@url, @sourceId, @depth, @priority, 'pending', datetime('now'))
    `),
    getNextBatch: db.prepare(`
        SELECT * FROM crawl_queue 
        WHERE status = 'pending' 
        ORDER BY priority DESC, discoveredAt ASC 
        LIMIT ?
    `),
    updateCrawlStatus: db.prepare(`
        UPDATE crawl_queue 
        SET status = ?, error = ?, lastAttemptedAt = datetime('now') 
        WHERE id = ?
    `),
    getStatsHistory: db.prepare(`
        SELECT * FROM daily_stats 
        WHERE date >= date('now', ?) 
        ORDER BY date ASC
    `),
};

// Helper functions
export function getSetting(key: string): string {
    const row = queries.getSetting.get(key) as { value: string } | undefined;
    return row?.value || '';
}

export function setSetting(key: string, value: string): void {
    queries.setSetting.run(key, value);
}

export function getScheduleConfig(): { batchSize: number; intervalHours: number; enabled: boolean } {
    return {
        batchSize: parseInt(getSetting('batchSize') || '30', 10),
        intervalHours: parseInt(getSetting('intervalHours') || '4', 10),
        enabled: getSetting('enabled') === 'true',
    };
}

export function isImageAlreadyScraped(imageUrl: string): boolean {
    return !!queries.isImageScraped.get(imageUrl);
}

export function markImageAsScraped(sourceId: string, imageUrl: string, postId: string): void {
    queries.markImageScraped.run(sourceId, imageUrl, postId);
}

export function incrementDailyStat(stat: 'imagesScraped' | 'imagesUploaded' | 'imagesFailed' | 'qualityFiltered'): void {
    db.prepare(`
        INSERT INTO daily_stats (date, ${stat})
        VALUES (date('now'), 1)
        ON CONFLICT(date) DO UPDATE SET ${stat} = ${stat} + 1
    `).run();
    `).run();
}

export function getTodayStats(): any {
    const stats = queries.getTodayStats.get();
    return stats || {
        date: new Date().toISOString().split('T')[0],
        imagesScraped: 0,
        imagesUploaded: 0,
        imagesFailed: 0,
        qualityFiltered: 0
    };
}

export function getStatsHistory(days: number): any[] {
    const rows = queries.getStatsHistory.all(`- ${ days } days`);
    // Ideally we would fill in missing dates here, but for now raw rows are okay
    // The frontend chart might look gap-py if days are missing
    return rows;
}

const MAX_FAILURES = 3;

/**
 * Check if an image has permanently failed (exceeded max retries)
 */
export function isImagePermanentlyFailed(imageUrl: string): boolean {
    const row = db.prepare(
        'SELECT failCount FROM failed_images WHERE imageUrl = ?'
    ).get(imageUrl) as { failCount: number } | undefined;

    return row ? row.failCount >= MAX_FAILURES : false;
}

/**
 * Record a failure for an image with reason
 */
export function recordImageFailure(imageUrl: string, reason: string): number {
    const existing = db.prepare(
        'SELECT failCount FROM failed_images WHERE imageUrl = ?'
    ).get(imageUrl) as { failCount: number } | undefined;

    if (existing) {
        db.prepare(`
            UPDATE failed_images 
            SET failCount = failCount + 1,
        lastFailReason = ?,
        lastFailedAt = datetime('now')
            WHERE imageUrl = ?
        `).run(reason, imageUrl);
        return existing.failCount + 1;
    } else {
        db.prepare(`
            INSERT INTO failed_images(imageUrl, lastFailReason) VALUES(?, ?)
        `).run(imageUrl, reason);
        return 1;
    }
}

/**
 * Get failure info for an image
 */
export function getImageFailureInfo(imageUrl: string): { failCount: number; reason: string } | null {
    const row = db.prepare(
        'SELECT failCount, lastFailReason FROM failed_images WHERE imageUrl = ?'
    ).get(imageUrl) as { failCount: number; lastFailReason: string } | undefined;

    return row ? { failCount: row.failCount, reason: row.lastFailReason } : null;
}

// ============================================
// CRAWL QUEUE HELPERS
// ============================================

export function addToCrawlQueue(items: Omit<CrawlQueueItem, 'id' | 'status' | 'discoveredAt' | 'lastAttemptedAt' | 'error'>[]): void {
    const insert = queries.insertCrawlItem;
    const insertMany = db.transaction((items) => {
        for (const item of items) insert.run(item);
    });
    insertMany(items);
}

export function getNextCrawlBatch(limit: number): CrawlQueueItem[] {
    // Transaction to get items and immediately mark them as processing to prevent race conditions
    // strictly speaking with SQLite in WAL mode and single process, this simpler approach is fine,
    // but explicit transaction is safer if we ever scale processes.

    // However, `better - sqlite3` is synchronous. We can just fetch and then update ids.
    const items = queries.getNextBatch.all(limit) as CrawlQueueItem[];

    if (items.length > 0) {
        const markProcessing = db.prepare(`UPDATE crawl_queue SET status = 'processing', lastAttemptedAt = datetime('now') WHERE id = ? `);
        const updateMany = db.transaction((items: CrawlQueueItem[]) => {
            for (const item of items) {
                markProcessing.run(item.id);
            }
        });
        updateMany(items);
    }

    return items;
}

export function updateCrawlStatus(id: number, status: 'completed' | 'failed' | 'processing', error: string | null = null): void {
    queries.updateCrawlStatus.run(status, error, id);
}

export function getQueueStats(): { pending: number; processing: number; completed: number; failed: number } {
    const rows = db.prepare('SELECT status, COUNT(*) as count FROM crawl_queue GROUP BY status').all() as { status: string; count: number }[];
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
        if (Object.prototype.hasOwnProperty.call(stats, row.status)) {
            stats[row.status as keyof typeof stats] = row.count;
        }
    }
    return stats;
}

export { db };
export default db;

