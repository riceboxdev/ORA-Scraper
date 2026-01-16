/**
 * Reddit API Scraper
 * Fetches images from subreddits using Reddit's JSON API
 */

import axios from 'axios';
import { config } from '../config.js';
import { BaseScraper } from './base.js';
import type { ScrapedImage } from '../types.js';

interface RedditPost {
    data: {
        id: string;
        title: string;
        url: string;
        permalink: string;
        is_video: boolean;
        post_hint?: string;
        preview?: {
            images: Array<{
                source: {
                    url: string;
                    width: number;
                    height: number;
                };
            }>;
        };
    };
}

interface RedditListingResponse {
    data: {
        children: RedditPost[];
        after: string | null;
    };
}

export class RedditScraper extends BaseScraper {
    name = 'reddit';
    private clientId: string;
    private clientSecret: string;
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    constructor() {
        super();
        this.clientId = config.redditClientId;
        this.clientSecret = config.redditClientSecret;
    }

    isConfigured(): boolean {
        return !!this.clientId && !!this.clientSecret;
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

        const response = await axios.post(
            'https://www.reddit.com/api/v1/access_token',
            'grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'ORA-Scraper/1.0',
                },
            }
        );

        this.accessToken = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

        return this.accessToken!;
    }

    async scrape(subreddit: string, limit: number): Promise<ScrapedImage[]> {
        if (!this.isConfigured()) {
            console.warn('Reddit scraper not configured - missing credentials');
            return [];
        }

        try {
            // Clean subreddit name
            const cleanSub = subreddit.replace(/^r\//, '').replace(/\/$/, '');

            const token = await this.getAccessToken();

            const response = await axios.get<RedditListingResponse>(
                `https://oauth.reddit.com/r/${cleanSub}/hot`,
                {
                    params: {
                        limit: Math.min(limit, 100),
                        raw_json: 1,
                    },
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'User-Agent': 'ORA-Scraper/1.0',
                    },
                }
            );

            const images: ScrapedImage[] = [];

            for (const post of response.data.data.children) {
                const { data } = post;

                // Skip videos and non-image posts
                if (data.is_video) continue;
                if (data.post_hint && data.post_hint !== 'image') continue;

                // Check if URL is a valid image
                const url = data.url;
                if (!isImageUrl(url)) continue;

                // Get dimensions from preview if available
                let width: number | undefined;
                let height: number | undefined;
                if (data.preview?.images?.[0]?.source) {
                    const source = data.preview.images[0].source;
                    width = source.width;
                    height = source.height;
                }

                images.push({
                    url: url.replace(/&amp;/g, '&'), // Fix HTML entities
                    sourceUrl: `https://reddit.com${data.permalink}`,
                    sourceDomain: 'reddit.com',
                    alt: data.title || undefined,
                    width,
                    height,
                });
            }

            return images;
        } catch (error) {
            console.error('Reddit scrape failed:', error);
            return [];
        }
    }
}

function isImageUrl(url: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const lowercaseUrl = url.toLowerCase();

    // Direct image URLs
    if (imageExtensions.some(ext => lowercaseUrl.includes(ext))) {
        return true;
    }

    // Imgur direct links
    if (lowercaseUrl.includes('i.imgur.com')) {
        return true;
    }

    // Reddit uploads
    if (lowercaseUrl.includes('i.redd.it')) {
        return true;
    }

    return false;
}

export default RedditScraper;
