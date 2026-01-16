/**
 * Express routes for settings management
 */

import { Router, Request, Response } from 'express';
import { db, getSetting, setSetting, queries } from '../db.js';

const router = Router();

// Ensure quality_settings table exists
db.exec(`
    CREATE TABLE IF NOT EXISTS quality_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
`);

// Initialize default quality settings
const initQualitySetting = db.prepare(`
    INSERT OR IGNORE INTO quality_settings (key, value) VALUES (?, ?)
`);
initQualitySetting.run('minScore', '0.6');
initQualitySetting.run('allowedTypes', JSON.stringify(['photography', 'art', 'design']));

// Get quality filter settings
router.get('/quality', (_req: Request, res: Response) => {
    try {
        const minScore = db.prepare(
            'SELECT value FROM quality_settings WHERE key = ?'
        ).get('minScore') as { value: string } | undefined;

        const allowedTypes = db.prepare(
            'SELECT value FROM quality_settings WHERE key = ?'
        ).get('allowedTypes') as { value: string } | undefined;

        res.json({
            minScore: parseFloat(minScore?.value || '0.6'),
            allowedTypes: allowedTypes ? JSON.parse(allowedTypes.value) : ['photography', 'art', 'design'],
        });
    } catch (error) {
        console.error('Error fetching quality settings:', error);
        res.status(500).json({ error: 'Failed to fetch quality settings' });
    }
});

// Update quality filter settings
router.put('/quality', (req: Request, res: Response) => {
    try {
        const { minScore, allowedTypes } = req.body;

        if (minScore !== undefined) {
            db.prepare(
                'INSERT OR REPLACE INTO quality_settings (key, value) VALUES (?, ?)'
            ).run('minScore', String(minScore));
        }

        if (allowedTypes !== undefined) {
            db.prepare(
                'INSERT OR REPLACE INTO quality_settings (key, value) VALUES (?, ?)'
            ).run('allowedTypes', JSON.stringify(allowedTypes));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating quality settings:', error);
        res.status(500).json({ error: 'Failed to update quality settings' });
    }
});

// Export all settings
router.get('/export', (_req: Request, res: Response) => {
    try {
        // Get schedule settings
        const schedule = {
            batchSize: parseInt(getSetting('batchSize') || '30', 10),
            intervalHours: parseInt(getSetting('intervalHours') || '4', 10),
            enabled: getSetting('enabled') === 'true',
        };

        // Get quality settings
        const minScore = db.prepare(
            'SELECT value FROM quality_settings WHERE key = ?'
        ).get('minScore') as { value: string } | undefined;

        const allowedTypes = db.prepare(
            'SELECT value FROM quality_settings WHERE key = ?'
        ).get('allowedTypes') as { value: string } | undefined;

        const quality = {
            minScore: parseFloat(minScore?.value || '0.6'),
            allowedTypes: allowedTypes ? JSON.parse(allowedTypes.value) : ['photography', 'art', 'design'],
        };

        // Get sources
        const sources = queries.getAllSources.all();

        res.json({
            exportedAt: new Date().toISOString(),
            version: '1.0',
            schedule,
            quality,
            sources,
        });
    } catch (error) {
        console.error('Error exporting settings:', error);
        res.status(500).json({ error: 'Failed to export settings' });
    }
});

// Import settings
router.post('/import', (req: Request, res: Response) => {
    try {
        const { schedule, quality, sources } = req.body;

        // Import schedule settings
        if (schedule) {
            if (schedule.batchSize !== undefined) {
                setSetting('batchSize', String(schedule.batchSize));
            }
            if (schedule.intervalHours !== undefined) {
                setSetting('intervalHours', String(schedule.intervalHours));
            }
            if (schedule.enabled !== undefined) {
                setSetting('enabled', String(schedule.enabled));
            }
        }

        // Import quality settings
        if (quality) {
            if (quality.minScore !== undefined) {
                db.prepare(
                    'INSERT OR REPLACE INTO quality_settings (key, value) VALUES (?, ?)'
                ).run('minScore', String(quality.minScore));
            }
            if (quality.allowedTypes !== undefined) {
                db.prepare(
                    'INSERT OR REPLACE INTO quality_settings (key, value) VALUES (?, ?)'
                ).run('allowedTypes', JSON.stringify(quality.allowedTypes));
            }
        }

        // Import sources (optional - adds new sources, doesn't delete existing)
        if (sources && Array.isArray(sources)) {
            const insertSource = db.prepare(
                'INSERT OR IGNORE INTO sources (type, query, enabled) VALUES (?, ?, ?)'
            );

            for (const source of sources) {
                insertSource.run(source.type, source.query, source.enabled ? 1 : 0);
            }
        }

        res.json({ success: true, message: 'Settings imported successfully' });
    } catch (error) {
        console.error('Error importing settings:', error);
        res.status(500).json({ error: 'Failed to import settings' });
    }
});

export default router;
