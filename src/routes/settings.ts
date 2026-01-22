/**
 * Express routes for settings management
 * Uses Firestore for persistent storage
 */

import { Router, Request, Response } from 'express';
import * as firestoreDb from '../firestore-db.js';

const router = Router();

// Get quality filter settings
router.get('/quality', async (_req: Request, res: Response) => {
    try {
        const config = await firestoreDb.getConfig();
        res.json({
            minScore: config.qualityMinScore,
            allowedTypes: config.qualityAllowedTypes,
        });
    } catch (error) {
        console.error('Error fetching quality settings:', error);
        res.status(500).json({ error: 'Failed to fetch quality settings' });
    }
});

// Update quality filter settings
router.put('/quality', async (req: Request, res: Response) => {
    try {
        const { minScore, allowedTypes } = req.body;

        const updates: Partial<firestoreDb.ScraperConfig> = {};
        if (minScore !== undefined) {
            updates.qualityMinScore = minScore;
        }
        if (allowedTypes !== undefined) {
            updates.qualityAllowedTypes = allowedTypes;
        }

        await firestoreDb.updateConfig(updates);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating quality settings:', error);
        res.status(500).json({ error: 'Failed to update quality settings' });
    }
});

// Export all settings
router.get('/export', async (_req: Request, res: Response) => {
    try {
        const config = await firestoreDb.getConfig();
        const sources = await firestoreDb.getAllSources();

        res.json({
            exportedAt: new Date().toISOString(),
            version: '1.0',
            schedule: {
                batchSize: config.batchSize,
                intervalHours: config.intervalHours,
                enabled: config.enabled,
            },
            quality: {
                minScore: config.qualityMinScore,
                allowedTypes: config.qualityAllowedTypes,
            },
            sources,
        });
    } catch (error) {
        console.error('Error exporting settings:', error);
        res.status(500).json({ error: 'Failed to export settings' });
    }
});

// Import settings
router.post('/import', async (req: Request, res: Response) => {
    try {
        const { schedule, quality, sources } = req.body;

        // Import schedule settings
        if (schedule) {
            const updates: Partial<firestoreDb.ScraperConfig> = {};
            if (schedule.batchSize !== undefined) updates.batchSize = schedule.batchSize;
            if (schedule.intervalHours !== undefined) updates.intervalHours = schedule.intervalHours;
            if (schedule.enabled !== undefined) updates.enabled = schedule.enabled;
            await firestoreDb.updateConfig(updates);
        }

        // Import quality settings
        if (quality) {
            const updates: Partial<firestoreDb.ScraperConfig> = {};
            if (quality.minScore !== undefined) updates.qualityMinScore = quality.minScore;
            if (quality.allowedTypes !== undefined) updates.qualityAllowedTypes = quality.allowedTypes;
            await firestoreDb.updateConfig(updates);
        }

        // Import sources (adds new sources)
        if (sources && Array.isArray(sources)) {
            for (const source of sources) {
                await firestoreDb.createSource(source.type, source.query);
            }
        }

        res.json({ success: true, message: 'Settings imported successfully' });
    } catch (error) {
        console.error('Error importing settings:', error);
        res.status(500).json({ error: 'Failed to import settings' });
    }
});

export default router;
