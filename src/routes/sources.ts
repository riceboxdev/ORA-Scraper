/**
 * Express routes for source management
 */

import { Router, Request, Response } from 'express';
import { queries, setSetting, getSetting } from '../db.js';
import type { Source } from '../types.js';

const router = Router();

// Get all sources
router.get('/', (_req: Request, res: Response) => {
    try {
        const sources = queries.getAllSources.all() as Source[];
        res.json(sources);
    } catch (error) {
        console.error('Error fetching sources:', error);
        res.status(500).json({ error: 'Failed to fetch sources' });
    }
});

// Create a new source
router.post('/', (req: Request, res: Response) => {
    try {
        const { type, query } = req.body;

        if (!type || !query) {
            res.status(400).json({ error: 'Type and query are required' });
            return;
        }

        if (!['unsplash', 'reddit', 'url'].includes(type)) {
            res.status(400).json({ error: 'Invalid source type' });
            return;
        }

        const result = queries.createSource.run(type, query);
        const source = queries.getSourceById.get(result.lastInsertRowid) as Source;
        res.status(201).json(source);
    } catch (error) {
        console.error('Error creating source:', error);
        res.status(500).json({ error: 'Failed to create source' });
    }
});

// Update a source
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { type, query, enabled } = req.body;

        const existing = queries.getSourceById.get(id) as Source | undefined;
        if (!existing) {
            res.status(404).json({ error: 'Source not found' });
            return;
        }

        queries.updateSource.run(
            type ?? existing.type,
            query ?? existing.query,
            enabled !== undefined ? (enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
            id
        );

        const updated = queries.getSourceById.get(id) as Source;
        res.json(updated);
    } catch (error) {
        console.error('Error updating source:', error);
        res.status(500).json({ error: 'Failed to update source' });
    }
});

// Delete a source
router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = queries.deleteSource.run(id);

        if (result.changes === 0) {
            res.status(404).json({ error: 'Source not found' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting source:', error);
        res.status(500).json({ error: 'Failed to delete source' });
    }
});

// Get schedule settings
router.get('/settings/schedule', (_req: Request, res: Response) => {
    try {
        res.json({
            batchSize: parseInt(getSetting('batchSize') || '30', 10),
            intervalHours: parseInt(getSetting('intervalHours') || '4', 10),
            enabled: getSetting('enabled') === 'true',
            lastRunAt: getSetting('lastRunAt') || null,
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Update schedule settings
router.put('/settings/schedule', (req: Request, res: Response) => {
    try {
        const { batchSize, intervalHours, enabled } = req.body;

        if (batchSize !== undefined) {
            setSetting('batchSize', String(Math.max(1, Math.min(100, batchSize))));
        }
        if (intervalHours !== undefined) {
            setSetting('intervalHours', String(Math.max(1, Math.min(24, intervalHours))));
        }
        if (enabled !== undefined) {
            setSetting('enabled', enabled ? 'true' : 'false');
        }

        res.json({
            batchSize: parseInt(getSetting('batchSize') || '30', 10),
            intervalHours: parseInt(getSetting('intervalHours') || '4', 10),
            enabled: getSetting('enabled') === 'true',
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

export default router;
