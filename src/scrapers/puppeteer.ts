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

    async scrape(url: string, limit: number): Promise<ScrapedImage[]> {
        let page = null;

        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname.replace(/^www\./, '');

            console.log(`  [Puppeteer] Starting scrape of: ${url}`);

            const browser = await getBrowser();
            console.log(`  [Puppeteer] Browser ready, creating page...`);
            page = await browser.newPage();

            // Set viewport and user agent
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            console.log(`  [Puppeteer] Navigating to URL...`);

            // Navigate and wait for network to settle
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            console.log(`  [Puppeteer] Page loaded, scrolling to trigger lazy loading...`);

            // Scroll down to trigger lazy loading - use string to avoid transpilation issues
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

            // Wait a bit for any lazy-loaded images
            await new Promise(resolve => setTimeout(resolve, 1500));

            console.log(`  [Puppeteer] Extracting images...`);

            // Check if this is a Pinterest page
            const isPinterest = domain.includes('pinterest');

            // Extract images with their parent link (for Pinterest pin URLs)
            const imgData = await page.$$eval('img', (imgs, isPinterestPage) => {
                return imgs.map(img => {
                    const rect = img.getBoundingClientRect();

                    // Try to find the parent anchor tag to get the individual item URL
                    let parentLink: string | null = null;
                    let parent = img.parentElement;


                    // Walk up the DOM looking for an anchor tag (up to 10 levels)
                    for (let i = 0; i < 10 && parent; i++) {
                        if (parent.tagName === 'A') {
                            const href = (parent as any).href;

                            // For Pinterest, only use links that go to /pin/ pages
                            if (isPinterestPage) {
                                if (href.includes('/pin/')) {
                                    parentLink = href;
                                    break;
                                }
                            } else {
                                // For other sites, use any anchor link
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

            console.log(`  [Puppeteer] Found ${imgData.length} img elements`);

            // Filter and format results
            const skipPatterns = [
                'logo', 'icon', 'avatar', 'sprite', 'button',
                'tracking', 'pixel', 'spacer', 'beacon', '1x1',
                'blank', 'placeholder', 'loading', 'spinner',
                'arrow', 'chevron', 'caret', 'emoji', 'badge',
                'data:image', 'svg+xml'
            ];

            const images: ScrapedImage[] = [];
            const seenUrls = new Set<string>();

            for (const img of imgData) {
                if (images.length >= limit) break;
                if (!img.src || seenUrls.has(img.src)) continue;

                let src = img.src; // Introduce mutable src variable
                const srcLower = src.toLowerCase();
                if (skipPatterns.some(p => srcLower.includes(p))) continue;
                if (img.width < 150 || img.height < 150) continue;
                if (!src || src.startsWith('data:') || src.includes('placeholder')) continue;

                // SPECIAL HANDLING: Upgrade Pinterest URLs to high-res
                if (src.includes('pinimg.com/236x/')) {
                    src = src.replace('/236x/', '/736x/');
                }

                // Resolve relative URLs
                const absoluteUrl = new URL(src, url).toString();

                seenUrls.add(absoluteUrl); // Use absoluteUrl for seenUrls

                // If we upgraded the URL, the scraped dimensions are no longer valid (they are for the thumbnail)
                // Set to 0 so the quality filter skips the initial size check and checks the real file instead
                const isUpgraded = src !== img.src;

                // Determine the source URL - use the individual item link if available, otherwise fall back to page URL
                let itemSourceUrl = url;
                if (img.parentLink) {
                    try {
                        // Resolve the parent link to an absolute URL
                        itemSourceUrl = new URL(img.parentLink, url).toString();
                        console.log(`  [Puppeteer] Found individual source: ${itemSourceUrl.substring(0, 60)}...`);
                    } catch {
                        // If URL parsing fails, use the page URL
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
            }

            console.log(`  [Puppeteer] ${images.length} images passed filtering`);
            return images;

        } catch (error) {
            console.error('Puppeteer scrape failed:', error);
            return [];
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
