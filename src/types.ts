/**
 * Shared type definitions for ORA Scraper Service
 */

export interface Source {
    id: number;
    type: 'unsplash' | 'reddit' | 'url';
    query: string;
    enabled: boolean;
    lastScrapedAt: string | null;
    totalScraped: number;
    createdAt: string;
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
    sourceId: number;
    images: ScrapedImage[];
    errors: string[];
}
