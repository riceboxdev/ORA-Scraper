/**
 * Shared type definitions for ORA Scraper Service
 */

export interface Source {
    id: string; // Changed from number to support Firestore string IDs
    type: 'unsplash' | 'reddit' | 'url';
    query: string;
    enabled: boolean;
    lastScrapedAt: string | null;
    totalScraped: number;
    createdAt: string;
    crawlDepth?: number;     // Depth limit for crawling (0 = current page only)
    followLinks?: boolean;   // Whether to follow links to other pages
}

export interface ScrapedImage {
    url: string;
    sourceUrl: string;
    sourceDomain: string;
    alt?: string;
    width?: number;
    height?: number;
}

export interface QualityAnalysis {
    score: number;
    type: 'photography' | 'art' | 'design' | 'product' | 'icon' | 'logo' | 'ui_element' | 'other';
    isHighQuality: boolean;
    reason: string;
    suggestedTags: string[];
}

export interface PostData {
    id: string;
    authorId: string;
    type: 'image';
    content: {
        url: string;
        jpegUrl: string;
        width: number;
        height: number;
    };
    description: string | null;
    tags: string[];
    sourceDomain: string;
    sourceUrl: string;
    createdAt: FirebaseFirestore.FieldValue;
    embeddingStatus: 'pending';
    processingStatus: 'pending';
    moderationStatus: 'pending' | 'approved' | 'flagged' | 'rejected'; // Added for moderation
    isSystemCurated: boolean;
}

export interface DailyStats {
    date: string;
    imagesScraped: number;
    imagesUploaded: number;
    imagesFailed: number;
    qualityFiltered: number;
}

export interface ScheduleConfig {
    batchSize: number;
    intervalHours: number;
    enabled: boolean;
}

export interface ScrapeResult {
    sourceId: string; // Changed from number
    images: ScrapedImage[];
    errors: string[];
}
