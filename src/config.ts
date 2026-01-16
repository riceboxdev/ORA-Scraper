/**
 * Configuration module for ORA Scraper Service
 * Loads from environment variables with sensible defaults
 */

import 'dotenv/config';

export interface Config {
    // Firebase
    firebaseProjectId: string;

    // APIs
    unsplashAccessKey: string;
    redditClientId: string;
    redditClientSecret: string;

    // Server
    port: number;
    nodeEnv: string;

    // Scraper defaults (can be overridden via settings table)
    defaultBatchSize: number;
    defaultIntervalHours: number;
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function optional(name: string, defaultValue: string): string {
    return process.env[name] || defaultValue;
}

export const config: Config = {
    firebaseProjectId: required('FIREBASE_PROJECT_ID'),

    unsplashAccessKey: optional('UNSPLASH_ACCESS_KEY', ''),
    redditClientId: optional('REDDIT_CLIENT_ID', ''),
    redditClientSecret: optional('REDDIT_CLIENT_SECRET', ''),

    port: parseInt(optional('PORT', '3000'), 10),
    nodeEnv: optional('NODE_ENV', 'development'),

    defaultBatchSize: parseInt(optional('DEFAULT_BATCH_SIZE', '30'), 10),
    defaultIntervalHours: parseInt(optional('DEFAULT_INTERVAL_HOURS', '4'), 10),
};

export default config;
