/**
 * Continuous Crawler Service
 * Manages the persistent crawl queue (SQLite) and processes pages
 */

import {
    getNextCrawlBatch,
    updateCrawlStatus,
    addToCrawlQueue,
    isImageAlreadyScraped,
    markImageAsScraped,
    isImagePermanentlyFailed,
    recordImageFailure,
    incrementDailyStat
} from '../db.js';
import * as firestoreDb from '../firestore-db.js';
import { PuppeteerScraper } from '../scrapers/puppeteer.js';
import { filterImage } from './quality-filter.js';
import { processAndUploadImage } from './image-processor.js';
import { createPost, generateTags } from './post-creator.js';
import type { ScrapedImage, CrawlQueueItem } from '../types.js';

// Initialize scraper
// Note: We might want to pool this or manage browser instance more carefully
const puppeteerScraper = new PuppeteerScraper();

// Priority levels
const PRIORITY_HIGH = 10;
const PRIORITY_NORMAL = 5;
const PRIORITY_LOW = 1;

/**
 * Process the next batch of URLs from the crawl queue
 */
export async function processCrawlQueue(batchSize: number = 5): Promise<void> {
    console.log(`\n=== Crawler: Processing batch of ${batchSize} ===`);

    const items = getNextCrawlBatch(batchSize);

    if (items.length === 0) {
        console.log('Crawler: Queue is empty.');
        return;
    }

    console.log(`Crawler: Picked up ${items.length} items`);

    // Process SEQUENTIALLY to save resources (RAM/CPU)
    // Running 30 Chrome instances in parallel will crash a standard VPS
    for (const item of items) {
        await processQueueItem(item);
    }
}

async function processQueueItem(item: CrawlQueueItem): Promise<void> {
    console.log(`Crawler: Visiting ${item.url} (Depth: ${item.depth})`);

    try {
        // 1. Visit Page
        // We need to cast puppeteerScraper to access the new method we are about to add
        // Or we can just assume it exists if we are in TS
        const result = await (puppeteerScraper as any).visitPage(item.url);

        const { images, links } = result;
        console.log(`Crawler: Found ${images.length} images, ${links.length} links on ${item.url}`);

        // 2. Process Images
        let uploadedCount = 0;

        for (const image of images) {
            // Check duplicates (SQLite)
            if (isImageAlreadyScraped(image.url)) continue;
            if (isImagePermanentlyFailed(image.url)) continue;

            // Quality Filter
            const filterResult = await filterImage(image);
            if (!filterResult.passed) {
                incrementDailyStat('qualityFiltered');
                continue;
            }

            // Process & Upload
            const processed = await processAndUploadImage(image);
            if (!processed) {
                recordImageFailure(image.url, 'Processing/upload failed');
                incrementDailyStat('imagesFailed');
                continue;
            }

            // Generate Tags & Create Post (Firestore)
            const tags = generateTags(filterResult.analysis, image.sourceDomain, image.alt);

            try {
                const postId = await createPost({
                    heifUrl: processed.heifUrl,
                    jpegUrl: processed.jpegUrl,
                    width: processed.width,
                    height: processed.height,
                    sourceUrl: image.sourceUrl,
                    sourceDomain: image.sourceDomain,
                    tags,
                    description: image.alt,
                });

                // Mark Scraped (SQLite)
                markImageAsScraped(item.sourceId, image.url, postId);
                incrementDailyStat('imagesUploaded');
                uploadedCount++;
            } catch (error) {
                console.error('Crawler: Failed to create post:', error);
                incrementDailyStat('imagesFailed');
            }
        }

        if (uploadedCount > 0) {
            console.log(`Crawler: Uploaded ${uploadedCount} new images from ${item.url}`);
            // Update source stats
            await firestoreDb.updateSourceStats(item.sourceId, uploadedCount);
        }

        // 3. Process Links (Add to Queue)
        // Check depth limit
        // We need to fetch the source config to know the max depth
        const source = await firestoreDb.getSourceById(item.sourceId);
        const maxDepth = source?.crawlDepth ?? 2; // Default strict depth
        const followLinks = source?.followLinks ?? false;

        if (item.depth < maxDepth) {
            const newItems = links.map((link: string) => ({
                url: link,
                sourceId: item.sourceId,
                depth: item.depth + 1,
                priority: PRIORITY_NORMAL,
            }));

            if (newItems.length > 0) {
                addToCrawlQueue(newItems);
                console.log(`Crawler: Added ${newItems.length} new links to queue`);
            }
        }

        // 4. Mark Completed
        updateCrawlStatus(item.id!, 'completed');

    } catch (error: any) {
        console.error(`Crawler: Failed to process ${item.url}:`, error);
        updateCrawlStatus(item.id!, 'failed', String(error));
    }
}
