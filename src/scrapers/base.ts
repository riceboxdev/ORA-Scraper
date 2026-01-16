/**
 * Abstract base class for all scrapers
 */

import type { ScrapedImage } from '../types.js';

export abstract class BaseScraper {
    abstract name: string;

    /**
     * Scrape images from the source
     * @param query The search query or identifier
     * @param limit Maximum number of images to return
     */
    abstract scrape(query: string, limit: number): Promise<ScrapedImage[]>;

    /**
     * Validate that the scraper is properly configured
     */
    abstract isConfigured(): boolean;
}
