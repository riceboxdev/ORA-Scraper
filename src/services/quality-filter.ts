/**
 * Image Quality Filter Service
 * Two-stage filtering: rule-based + AI analysis
 */

import axios from 'axios';
import type { ScrapedImage, QualityAnalysis } from '../types.js';

// Stage 1: Rule-based filtering (fast, free)
export function passesRuleBasedFilter(image: ScrapedImage): boolean {
    const { url, width, height } = image;

    // Skip small images
    if (width && height) {
        if (width < 400 || height < 400) {
            console.log(`  [Filter] Too small (${width}x${height}): ${url.substring(0, 50)}...`);
            return false;
        }

        // Skip extreme aspect ratios (likely banners/ads)
        const ratio = width / height;
        if (ratio > 4 || ratio < 0.25) {
            console.log(`  [Filter] Bad aspect ratio (${ratio.toFixed(2)}): ${url.substring(0, 50)}...`);
            return false;
        }
    }

    // Skip URLs with suspicious patterns
    const skipPatterns = [
        'logo', 'icon', 'avatar', 'sprite', 'button',
        'tracking', 'pixel', 'spacer', 'beacon', '1x1',
        'blank', 'placeholder', 'loading', 'spinner',
        'arrow', 'chevron', 'caret', 'emoji',
    ];

    const lowercaseUrl = url.toLowerCase();
    for (const pattern of skipPatterns) {
        if (lowercaseUrl.includes(pattern)) {
            console.log(`  [Filter] Blocked by pattern "${pattern}": ${url.substring(0, 60)}...`);
            return false;
        }
    }

    return true;
}

// Stage 2: AI Quality Analysis
// This calls the Firebase Cloud Function for server-side analysis
export async function analyzeImageQuality(
    imageUrl: string,
    functionsUrl: string
): Promise<QualityAnalysis | null> {
    try {
        const response = await axios.post(
            `${functionsUrl}/analyzeImageQuality`,
            { imageUrl },
            { timeout: 30000 }
        );

        return response.data as QualityAnalysis;
    } catch (error) {
        console.error('AI quality analysis failed:', error);
        return null;
    }
}

// Simplified local analysis when cloud function is unavailable
export function localQualityEstimate(image: ScrapedImage): QualityAnalysis {
    let score = 5; // Base score

    // Bonus for larger images
    if (image.width && image.height) {
        if (image.width >= 1920 || image.height >= 1920) {
            score += 2;
        } else if (image.width >= 1200 || image.height >= 1200) {
            score += 1;
        }
    }

    // Bonus for good aspect ratios (photography-like)
    if (image.width && image.height) {
        const ratio = image.width / image.height;
        // Common good ratios: 4:3, 3:2, 16:9, 1:1
        if ((ratio >= 0.9 && ratio <= 1.1) || // Square
            (ratio >= 1.3 && ratio <= 1.4) || // 4:3
            (ratio >= 1.4 && ratio <= 1.6) || // 3:2
            (ratio >= 1.7 && ratio <= 1.8)) { // 16:9
            score += 1;
        }
    }

    // Bonus for alt text (indicates purposeful content)
    if (image.alt && image.alt.length > 10) {
        score += 1;
    }

    // Penalty for small dimensions
    if (image.width && image.width < 600) {
        score -= 1;
    }

    return {
        score: Math.min(10, Math.max(1, score)),
        type: 'other',
        isHighQuality: score >= 5,
        reason: 'Local heuristic analysis',
        suggestedTags: [],
    };
}

export interface FilterResult {
    passed: boolean;
    analysis: QualityAnalysis | null;
    reason: string;
}

export async function filterImage(
    image: ScrapedImage,
    useAI: boolean = false,
    functionsUrl?: string
): Promise<FilterResult> {
    // Stage 1: Rule-based
    if (!passesRuleBasedFilter(image)) {
        return {
            passed: false,
            analysis: null,
            reason: 'Failed rule-based filter',
        };
    }

    // Stage 2: AI or local analysis
    let analysis: QualityAnalysis;

    if (useAI && functionsUrl) {
        const aiResult = await analyzeImageQuality(image.url, functionsUrl);
        if (aiResult) {
            analysis = aiResult;
        } else {
            analysis = localQualityEstimate(image);
        }
    } else {
        analysis = localQualityEstimate(image);
    }

    // Quality threshold - lower for initial testing (raise if too many low-quality)
    const passed = analysis.score >= 5 && analysis.isHighQuality;

    return {
        passed,
        analysis,
        reason: passed ? 'Passed quality check' : `Score ${analysis.score}/10, quality: ${analysis.isHighQuality}`,
    };
}
