/**
 * Post Creator Service
 * Creates posts in Firestore from processed images
 */

import admin from 'firebase-admin';
import { db, SYSTEM_AUTHOR_ID } from '../firebase.js';
import type { PostData, QualityAnalysis } from '../types.js';

interface CreatePostParams {
    heifUrl: string;
    jpegUrl: string;
    width: number;
    height: number;
    sourceUrl: string;
    sourceDomain: string;
    tags: string[];
    description?: string;
    externalId?: string;
    originalCreatedAt?: string; // ISO string preferred for transport
    attribution?: {
        name?: string;
        url?: string;
        username?: string;
    };
}

const BLACKLISTED_TAGS = [
    'pexels',
    'unsplash',
    'stock',
    'photo',
    'image',
    'picture',
    'hd',
    '4k',
    'wallpaper',
    'background',
    'download',
    'free',
    'royalty',
    'copyright'
];
export async function createPost(params: CreatePostParams): Promise<string> {
    const {
        heifUrl, jpegUrl, width, height, sourceUrl, sourceDomain, tags, description,
        externalId, originalCreatedAt, attribution
    } = params;

    // Generate post ID
    const postRef = db.collection('userPosts').doc();
    const postId = postRef.id;

    const postData: PostData = {
        id: postId,
        authorId: SYSTEM_AUTHOR_ID,
        type: 'image',
        content: {
            url: heifUrl,
            jpegUrl: jpegUrl,
            width,
            height,
        },
        description: null,  // No auto-generated descriptions for scraped images
        tags,
        sourceDomain,
        sourceUrl,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        embeddingStatus: 'pending',
        processingStatus: 'pending',
        moderationStatus: 'approved', // Auto-approve scraped content per requirements
        isSystemCurated: true,
        externalId,
        originalCreatedAt,
        attribution,
    };

    await postRef.set(postData);
    console.log(`  Created post: ${postId}`);

    return postId;
}

/**
 * Generate tags from quality analysis or defaults
 */
export function generateTags(
    analysis: QualityAnalysis | null,
    sourceDomain: string,
    alt?: string
): string[] {
    const tags: string[] = [];

    // Add tags from AI analysis
    if (analysis?.suggestedTags?.length) {
        tags.push(...analysis.suggestedTags);
    }

    // Add source domain as a tag
    const cleanDomain = sourceDomain.replace(/\.(com|org|net|io)$/, '');
    if (cleanDomain && !tags.includes(cleanDomain)) {
        tags.push(cleanDomain);
    }

    // Extract keywords from alt text
    if (alt && alt.length > 5) {
        const keywords = alt
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3 && word.length < 20)
            .slice(0, 5);

        for (const keyword of keywords) {
            if (!tags.includes(keyword)) {
                tags.push(keyword);
            }
        }
    }

    // Limit to 10 tags
    return tags
        .map(tag => tag.toLowerCase())
        .filter(tag => !BLACKLISTED_TAGS.includes(tag))
        .slice(0, 10);
}
