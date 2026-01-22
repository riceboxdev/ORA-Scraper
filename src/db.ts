/**
 * SQLite database for source management and settings
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

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
            INSERT INTO failed_images (imageUrl, lastFailReason) VALUES (?, ?)
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

export { db };
export default db;

