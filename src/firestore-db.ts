/**
 * Firestore-based persistence for scraper config, sources, stats, and jobs
 * All data is stored under the `scraperConfig` collection with subcollections
 */

import { db } from './firebase.js';
import type { Source, DailyStats, ScheduleConfig } from './types.js';
import admin from 'firebase-admin';

// Collection references
const CONFIG_DOC = 'scraperConfig/config';
const SOURCES_COLLECTION = 'scraperConfig/config/sources';
const STATS_COLLECTION = 'scraperConfig/config/stats';
const JOBS_COLLECTION = 'scraperConfig/config/jobs';

// ============================================
// CONFIG / SETTINGS
// ============================================

export interface ScraperConfig extends ScheduleConfig {
    lastRunAt: string | null;
    qualityMinScore: number;
    qualityAllowedTypes: string[];
}

const DEFAULT_CONFIG: ScraperConfig = {
    batchSize: 5,
    intervalHours: 4,
    enabled: true,
    lastRunAt: null,
    qualityMinScore: 0.6,
    qualityAllowedTypes: ['photography', 'art', 'design'],
};

export async function getConfig(): Promise<ScraperConfig> {
    const doc = await db.doc(CONFIG_DOC).get();
    if (!doc.exists) {
        // Initialize with defaults
        await db.doc(CONFIG_DOC).set(DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
    }
    return { ...DEFAULT_CONFIG, ...doc.data() } as ScraperConfig;
}

export async function updateConfig(updates: Partial<ScraperConfig>): Promise<ScraperConfig> {
    await db.doc(CONFIG_DOC).set(updates, { merge: true });
    return getConfig();
}

export async function getSetting(key: keyof ScraperConfig): Promise<string> {
    const config = await getConfig();
    const value = config[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return JSON.stringify(value);
    return String(value);
}

export async function setSetting(key: keyof ScraperConfig, value: string): Promise<void> {
    let parsedValue: unknown = value;

    // Handle type conversions
    if (key === 'batchSize' || key === 'intervalHours') {
        parsedValue = parseInt(value, 10);
    } else if (key === 'enabled') {
        parsedValue = value === 'true';
    } else if (key === 'qualityMinScore') {
        parsedValue = parseFloat(value);
    } else if (key === 'qualityAllowedTypes') {
        parsedValue = JSON.parse(value);
    }

    await db.doc(CONFIG_DOC).set({ [key]: parsedValue }, { merge: true });
}

// ============================================
// SOURCES
// ============================================

export interface FirestoreSource extends Omit<Source, 'id'> {
    id: string;
}

export async function getAllSources(): Promise<FirestoreSource[]> {
    const snapshot = await db.collection(SOURCES_COLLECTION)
        .orderBy('createdAt', 'desc')
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    })) as FirestoreSource[];
}

export async function getEnabledSources(): Promise<FirestoreSource[]> {
    const snapshot = await db.collection(SOURCES_COLLECTION)
        .where('enabled', '==', true)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    })) as FirestoreSource[];
}

export async function getSources(): Promise<FirestoreSource[]> {
    const snapshot = await db.collection(SOURCES_COLLECTION).get();
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    })) as FirestoreSource[];
}

export async function getSourceById(id: string): Promise<FirestoreSource | null> {
    const doc = await db.collection(SOURCES_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as FirestoreSource;
}

export async function createSource(
    type: Source['type'],
    query: string,
    config: { crawlDepth?: number; followLinks?: boolean } = {}
): Promise<FirestoreSource> {
    const data = {
        type,
        query,
        enabled: true,
        lastScrapedAt: null,
        totalScraped: 0,
        createdAt: new Date().toISOString(),
        crawlDepth: config.crawlDepth || 0,
        followLinks: config.followLinks || false,
    };

    const docRef = await db.collection(SOURCES_COLLECTION).add(data);
    return { id: docRef.id, ...data };
}

export async function updateSource(
    id: string,
    updates: Partial<Omit<Source, 'id' | 'createdAt'>>
): Promise<FirestoreSource | null> {
    const docRef = db.collection(SOURCES_COLLECTION).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return null;

    await docRef.update(updates);
    const updated = await docRef.get();
    return { id: updated.id, ...updated.data() } as FirestoreSource;
}

export async function deleteSource(id: string): Promise<boolean> {
    const docRef = db.collection(SOURCES_COLLECTION).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return false;

    await docRef.delete();
    return true;
}

export async function updateSourceStats(id: string, scraped: number): Promise<void> {
    await db.collection(SOURCES_COLLECTION).doc(id).update({
        lastScrapedAt: new Date().toISOString(),
        totalScraped: admin.firestore.FieldValue.increment(scraped),
    });
}

export async function bulkUpdateSources(ids: string[], enabled: boolean): Promise<number> {
    const batch = db.batch();
    for (const id of ids) {
        batch.update(db.collection(SOURCES_COLLECTION).doc(id), { enabled });
    }
    await batch.commit();
    return ids.length;
}

export async function bulkDeleteSources(ids: string[]): Promise<number> {
    const batch = db.batch();
    for (const id of ids) {
        batch.delete(db.collection(SOURCES_COLLECTION).doc(id));
    }
    await batch.commit();
    return ids.length;
}

// ============================================
// DAILY STATS
// ============================================

function getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
}

export async function getTodayStats(): Promise<DailyStats> {
    const dateStr = getTodayDateString();
    const doc = await db.collection(STATS_COLLECTION).doc(dateStr).get();

    if (!doc.exists) {
        return {
            date: dateStr,
            imagesScraped: 0,
            imagesUploaded: 0,
            imagesFailed: 0,
            qualityFiltered: 0,
        };
    }

    return doc.data() as DailyStats;
}

export async function incrementDailyStat(
    stat: 'imagesScraped' | 'imagesUploaded' | 'imagesFailed' | 'qualityFiltered'
): Promise<void> {
    const dateStr = getTodayDateString();
    const docRef = db.collection(STATS_COLLECTION).doc(dateStr);

    await docRef.set({
        date: dateStr,
        [stat]: admin.firestore.FieldValue.increment(1),
    }, { merge: true });
}

export async function getStatsHistory(days: number): Promise<DailyStats[]> {
    const today = new Date();
    const result: DailyStats[] = [];

    // Calculate date range
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - days + 1);
    const startDateStr = startDate.toISOString().split('T')[0];

    const snapshot = await db.collection(STATS_COLLECTION)
        .where('date', '>=', startDateStr)
        .orderBy('date', 'asc')
        .get();

    const statsMap = new Map<string, DailyStats>();
    snapshot.docs.forEach(doc => {
        statsMap.set(doc.id, doc.data() as DailyStats);
    });

    // Fill in missing days with zeros
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        result.push(statsMap.get(dateStr) || {
            date: dateStr,
            imagesScraped: 0,
            imagesUploaded: 0,
            imagesFailed: 0,
            qualityFiltered: 0,
        });
    }

    return result;
}

// ============================================
// JOB RUNS
// ============================================

export interface JobRun {
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: 'running' | 'completed' | 'failed';
    imagesScraped: number;
    imagesUploaded: number;
    imagesFailed: number;
    qualityFiltered: number;
    errorMessage: string | null;
}

export async function createJobRun(): Promise<JobRun> {
    const data = {
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'running',
        imagesScraped: 0,
        imagesUploaded: 0,
        imagesFailed: 0,
        qualityFiltered: 0,
        errorMessage: null,
    };

    const docRef = await db.collection(JOBS_COLLECTION).add(data);
    return { id: docRef.id, ...data } as JobRun;
}

export async function updateJobRun(
    id: string,
    updates: Partial<Omit<JobRun, 'id' | 'startedAt'>>
): Promise<void> {
    await db.collection(JOBS_COLLECTION).doc(id).update(updates);
}

export async function completeJobRun(
    id: string,
    stats: {
        imagesScraped: number;
        imagesUploaded: number;
        imagesFailed: number;
        qualityFiltered: number;
    }
): Promise<void> {
    await db.collection(JOBS_COLLECTION).doc(id).update({
        ...stats,
        status: 'completed',
        completedAt: new Date().toISOString(),
    });
}

export async function failJobRun(id: string, errorMessage: string): Promise<void> {
    await db.collection(JOBS_COLLECTION).doc(id).update({
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage,
    });
}

export async function getJobHistory(limit: number): Promise<JobRun[]> {
    const snapshot = await db.collection(JOBS_COLLECTION)
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    })) as JobRun[];
}

// ============================================
// SCHEDULE CONFIG (convenience functions)
// ============================================

export async function getScheduleConfig(): Promise<ScheduleConfig> {
    const config = await getConfig();
    return {
        batchSize: config.batchSize,
        intervalHours: config.intervalHours,
        enabled: config.enabled,
    };
}

export async function markLastRun(): Promise<void> {
    await updateConfig({ lastRunAt: new Date().toISOString() });
}
