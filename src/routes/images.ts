/**
 * Express routes for images management
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { db as firestore } from '../firebase.js';

const router = Router();

// Get recently scraped images
router.get('/recent', (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;

        const images = db.prepare(`
            SELECT 
                si.id,
                si.imageUrl,
                si.postId,
                si.scrapedAt,
                s.type as sourceType,
                s.query as sourceQuery
            FROM scraped_images si
            LEFT JOIN sources s ON si.sourceId = s.id
            ORDER BY si.scrapedAt DESC
            LIMIT ?
        `).all(limit);

        // Add sourceDomain from imageUrl
        const enriched = images.map((img: any) => ({
            ...img,
            sourceDomain: extractDomain(img.imageUrl),
        }));

        res.json(enriched);
    } catch (error) {
        console.error('Error fetching recent images:', error);
        res.status(500).json({ error: 'Failed to fetch recent images' });
    }
});

// Get failed images
router.get('/failed', (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;

        const images = db.prepare(`
            SELECT 
                id,
                imageUrl,
                failCount,
                lastFailReason,
                firstFailedAt,
                lastFailedAt
            FROM failed_images
            WHERE failCount < 10
            ORDER BY lastFailedAt DESC
            LIMIT ?
        `).all(limit);

        const enriched = images.map((img: any) => ({
            ...img,
            sourceDomain: extractDomain(img.imageUrl),
        }));

        res.json(enriched);
    } catch (error) {
        console.error('Error fetching failed images:', error);
        res.status(500).json({ error: 'Failed to fetch failed images' });
    }
});

// Get quality-filtered images
router.get('/filtered', (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;

        // Check if filtered_images table exists
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='filtered_images'
        `).get();

        if (!tableExists) {
            res.json([]);
            return;
        }

        const images = db.prepare(`
            SELECT 
                id,
                imageUrl,
                qualityScore,
                qualityType,
                filterReason,
                filteredAt,
                sourceId
            FROM filtered_images
            ORDER BY filteredAt DESC
            LIMIT ?
        `).all(limit);

        const enriched = images.map((img: any) => ({
            ...img,
            sourceDomain: extractDomain(img.imageUrl),
        }));

        res.json(enriched);
    } catch (error) {
        console.error('Error fetching filtered images:', error);
        res.status(500).json({ error: 'Failed to fetch filtered images' });
    }
});

// Get single image details
router.get('/:id', (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id, 10);

        // Try scraped_images first
        let image = db.prepare(`
            SELECT 
                si.*,
                s.type as sourceType,
                s.query as sourceQuery
            FROM scraped_images si
            LEFT JOIN sources s ON si.sourceId = s.id
            WHERE si.id = ?
        `).get(id);

        if (!image) {
            // Try failed_images
            image = db.prepare('SELECT * FROM failed_images WHERE id = ?').get(id);
        }

        if (!image) {
            res.status(404).json({ error: 'Image not found' });
            return;
        }

        res.json(image);
    } catch (error) {
        console.error('Error fetching image:', error);
        res.status(500).json({ error: 'Failed to fetch image' });
    }
});

// Retry a failed image
router.post('/:id/retry', (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id, 10);

        // Reset fail count to allow retry
        db.prepare(`
            UPDATE failed_images 
            SET failCount = 0, 
                lastFailReason = 'Manual retry requested'
            WHERE id = ?
        `).run(id);

        res.json({ success: true, message: 'Image queued for retry' });
    } catch (error) {
        console.error('Error retrying image:', error);
        res.status(500).json({ error: 'Failed to retry image' });
    }
});

// Permanently skip a failed image
router.delete('/:id/skip', (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id, 10);

        // Set fail count to high number to skip permanently
        db.prepare(`
            UPDATE failed_images 
            SET failCount = 999, 
                lastFailReason = 'Permanently skipped by user'
            WHERE id = ?
        `).run(id);

        res.json({ success: true, message: 'Image skipped permanently' });
    } catch (error) {
        console.error('Error skipping image:', error);
        res.status(500).json({ error: 'Failed to skip image' });
    }
});

// Clear all failed images cache
router.delete('/failed/clear', (_req: Request, res: Response) => {
    try {
        db.prepare('DELETE FROM failed_images').run();
        res.json({ success: true, message: 'Failed images cache cleared' });
    } catch (error) {
        console.error('Error clearing failed cache:', error);
        res.status(500).json({ error: 'Failed to clear cache' });
    }
});

// Delete image and associated post
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id, 10);

        // 1. Try to find in scraped_images to get postId
        const image = db.prepare('SELECT postId, imageUrl FROM scraped_images WHERE id = ?').get(id) as any;

        if (image) {
            // Delete from Firestore if postId exists
            if (image.postId) {
                try {
                    await firestore.collection('userPosts').doc(image.postId).delete();
                } catch (firestoreError) {
                    console.error(`  Failed to delete Firestore post ${image.postId}:`, firestoreError);
                    // Continue anyway to clean up local DB
                }
            }

            // Delete from local SQLite
            db.prepare('DELETE FROM scraped_images WHERE id = ?').run(id);
            res.json({ success: true, message: 'Image and post deleted' });
            return;
        }

        // 2. Try to find in failed_images
        const failedImage = db.prepare('SELECT id FROM failed_images WHERE id = ?').get(id);
        if (failedImage) {
            db.prepare('DELETE FROM failed_images WHERE id = ?').run(id);
            res.json({ success: true, message: 'Failed image entry deleted' });
            return;
        }

        // 3. Try to find in filtered_images
        const filteredImage = db.prepare('SELECT id FROM filtered_images WHERE id = ?').get(id);
        if (filteredImage) {
            db.prepare('DELETE FROM filtered_images WHERE id = ?').run(id);
            res.json({ success: true, message: 'Filtered image entry deleted' });
            return;
        }

        res.status(404).json({ error: 'Image not found' });
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ error: 'Failed to delete image' });
    }
});

// Helper function to extract domain from URL
function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return 'unknown';
    }
}

export default router;
