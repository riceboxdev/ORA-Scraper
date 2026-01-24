
import { db } from '../firebase.js';
import { config } from '../config.js';
import admin from 'firebase-admin';
import type { Category, DiscoveryRun } from '../types.js';

interface WorkerCluster {
    name: string;
    description: string;
    confidence: number; // 0-1
    suggestedColor: string;
    suggestedIcon: string;
    matchingTags: string[];
    thumbnailUrls: string[];
}

interface DiscoveryResult {
    runId: string;
    topicsFound: number;
    topicsCreated: number;
    topicsUpdated: number;
    suggestionsCreated: number;
}

const CATEGORIES_COLLECTION = 'categories';
const SUGGESTIONS_COLLECTION = 'ideaSuggestions';
const RUNS_COLLECTION = 'discovery_runs';

/**
 * Service to handle automated topic discovery and management
 */
export const discoveryService = {

    /**
     * Run the full discovery process:
     * 1. Call worker to find clusters
     * 2. Match against existing topics
     * 3. Create/Update topics or suggestions
     */
    async runDiscoveryJob(sampleSize: number = 500): Promise<DiscoveryResult> {
        console.log(`[Discovery] Starting job with sample size ${sampleSize}...`);

        // 1. Create run record
        const runRef = await db.collection(RUNS_COLLECTION).add({
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'running',
            sampleSize,
            topicsFound: 0,
            topicsCreated: 0,
            topicsUpdated: 0,
            suggestionsCreated: 0
        });
        const runId = runRef.id;

        try {
            // 2. Fetch clusters from worker
            console.log(`[Discovery] Fetching clusters from worker...`);
            const clusters = await this.fetchClustersFromWorker(sampleSize);
            console.log(`[Discovery] Worker returned ${clusters.length} clusters.`);

            // 3. Load existing categories for matching
            const existingCategoriesSnap = await db.collection(CATEGORIES_COLLECTION).get();
            const existingCategories = existingCategoriesSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Category[];

            let topicsCreated = 0;
            let topicsUpdated = 0;
            let suggestionsCreated = 0;

            const batch = db.batch();
            let opCount = 0;

            // 4. Process each cluster
            for (const cluster of clusters) {
                const normalizedSlug = this.generateSlug(cluster.name);

                // Try to find a match
                const match = existingCategories.find(c =>
                    c.slug === normalizedSlug ||
                    c.name.toLowerCase() === cluster.name.toLowerCase()
                );

                if (match) {
                    // UPDATE existing topic
                    const catRef = db.collection(CATEGORIES_COLLECTION).doc(match.id);
                    batch.update(catRef, {
                        lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
                        confidence: cluster.confidence, // Update confidence based on latest run
                        // We might want to merge keywords/thumbnails here too
                    });
                    topicsUpdated++;
                } else {
                    // NEW Topic or Suggestion
                    if (cluster.confidence > 0.85) {
                        // High confidence -> Auto-create Emerging Topic
                        const newCatRef = db.collection(CATEGORIES_COLLECTION).doc();
                        const newTopic: Partial<Category> = {
                            name: cluster.name,
                            slug: normalizedSlug,
                            description: cluster.description,
                            color: cluster.suggestedColor,
                            iconName: cluster.suggestedIcon,
                            postCount: 0, // Will be calculated separately or by worker?
                            thumbnailUrls: cluster.thumbnailUrls,
                            createdAt: new Date().toISOString(),
                            status: 'emerging',
                            confidence: cluster.confidence,
                            isSystemGenerated: true,
                            keywords: cluster.matchingTags,
                            lastRefreshedAt: new Date().toISOString(),
                            source: 'automated-discovery'
                        };

                        // Use set instead of create for explicit control if needed, but here simple set
                        batch.set(newCatRef, newTopic);
                        topicsCreated++;
                    } else {
                        // Low confidence -> Suggestion
                        // Check if suggestion exists to avoid dupes? 
                        // For simplicity, we'll creates new or overwrite based on slug if we generated IDs deterministically, 
                        // but currently suggestions are random IDs. We'll just add new ones for now or todo: dedupe.
                        // Ideally we check if a pending suggestion exists.

                        const suggestionRef = db.collection(SUGGESTIONS_COLLECTION).doc();
                        batch.set(suggestionRef, {
                            ...cluster,
                            suggestedAt: admin.firestore.FieldValue.serverTimestamp(),
                            status: 'pending',
                            sourceRunId: runId
                        });
                        suggestionsCreated++;
                    }
                }

                opCount++;
                if (opCount >= 450) { // Commit batch if getting full
                    await batch.commit();
                    opCount = 0;
                }
            }

            if (opCount > 0) {
                await batch.commit();
            }

            // 5. Complete run record
            const result: DiscoveryResult = {
                runId,
                topicsFound: clusters.length,
                topicsCreated,
                topicsUpdated,
                suggestionsCreated
            };

            await runRef.update({
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                ...result
            });

            console.log(`[Discovery] Job completed. Created ${topicsCreated}, Updated ${topicsUpdated}, Suggestions ${suggestionsCreated}`);
            return result;

        } catch (error: any) {
            console.error('[Discovery] Job failed:', error);
            await runRef.update({
                status: 'failed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                error: error.message
            });
            throw error;
        }
    },

    async fetchClustersFromWorker(sampleSize: number): Promise<WorkerCluster[]> {
        const response = await fetch(`${config.workerUrl}/discover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sampleSize })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Worker error ${response.status}: ${text}`);
        }

        const data = await response.json() as any;
        // Assume worker parses structure as { suggestions: WorkerCluster[] }
        return data.suggestions || [];
    },

    generateSlug(name: string): string {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }
};
