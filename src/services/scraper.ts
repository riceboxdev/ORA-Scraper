/**
 * Main Scraper Job Orchestrator
 * Coordinates sources, scrapers, filtering, and post creation
 * Uses Firestore for persistent data and SQLite for cache
 */

import { isImageAlreadyScraped, markImageAsScraped, isImagePermanentlyFailed, recordImageFailure } from '../db.js';
import * as firestoreDb from '../firestore-db.js';
import { UnsplashScraper } from '../scrapers/unsplash.js';
import { RedditScraper } from '../scrapers/reddit.js';
import { PuppeteerScraper } from '../scrapers/puppeteer.js';
import { filterImage } from './quality-filter.js';
import { processAndUploadImage } from './image-processor.js';
import { createPost, generateTags } from './post-creator.js';
import type { ScrapedImage } from '../types.js';

// Initialize scrapers
const scrapers = {
    unsplash: new UnsplashScraper(),
    reddit: new RedditScraper(),
    url: new PuppeteerScraper(),  // Use Puppeteer for JS-rendered sites
};

/**
 * Run the main scrape job
 */
export async function runScrapeJob(batchSize: number): Promise<void> {
    console.log('=== Starting scrape job ===');

    // Create job run record
    const jobRun = await firestoreDb.createJobRun();
    console.log(`Job ID: ${jobRun.id}`);

    let totalProcessed = 0;
    let totalUploaded = 0;
    let totalFiltered = 0;
    let totalFailed = 0;

    try {
        // Get enabled sources from Firestore
        const sources = await firestoreDb.getEnabledSources();

        if (sources.length === 0) {
            console.log('No enabled sources, skipping');
            await firestoreDb.completeJobRun(jobRun.id, {
                imagesScraped: 0,
                imagesUploaded: 0,
                imagesFailed: 0,
                qualityFiltered: 0,
            });
            return;
        }

        console.log(`Found ${sources.length} enabled sources`);

        // Calculate images per source
        const imagesPerSource = Math.ceil(batchSize / sources.length);

        for (const source of sources) {
            console.log(`\nProcessing source: ${source.type} - ${source.query}`);

            try {
                // Get scraper for this source type
                const scraper = scrapers[source.type];
                if (!scraper) {
                    console.warn(`  Unknown source type: ${source.type}`);
                    continue;
                }

                if (!scraper.isConfigured()) {
                    console.warn(`  Scraper not configured: ${source.type}`);
                    continue;
                }

                // Scrape images
                const images = await scraper.scrape(source.query, imagesPerSource * 2, {
                    crawlDepth: source.crawlDepth,
                    followLinks: source.followLinks
                });
                console.log(`  Found ${images.length} images`);

                let sourceUploaded = 0;

                for (const image of images) {
                    if (sourceUploaded >= imagesPerSource) {
                        console.log(`  Reached limit for this source`);
                        break;
                    }

                    totalProcessed++;
                    await firestoreDb.incrementDailyStat('imagesScraped');

                    // Check if already scraped (SQLite cache)
                    if (isImageAlreadyScraped(image.url)) {
                        console.log(`  Skipping duplicate: ${image.url.substring(0, 50)}...`);
                        continue;
                    }

                    // Check if permanently failed (3+ failures) - SQLite cache
                    if (isImagePermanentlyFailed(image.url)) {
                        console.log(`  Skipping permanently failed: ${image.url.substring(0, 50)}...`);
                        continue;
                    }

                    // Quality filter
                    const filterResult = await filterImage(image);
                    if (!filterResult.passed) {
                        console.log(`  Filtered: ${filterResult.reason}`);
                        totalFiltered++;
                        await firestoreDb.incrementDailyStat('qualityFiltered');
                        continue;
                    }

                    // Process and upload
                    const processed = await processAndUploadImage(image);
                    if (!processed) {
                        const failCount = recordImageFailure(image.url, 'Processing/upload failed');
                        console.log(`  Failed (attempt ${failCount}/3): ${image.url.substring(0, 50)}...`);
                        totalFailed++;
                        await firestoreDb.incrementDailyStat('imagesFailed');
                        continue;
                    }

                    // Generate tags
                    const tags = generateTags(
                        filterResult.analysis,
                        image.sourceDomain,
                        image.alt
                    );

                    // Create post
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

                        // Mark as scraped (SQLite cache for deduplication)
                        markImageAsScraped(source.id, image.url, postId);

                        sourceUploaded++;
                        totalUploaded++;
                        await firestoreDb.incrementDailyStat('imagesUploaded');
                    } catch (error) {
                        console.error('  Failed to create post:', error);
                        totalFailed++;
                        await firestoreDb.incrementDailyStat('imagesFailed');
                    }
                }

                // Update source stats in Firestore
                await firestoreDb.updateSourceStats(source.id, sourceUploaded);
                console.log(`  Uploaded ${sourceUploaded} images from this source`);

            } catch (error) {
                console.error(`  Error processing source:`, error);
            }
        }

        // Complete job run
        await firestoreDb.completeJobRun(jobRun.id, {
            imagesScraped: totalProcessed,
            imagesUploaded: totalUploaded,
            imagesFailed: totalFailed,
            qualityFiltered: totalFiltered,
        });

    } catch (error) {
        console.error('Scrape job failed:', error);
        await firestoreDb.failJobRun(jobRun.id, String(error));
    }

    console.log('\n=== Scrape job complete ===');
    console.log(`Processed: ${totalProcessed}`);
    console.log(`Uploaded: ${totalUploaded}`);
    console.log(`Filtered: ${totalFiltered}`);
    console.log(`Failed: ${totalFailed}`);
}
