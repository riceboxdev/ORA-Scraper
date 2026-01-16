/**
 * Image Processor Service
 * Downloads, validates, resizes, and uploads images to Firebase Storage
 */

import axios from 'axios';
import sharp from 'sharp';
import crypto from 'crypto';
import { storage } from '../firebase.js';
import type { ScrapedImage } from '../types.js';

interface ProcessedImage {
    heifUrl: string;
    jpegUrl: string;
    width: number;
    height: number;
}

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 85;
const HEIF_QUALITY = 80;

/**
 * Download an image from URL
 */
async function downloadImage(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
    });
    return Buffer.from(response.data);
}

/**
 * Resize image to fit within max dimensions while maintaining aspect ratio
 */
async function resizeImage(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    let { width, height } = metadata;

    if (!width || !height) {
        throw new Error('Could not determine image dimensions');
    }

    // Only resize if larger than max
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const resized = await image
            .resize(MAX_DIMENSION, MAX_DIMENSION, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .toBuffer({ resolveWithObject: true });

        return {
            buffer: resized.data,
            width: resized.info.width,
            height: resized.info.height,
        };
    }

    return { buffer, width, height };
}

/**
 * Convert to HEIF format for efficient storage
 */
async function toHeif(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .heif({ quality: HEIF_QUALITY, compression: 'hevc' })
        .toBuffer();
}

/**
 * Convert to JPEG for compatibility
 */
async function toJpeg(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
}

/**
 * Generate a unique filename based on image content
 */
function generateFilename(buffer: Buffer): string {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);
    const timestamp = Date.now();
    return `${timestamp}-${hash}`;
}

/**
 * Upload buffer to Firebase Storage
 */
async function uploadToStorage(
    buffer: Buffer,
    path: string,
    contentType: string
): Promise<string> {
    const bucket = storage.bucket();
    const file = bucket.file(path);

    await file.save(buffer, {
        contentType,
        metadata: {
            cacheControl: 'public, max-age=31536000',
        },
    });

    // Make public and get URL
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${path}`;
}

/**
 * Process and upload a scraped image
 */
export async function processAndUploadImage(image: ScrapedImage): Promise<ProcessedImage | null> {
    try {
        console.log(`Processing image: ${image.url.substring(0, 80)}...`);

        // Download
        const rawBuffer = await downloadImage(image.url);

        // Validate minimum size
        const metadata = await sharp(rawBuffer).metadata();
        if (!metadata.width || !metadata.height) {
            console.log('  Skipped: could not read metadata');
            return null;
        }
        if (metadata.width < 400 || metadata.height < 400) {
            console.log('  Skipped: too small');
            return null;
        }

        // Resize
        const resized = await resizeImage(rawBuffer);

        // Convert to JPEG (most compatible)
        const jpegBuffer = await toJpeg(resized.buffer);

        // Generate paths
        const filename = generateFilename(resized.buffer);
        const jpegPath = `scraped_posts/${filename}.jpg`;

        // Upload JPEG only (HEIF requires libheif with x265)
        const jpegUrl = await uploadToStorage(jpegBuffer, jpegPath, 'image/jpeg');

        console.log(`  Uploaded: ${filename}`);

        return {
            heifUrl: jpegUrl,  // Use JPEG for both (HEIF not supported on all systems)
            jpegUrl,
            width: resized.width,
            height: resized.height,
        };
    } catch (error) {
        console.error(`  Failed to process image:`, error);
        return null;
    }
}
