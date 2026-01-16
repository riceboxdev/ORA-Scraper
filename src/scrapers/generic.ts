/**
 * Generic URL/HTML Scraper
 * Uses Cheerio for HTML parsing to extract images from any website
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from './base.js';
import type { ScrapedImage } from '../types.js';

export class GenericScraper extends BaseScraper {
    name = 'url';

    isConfigured(): boolean {
        return true; // No external API needed
    }

    async scrape(url: string, limit: number): Promise<ScrapedImage[]> {
        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname.replace(/^www\./, '');

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                },
                timeout: 10000,
                maxRedirects: 3,
            });

            const $ = cheerio.load(response.data);
            const images: ScrapedImage[] = [];
            const seenUrls = new Set<string>();

            // Extract Open Graph image first (usually the best)
            const ogImage = $('meta[property="og:image"]').attr('content');
            if (ogImage) {
                const absoluteUrl = resolveUrl(ogImage, parsedUrl);
                if (absoluteUrl && !seenUrls.has(absoluteUrl)) {
                    seenUrls.add(absoluteUrl);
                    images.push({
                        url: absoluteUrl,
                        sourceUrl: url,
                        sourceDomain: domain,
                        alt: $('meta[property="og:title"]').attr('content') || undefined,
                        width: parseInt($('meta[property="og:image:width"]').attr('content') || '') || undefined,
                        height: parseInt($('meta[property="og:image:height"]').attr('content') || '') || undefined,
                    });
                }
            }

            // Extract regular images
            $('img').each((_, el) => {
                if (images.length >= limit) return false;

                const $el = $(el);
                const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src');
                if (!src) return;

                const absoluteUrl = resolveUrl(src, parsedUrl);
                if (!absoluteUrl) return;

                // Skip already seen, base64, trackers, icons
                if (
                    seenUrls.has(absoluteUrl) ||
                    absoluteUrl.includes('data:image') ||
                    shouldSkipUrl(absoluteUrl)
                ) {
                    return;
                }

                const width = parseInt($el.attr('width') || '') || undefined;
                const height = parseInt($el.attr('height') || '') || undefined;

                // Skip tiny images (likely icons)
                if ((width && width < 100) || (height && height < 100)) {
                    return;
                }

                seenUrls.add(absoluteUrl);
                images.push({
                    url: absoluteUrl,
                    sourceUrl: url,
                    sourceDomain: domain,
                    alt: $el.attr('alt') || undefined,
                    width,
                    height,
                });
            });

            return images.slice(0, limit);
        } catch (error) {
            console.error('Generic scrape failed:', error);
            return [];
        }
    }
}

function resolveUrl(src: string, baseUrl: URL): string | null {
    try {
        if (src.startsWith('//')) {
            return `${baseUrl.protocol}${src}`;
        }
        if (src.startsWith('/')) {
            return `${baseUrl.origin}${src}`;
        }
        if (src.startsWith('http')) {
            return src;
        }
        return new URL(src, baseUrl.origin).href;
    } catch {
        return null;
    }
}

function shouldSkipUrl(url: string): boolean {
    const skipPatterns = [
        'logo', 'icon', 'avatar', 'sprite', 'button', 'tracking',
        'pixel', 'spacer', 'beacon', '1x1', 'blank', 'placeholder',
        'loading', 'spinner', 'arrow', 'chevron', 'caret',
    ];

    const lowercaseUrl = url.toLowerCase();
    return skipPatterns.some(pattern => lowercaseUrl.includes(pattern));
}

export default GenericScraper;
