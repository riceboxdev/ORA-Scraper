/**
 * Main Scraper Job Orchestrator
 * Coordinates sources, scrapers, filtering, and post creation
 */

import { queries, isImageAlreadyScraped, markImageAsScraped, incrementDailyStat, isImagePermanentlyFailed, recordImageFailure } from '../db.js';
import { UnsplashScraper } from '../scrapers/unsplash.js';
import { RedditScraper } from '../scrapers/reddit.js';
import { PuppeteerScraper } from '../scrapers/puppeteer.js';
import { filterImage } from './quality-filter.js';
import { processAndUploadImage } from './image-processor.js';
import { createPost, generateTags } from './post-creator.js';
import type { Source, ScrapedImage } from '../types.js';

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

    // Get enabled sources
    const sources = queries.getEnabledSources.all() as Source[];

    if (sources.length === 0) {
        console.log('No enabled sources, skipping');
        return;
    }

    console.log(`Found ${sources.length} enabled sources`);

    // Calculate images per source
    const imagesPerSource = Math.ceil(batchSize / sources.length);

    let totalProcessed = 0;
    let totalUploaded = 0;
    let totalFiltered = 0;
    let totalFailed = 0;

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
            const images = await scraper.scrape(source.query, imagesPerSource * 2); // Get extra for filtering
            console.log(`  Found ${images.length} images`);

            let sourceUploaded = 0;

            for (const image of images) {
                if (sourceUploaded >= imagesPerSource) {
                    console.log(`  Reached limit for this source`);
                    break;
                }

                totalProcessed++;
                incrementDailyStat('imagesScraped');

                // Check if already scraped
                if (isImageAlreadyScraped(image.url)) {
                    console.log(`  Skipping duplicate: ${image.url.substring(0, 50)}...`);
                    continue;
                }

                // Check if permanently failed (3+ failures)
                if (isImagePermanentlyFailed(image.url)) {
                    console.log(`  Skipping permanently failed: ${image.url.substring(0, 50)}...`);
                    continue;
                }

                // Quality filter
                const filterResult = await filterImage(image);
                if (!filterResult.passed) {
                    console.log(`  Filtered: ${filterResult.reason}`);
                    totalFiltered++;
                    incrementDailyStat('qualityFiltered');
                    continue;
                }

                // Process and upload
                const processed = await processAndUploadImage(image);
                if (!processed) {
                    const failCount = recordImageFailure(image.url, 'Processing/upload failed');
                    console.log(`  Failed (attempt ${failCount}/3): ${image.url.substring(0, 50)}...`);
                    totalFailed++;
                    incrementDailyStat('imagesFailed');
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

                    // Mark as scraped
                    markImageAsScraped(source.id, image.url, postId);

                    sourceUploaded++;
                    totalUploaded++;
                    incrementDailyStat('imagesUploaded');
                } catch (error) {
                    console.error('  Failed to create post:', error);
                    totalFailed++;
                    incrementDailyStat('imagesFailed');
                }
            }

            // Update source stats
            queries.updateSourceStats.run(sourceUploaded, source.id);
            console.log(`  Uploaded ${sourceUploaded} images from this source`);

        } catch (error) {
            console.error(`  Error processing source:`, error);
        }
    }

    console.log('\n=== Scrape job complete ===');
    console.log(`Processed: ${totalProcessed}`);
    console.log(`Uploaded: ${totalUploaded}`);
    console.log(`Filtered: ${totalFiltered}`);
    console.log(`Failed: ${totalFailed}`);
}
