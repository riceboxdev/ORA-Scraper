/**
 * One-time migration script to copy SQLite data to Firestore
 * Run this locally while connected to production Firebase before switching to Firestore
 * 
 * Usage: npx tsx scripts/migrate-to-firestore.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'sources.db');

// Initialize Firebase (uses local credentials)
if (!admin.apps.length) {
    const credentialsPath = path.join(__dirname, '..', 'firebase-credentials.json');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(credentialsPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const firestore = admin.firestore();

interface Source {
    id: number;
    type: string;
    query: string;
    enabled: number;
    lastScrapedAt: string | null;
    totalScraped: number;
    createdAt: string;
}

interface DailyStats {
    date: string;
    imagesScraped: number;
    imagesUploaded: number;
    imagesFailed: number;
    qualityFiltered: number;
}

interface JobRun {
    id: number;
    startedAt: string;
    completedAt: string | null;
    status: string;
    imagesScraped: number;
    imagesUploaded: number;
    imagesFailed: number;
    qualityFiltered: number;
    errorMessage: string | null;
}

interface Setting {
    key: string;
    value: string;
}

async function migrate(): Promise<void> {
    console.log('🚀 Starting migration from SQLite to Firestore...\n');

    // Open SQLite database
    const sqlite = new Database(DB_PATH);

    const CONFIG_DOC = 'scraperConfig/config';
    const SOURCES_COLLECTION = 'scraperConfig/config/sources';
    const STATS_COLLECTION = 'scraperConfig/config/stats';
    const JOBS_COLLECTION = 'scraperConfig/config/jobs';

    // ============================================
    // 1. MIGRATE SETTINGS
    // ============================================
    console.log('📋 Migrating settings...');

    const settings = sqlite.prepare('SELECT * FROM settings').all() as Setting[];
    const qualitySettings = sqlite.prepare('SELECT * FROM quality_settings').all() as Setting[];

    const config: Record<string, unknown> = {
        batchSize: 30,
        intervalHours: 4,
        enabled: true,
        lastRunAt: null,
        qualityMinScore: 0.6,
        qualityAllowedTypes: ['photography', 'art', 'design'],
    };

    for (const s of settings) {
        if (s.key === 'batchSize') config.batchSize = parseInt(s.value, 10);
        if (s.key === 'intervalHours') config.intervalHours = parseInt(s.value, 10);
        if (s.key === 'enabled') config.enabled = s.value === 'true';
        if (s.key === 'lastRunAt' && s.value) config.lastRunAt = s.value;
    }

    for (const s of qualitySettings) {
        if (s.key === 'minScore') config.qualityMinScore = parseFloat(s.value);
        if (s.key === 'allowedTypes') config.qualityAllowedTypes = JSON.parse(s.value);
    }

    await firestore.doc(CONFIG_DOC).set(config);
    console.log(`  ✅ Settings migrated: ${JSON.stringify(config, null, 2)}\n`);

    // ============================================
    // 2. MIGRATE SOURCES
    // ============================================
    console.log('🔗 Migrating sources...');

    const sources = sqlite.prepare('SELECT * FROM sources').all() as Source[];
    let sourceCount = 0;

    for (const source of sources) {
        await firestore.collection(SOURCES_COLLECTION).add({
            type: source.type,
            query: source.query,
            enabled: source.enabled === 1,
            lastScrapedAt: source.lastScrapedAt,
            totalScraped: source.totalScraped || 0,
            createdAt: source.createdAt || new Date().toISOString(),
            // Store original SQLite ID for reference
            legacySqliteId: source.id,
        });
        sourceCount++;
    }

    console.log(`  ✅ ${sourceCount} sources migrated\n`);

    // ============================================
    // 3. MIGRATE DAILY STATS
    // ============================================
    console.log('📊 Migrating daily stats...');

    const stats = sqlite.prepare('SELECT * FROM daily_stats').all() as DailyStats[];
    let statsCount = 0;

    for (const stat of stats) {
        await firestore.collection(STATS_COLLECTION).doc(stat.date).set({
            date: stat.date,
            imagesScraped: stat.imagesScraped || 0,
            imagesUploaded: stat.imagesUploaded || 0,
            imagesFailed: stat.imagesFailed || 0,
            qualityFiltered: stat.qualityFiltered || 0,
        });
        statsCount++;
    }

    console.log(`  ✅ ${statsCount} daily stat records migrated\n`);

    // ============================================
    // 4. MIGRATE JOB RUNS
    // ============================================
    console.log('🏃 Migrating job runs...');

    let jobCount = 0;
    try {
        const jobs = sqlite.prepare('SELECT * FROM job_runs ORDER BY startedAt DESC LIMIT 100').all() as JobRun[];

        for (const job of jobs) {
            await firestore.collection(JOBS_COLLECTION).add({
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                status: job.status || 'completed',
                imagesScraped: job.imagesScraped || 0,
                imagesUploaded: job.imagesUploaded || 0,
                imagesFailed: job.imagesFailed || 0,
                qualityFiltered: job.qualityFiltered || 0,
                errorMessage: job.errorMessage,
            });
            jobCount++;
        }
    } catch (e) {
        console.log('  ⚠️  job_runs table not found or empty, skipping');
    }

    console.log(`  ✅ ${jobCount} job runs migrated\n`);

    // ============================================
    // SUMMARY
    // ============================================
    console.log('═══════════════════════════════════════');
    console.log('🎉 Migration complete!');
    console.log('───────────────────────────────────────');
    console.log(`  Settings:    ✅`);
    console.log(`  Sources:     ${sourceCount} records`);
    console.log(`  Daily Stats: ${statsCount} records`);
    console.log(`  Job Runs:    ${jobCount} records`);
    console.log('═══════════════════════════════════════');
    console.log('\n⚠️  IMPORTANT: Verify data in Firebase Console before deploying!');
    console.log('   Collection: scraperConfig/config/*\n');

    sqlite.close();
    process.exit(0);
}

migrate().catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
});
