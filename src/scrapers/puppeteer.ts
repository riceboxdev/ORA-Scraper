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

    async scrape(url: string, limit: number, config?: { crawlDepth?: number; followLinks?: boolean }): Promise<ScrapedImage[]> {
        const { crawlDepth = 0, followLinks = false } = config || {};
        let page = null;
        const images: ScrapedImage[] = [];
        const seenUrls = new Set<string>();
        const visitedPages = new Set<string>();

        // Queue for BFS: { url, depth }
        const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];

        try {
            const browser = await getBrowser();
            console.log(`  [Puppeteer] Browser ready, creating page...`);
            page = await browser.newPage();

            // Set viewport and user agent once
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // Process queue
            while (queue.length > 0 && images.length < limit) {
                const current = queue.shift();
                if (!current) break;

                // Skip if already visited
                if (visitedPages.has(current.url)) continue;
                visitedPages.add(current.url);

                console.log(`  [Puppeteer] Visiting (Depth ${current.depth}/${crawlDepth}): ${current.url}`);

                try {
                    const parsedUrl = new URL(current.url);
                    const domain = parsedUrl.hostname.replace(/^www\./, '');

                    // Navigate
                    await page.goto(current.url, {
                        waitUntil: 'networkidle2',
                        timeout: 30000
                    });

                    // Scroll to trigger lazy loading
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

                    for (const img of imgData) {
                        if (images.length >= limit) break;

                        let src = img.src;
                        if (!src || src.startsWith('data:') || src.includes('placeholder')) continue;

                        const srcLower = src.toLowerCase();
                        if (skipPatterns.some(p => srcLower.includes(p))) continue;
                        if (img.width < 150 || img.height < 150) continue;

                        if (src.includes('pinimg.com/236x/')) {
                            src = src.replace('/236x/', '/736x/');
                        }

                        const absoluteUrl = new URL(src, current.url).toString();
                        if (seenUrls.has(absoluteUrl)) continue;
                        seenUrls.add(absoluteUrl);

                        const isUpgraded = src !== img.src;

                        let itemSourceUrl = current.url;
                        if (img.parentLink) {
                            try {
                                itemSourceUrl = new URL(img.parentLink, current.url).toString();
                            } catch {
                                itemSourceUrl = current.url;
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
                    }

                    // Extract Links for next depth
                    if (current.depth < crawlDepth) {
                        const links = await page.$$eval('a', (anchors) => anchors.map(a => a.href));
                        const uniqueLinks = new Set(links.filter(l => l && l.startsWith('http')));

                        console.log(`  [Puppeteer] Found ${uniqueLinks.size} links to potentially crawl`);

                        for (const link of uniqueLinks) {
                            // Basic filtering (same domain only? or followLinks?)
                            // If followLinks is true, allow any domain. Else, restrict to same domain.
                            try {
                                const linkUrl = new URL(link);
                                const currentUrlObj = new URL(current.url);

                                if (followLinks || linkUrl.hostname === currentUrlObj.hostname) {
                                    if (!visitedPages.has(link) && !queue.some(q => q.url === link)) {
                                        queue.push({ url: link, depth: current.depth + 1 });
                                    }
                                }
                            } catch (e) {
                                // invalid url, skip
                            }
                        }
                    }

                } catch (pageError) {
                    console.error(`  [Puppeteer] Error processing ${current.url}:`, pageError);
                }
            }

            console.log(`  [Puppeteer] Crawl finished. Found ${images.length} images from ${visitedPages.size} pages`);
            return images;

        } catch (error) {
            console.error('Puppeteer scrape failed:', error);
            return images; // Return what we have so far
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
