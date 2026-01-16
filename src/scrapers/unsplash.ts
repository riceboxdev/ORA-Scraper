/**
 * Unsplash API Scraper
 * Uses the official Unsplash API for high-quality, legal images
 */

import axios from 'axios';
import { config } from '../config.js';
import { BaseScraper } from './base.js';
import type { ScrapedImage } from '../types.js';

interface UnsplashPhoto {
    id: string;
    urls: {
        raw: string;
        full: string;
        regular: string;
        small: string;
    };
    alt_description: string | null;
    width: number;
    height: number;
    links: {
        html: string;
    };
    user: {
        name: string;
        links: {
            html: string;
        };
    };
}

interface UnsplashSearchResponse {
    results: UnsplashPhoto[];
    total: number;
    total_pages: number;
}

export class UnsplashScraper extends BaseScraper {
    name = 'unsplash';
    private accessKey: string;

    constructor() {
        super();
        this.accessKey = config.unsplashAccessKey;
    }

    isConfigured(): boolean {
        return !!this.accessKey;
    }

    async scrape(query: string, limit: number): Promise<ScrapedImage[]> {
        if (!this.isConfigured()) {
            console.warn('Unsplash scraper not configured - missing access key');
            return [];
        }

        try {
            const response = await axios.get<UnsplashSearchResponse>(
                'https://api.unsplash.com/search/photos',
                {
                    params: {
                        query,
                        per_page: Math.min(limit, 30), // Unsplash max
                        order_by: 'relevant',
                    },
                    headers: {
                        Authorization: `Client-ID ${this.accessKey}`,
                    },
                }
            );

            return response.data.results.map((photo) => ({
                url: photo.urls.regular, // Good quality, not too large
                sourceUrl: photo.links.html,
                sourceDomain: 'unsplash.com',
                alt: photo.alt_description || undefined,
                width: photo.width,
                height: photo.height,
            }));
        } catch (error) {
            console.error('Unsplash scrape failed:', error);
            return [];
        }
    }
}

export default UnsplashScraper;
