/**
 * Puppeteer-based Scraper for JavaScript-rendered websites
 * Uses headless Chrome to render the page before extracting images
 */

import puppeteer, { Browser } from 'puppeteer';
import { BaseScraper } from './base.js';
import type { ScrapedImage } from '../types.js';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (!browserInstance || !browserInstance.isConnected()) {
        console.log(`  [Puppeteer] Launching new browser instance...`);
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ],
        });
    }
    return browserInstance;
}

export class PuppeteerScraper extends BaseScraper {
    name = 'url';

    isConfigured(): boolean {
        return true;
    }

    /**
     * Legacy scrape method to satisfy BaseScraper interface.
     * Uses the new visitPage method internally.
     */
    async scrape(url: string, limit: number, config?: { crawlDepth?: number; followLinks?: boolean }): Promise<ScrapedImage[]> {
        // We ignore depth/recursion here as that is now handled by the Crawler Service
        const result = await this.visitPage(url);
        return result.images.slice(0, limit);
    }

    async visitPage(url: string): Promise<{ images: ScrapedImage[]; links: string[] }> {
        let page = null;
        const images: ScrapedImage[] = [];
        let links: string[] = [];

        try {
            const browser = await getBrowser();
            console.log(`  [Puppeteer] Visiting: ${url}`);
            page = await browser.newPage();

            // Screen & UA
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // Navigate
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            const domain = new URL(url).hostname.replace(/^www\./, '');

            // Scroll for Lazy Load
            await page.evaluate(`
                (async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 300;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= scrollHeight || totalHeight >= 3000) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                })()
            `);
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Extract Images
            const isPinterest = domain.includes('pinterest');
            const imgData = await page.$$eval('img', (imgs, isPinterestPage) => {
                return imgs.map(img => {
                    const rect = img.getBoundingClientRect();
                    let parentLink: string | null = null;
                    let parent = img.parentElement;

                    for (let i = 0; i < 10 && parent; i++) {
                        if (parent.tagName === 'A') {
                            const href = (parent as any).href;
                            if (isPinterestPage) {
                                if (href.includes('/pin/')) {
                                    parentLink = href;
                                    break;
                                }
                            } else {
                                parentLink = href;
                                break;
                            }
                        }
                        parent = parent.parentElement;
                    }

                    return {
                        src: img.src || img.dataset?.src || '',
                        alt: img.alt || '',
                        width: rect.width || img.naturalWidth || 0,
                        height: rect.height || img.naturalHeight || 0,
                        parentLink,
                    };
                });
            }, isPinterest);

            // Process images
            const skipPatterns = [
                'logo', 'icon', 'avatar', 'sprite', 'button',
                'tracking', 'pixel', 'spacer', 'beacon', '1x1',
                'blank', 'placeholder', 'loading', 'spinner',
                'arrow', 'chevron', 'caret', 'emoji', 'badge',
                'data:image', 'svg+xml'
            ];

            const seenUrls = new Set<string>();

            for (const img of imgData) {
                let src = img.src;
                if (!src || src.startsWith('data:') || src.includes('placeholder')) continue;

                const srcLower = src.toLowerCase();
                if (skipPatterns.some(p => srcLower.includes(p))) continue;
                if (img.width < 150 || img.height < 150) continue;

                // Pinterest cleanup
                if (src.includes('pinimg.com/236x/')) {
                    src = src.replace('/236x/', '/736x/');
                }

                // Twitter/X upgrade
                if (src.includes('pbs.twimg.com/media/')) {
                    try {
                        if (src.includes('?')) {
                            const twitterUrl = new URL(src);
                            twitterUrl.searchParams.set('name', 'orig');
                            src = twitterUrl.toString();
                        } else {
                            src = src.split(':')[0] + '?name=orig';
                        }
                    } catch (e) { }
                }

                try {
                    const absoluteUrl = new URL(src, url).toString();
                    if (seenUrls.has(absoluteUrl)) continue;
                    seenUrls.add(absoluteUrl);

                    const isUpgraded = src !== img.src;

                    let itemSourceUrl = url;
                    if (img.parentLink) {
                        try {
                            itemSourceUrl = new URL(img.parentLink, url).toString();
                        } catch {
                            itemSourceUrl = url;
                        }
                    }

                    images.push({
                        url: absoluteUrl,
                        sourceUrl: itemSourceUrl,
                        sourceDomain: domain,
                        alt: img.alt || undefined,
                        width: isUpgraded ? 0 : Math.round(img.width),
                        height: isUpgraded ? 0 : Math.round(img.height),
                    });
                } catch (e) {
                    // Invalid URL
                }
            }

            // Extract Links
            const rawLinks = await page.$$eval('a', (anchors) => anchors.map(a => a.href));
            links = Array.from(new Set(rawLinks.filter(l => l && l.startsWith('http'))));

            return { images, links };

        } catch (error) {
            console.error(`  [Puppeteer] Error visiting ${url}:`, error);
            return { images: [], links: [] };
        } finally {
            if (page) {
                await page.close().catch(() => { });
            }
        }
    }
}

// Cleanup on exit
process.on('exit', async () => {
    if (browserInstance) {
        await browserInstance.close().catch(() => { });
    }
});

export default PuppeteerScraper;
