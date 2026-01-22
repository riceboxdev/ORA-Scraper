/**
 * Express routes for source management
 * Uses Firestore for persistent storage
 */

import { Router, Request, Response } from 'express';
import * as firestoreDb from '../firestore-db.js';

const router = Router();

// Get all sources
router.get('/', async (_req: Request, res: Response) => {
    try {
        const sources = await firestoreDb.getAllSources();
        res.json(sources);
    } catch (error) {
        console.error('Error fetching sources:', error);
        res.status(500).json({ error: 'Failed to fetch sources' });
    }
});

// Create a new source
router.post('/', async (req: Request, res: Response) => {
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

        const source = await firestoreDb.createSource(type, query);
        res.status(201).json(source);
    } catch (error) {
        console.error('Error creating source:', error);
        res.status(500).json({ error: 'Failed to create source' });
    }
});

// Update a source
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { type, query, enabled } = req.body;

        const existing = await firestoreDb.getSourceById(id);
        if (!existing) {
            res.status(404).json({ error: 'Source not found' });
            return;
        }

        const updates: Partial<{ type: 'unsplash' | 'reddit' | 'url'; query: string; enabled: boolean }> = {};
        if (type !== undefined) updates.type = type;
        if (query !== undefined) updates.query = query;
        if (enabled !== undefined) updates.enabled = enabled;

        const updated = await firestoreDb.updateSource(id, updates);
        res.json(updated);
    } catch (error) {
        console.error('Error updating source:', error);
        res.status(500).json({ error: 'Failed to update source' });
    }
});

// Delete a source
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deleted = await firestoreDb.deleteSource(id);

        if (!deleted) {
            res.status(404).json({ error: 'Source not found' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting source:', error);
        res.status(500).json({ error: 'Failed to delete source' });
    }
});

// Bulk update sources (enable/disable)
router.put('/bulk', async (req: Request, res: Response) => {
    try {
        const { ids, enabled } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'ids array is required' });
            return;
        }

        if (enabled === undefined) {
            res.status(400).json({ error: 'enabled field is required' });
            return;
        }

        const updated = await firestoreDb.bulkUpdateSources(ids, enabled);
        res.json({ success: true, updated });
    } catch (error) {
        console.error('Error bulk updating sources:', error);
        res.status(500).json({ error: 'Failed to update sources' });
    }
});

// Bulk delete sources
router.delete('/bulk', async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'ids array is required' });
            return;
        }

        const deleted = await firestoreDb.bulkDeleteSources(ids);
        res.json({ success: true, deleted });
    } catch (error) {
        console.error('Error bulk deleting sources:', error);
        res.status(500).json({ error: 'Failed to delete sources' });
    }
});

// Get schedule settings
router.get('/settings/schedule', async (_req: Request, res: Response) => {
    try {
        const config = await firestoreDb.getConfig();
        res.json({
            batchSize: config.batchSize,
            intervalHours: config.intervalHours,
            enabled: config.enabled,
            lastRunAt: config.lastRunAt,
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Update schedule settings
router.put('/settings/schedule', async (req: Request, res: Response) => {
    try {
        const { batchSize, intervalHours, enabled } = req.body;

        const updates: Partial<firestoreDb.ScraperConfig> = {};
        if (batchSize !== undefined) {
            updates.batchSize = Math.max(1, Math.min(100, batchSize));
        }
        if (intervalHours !== undefined) {
            updates.intervalHours = Math.max(1, Math.min(24, intervalHours));
        }
        if (enabled !== undefined) {
            updates.enabled = enabled;
        }

        const config = await firestoreDb.updateConfig(updates);
        res.json({
            batchSize: config.batchSize,
            intervalHours: config.intervalHours,
            enabled: config.enabled,
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

export default router;
