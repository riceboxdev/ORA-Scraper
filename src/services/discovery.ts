import { db } from '../firebase.js';
import { config } from '../config.js';
import admin from 'firebase-admin';
import * as firestoreModule from 'firebase-admin/firestore';

const getVectorValueClass = () => {
    try {
        if ((firestoreModule as any).VectorValue) return (firestoreModule as any).VectorValue;
        if ((firestoreModule as any).default?.VectorValue) return (firestoreModule as any).default.VectorValue;
        if ((admin.firestore as any).VectorValue) return (admin.firestore as any).VectorValue;
    } catch (e) {
        console.warn('[Discovery] Failed to resolve VectorValue class:', e);
    }
    return null;
};

const VectorValueClass = getVectorValueClass();

/**
 * Ultra-robust vector converter
 */
const toVectorValue = (arr: number[]) => {
    if ((firestoreModule as any).FieldValue?.vector) return (firestoreModule as any).FieldValue.vector(arr);
    if (VectorValueClass && typeof VectorValueClass.create === 'function') return VectorValueClass.create(arr);
    if (VectorValueClass) {
        try { return new (VectorValueClass as any)(arr); } catch (e) { }
    }
    return arr;
};
import type { Category, DiscoveryRun } from '../types.js';
import { embeddingService } from './embedding.js';
import { aiService } from './ai.js';

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
     * Run the hybrid discovery process:
     * 1. Node.js picks seeds
     * 2. Worker computes vectors
     * 3. Node.js validates & calls AI for naming
     */
    async runDiscoveryJob(sampleSize: number = 20): Promise<DiscoveryResult> {
        console.log(`[Discovery] Starting Hybrid Job (Seeds: ${sampleSize})...`);
        const runId = `run-${Date.now()}`;

        let topicsFound = 0;
        let topicsCreated = 0;

        try {
            // 1. Pick Seeds (Backlog Draining)
            // Filter specifically for the new Vertex AI embeddings to avoid dimension mismatch
            const snapshot = await db.collection('userPosts')
                .where('embeddingStatus', '==', 'vertex-v1')
                .orderBy('createdAt', 'desc')
                .limit(300)
                .get();

            const allDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));

            const candidates = allDocs.filter(p => {
                const hasTopic = !!p.topicId;

                // Handle Firestore VectorValue object (SDK specific)
                // It might look like { _values: [...] } or just exist as an object
                let vector = p.embedding;
                if (vector && typeof vector === 'object' && !Array.isArray(vector) && vector._values) {
                    vector = vector._values;
                }

                const hasEmbedding = vector && Array.isArray(vector) && vector.length > 0;

                // Normalize for downstream use
                if (hasEmbedding && !Array.isArray(p.embedding)) {
                    p.embedding = vector;
                }

                return !hasTopic && hasEmbedding;
            });

            console.log(`[Discovery] Scanned ${allDocs.length} recent posts. Found ${candidates.length} valid untagged candidates.`);

            // DEBUG: Inspect the first few rejected posts to see WHY
            if (candidates.length === 0 && allDocs.length > 0) {
                const sample = allDocs.slice(0, 3);
                console.log('[Discovery] DEBUG: Inspecting first 3 posts:');
                sample.forEach(p => {
                    console.log(`- ID: ${p.id}`);
                    console.log(`  topicId: ${p.topicId} (${typeof p.topicId})`);
                    console.log(`  embedding exists: ${!!p.embedding}`);
                    console.log(`  embedding isArray: ${Array.isArray(p.embedding)}`);
                    console.log(`  embedding length: ${p.embedding?.length}`);
                    if (p.embedding && !Array.isArray(p.embedding)) {
                        console.log(`  embedding structure: ${JSON.stringify(p.embedding).slice(0, 100)}...`);
                    }
                });
            }

            if (candidates.length === 0) {
                console.log('[Discovery] No untagged candidates found. (Tips: Check if posts have embeddings, or if they are already tagged)');
                return { runId, topicsFound: 0, topicsCreated: 0, topicsUpdated: 0, suggestionsCreated: 0 };
            }

            // Pick random seeds (CAP at 10 to avoid timeouts)
            const MAX_SEEDS = 10;
            const seeds = candidates.sort(() => 0.5 - Math.random()).slice(0, Math.min(sampleSize, MAX_SEEDS));
            console.log(`[Discovery] Selected ${seeds.length} seeds (Capped at ${MAX_SEEDS} per run).`);

            for (let i = 0; i < seeds.length; i++) {
                const seed = seeds[i];
                console.log(`[Discovery] Processing seed ${i + 1}/${seeds.length} (${seed.id})...`);

                // Throttle between AI calls to respect overall quota
                await new Promise(resolve => setTimeout(resolve, 1000));

                try {
                    // 2. Vector Search (Firestore Native)
                    console.log(`[Discovery] Searching for neighbors via Firestore findNearest...`);

                    // We need a VectorValue for the query
                    // Ensure we have a valid vector
                    const vectorArray = seed.embedding;
                    if (!vectorArray || vectorArray.length === 0) {
                        console.log('   -> Skipping: Seed has no embedding.');
                        continue;
                    }

                    const vectorValue = toVectorValue(vectorArray);

                    // Note: distanceThreshold may not be in all @types versions yet, casting to any if needed
                    const queryOptions: any = {
                        limit: 20,
                        distanceMeasure: 'COSINE',
                        distanceThreshold: 0.55
                    };

                    const neighborsSnaps = await (db.collection('userPosts') as any)
                        .findNearest('embedding', vectorValue, queryOptions)
                        .get();

                    const neighbors = neighborsSnaps.docs.map((d: any) => ({
                        id: d.id,
                        ...d.data()
                    })) as any[];

                    console.log(`   - Found ${neighbors.length} neighbors via Firestore.`);

                    if (neighbors.length < 3) {
                        console.log('   -> Skipping: Not enough close neighbors.');
                        continue;
                    }

                    // 3. Analyze Tags
                    const tagCounts: Record<string, number> = {};
                    neighbors.forEach(p => {
                        if (Array.isArray(p.tags)) {
                            p.tags.forEach((t: string) => {
                                const tag = t.toLowerCase().trim();
                                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                            });
                        }
                    });

                    const topTags = Object.entries(tagCounts)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 5)
                        .map(([tag]) => tag)
                        .join(', ');

                    // 4. Call Worker for Naming (AI Only)
                    console.log(`   - Requesting AI naming for cluster...`);
                    const context = neighbors.slice(0, 8)
                        .map(p => `- ${p.description || 'No desc'} [Tags: ${p.tags?.join(', ')}]`)
                        .join('\n');

                    const namingResult = await aiService.generateTopicFromCluster(context, topTags);

                    if (namingResult && namingResult.ideas && namingResult.ideas.length > 0) {
                        const idea = namingResult.ideas[0];
                        topicsFound++;

                        // 5. Persist Topic
                        const slug = this.generateSlug(idea.name);
                        const existing = await db.collection(CATEGORIES_COLLECTION).where('slug', '==', slug).limit(1).get();

                        let topicId;

                        if (!existing.empty) {
                            topicId = existing.docs[0].id;
                            await existing.docs[0].ref.update({
                                lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
                                confidence: idea.confidence
                            });
                        } else {
                            const newRef = await db.collection(CATEGORIES_COLLECTION).add({
                                name: idea.name,
                                slug,
                                description: idea.description,
                                color: idea.suggestedColor,
                                iconName: idea.suggestedIcon,
                                thumbnailUrls: neighbors.slice(0, 3).map(p => p.content?.jpegUrl || p.content?.url).filter(Boolean),
                                status: idea.confidence > 0.85 ? 'active' : 'emerging', // Make them visible immediately if confident
                                postCount: neighbors.length, // Give them an initial count so they aren't at the bottom
                                isSystemGenerated: true,
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                            topicId = newRef.id;
                            topicsCreated++;
                        }

                        // 6. Tag Posts
                        if (topicId) {
                            const batch = db.batch();
                            neighborsSnaps.docs.forEach((doc: any) => {
                                batch.update(doc.ref, { topicId });
                            });
                            await batch.commit();
                            console.log(`   - Tagged ${neighborsSnaps.docs.length} posts for topic: ${idea.name}`);
                        }
                    }

                } catch (err) {
                    console.error(`[Discovery] Error processing seed ${seed.id}:`, err);
                }
            }

            return {
                runId,
                topicsFound,
                topicsCreated,
                topicsUpdated: 0,
                suggestionsCreated: 0
            };

        } catch (error: any) {
            console.error('[Discovery] Job failed:', error);
            throw error;
        }
    },

    generateSlug(name: string): string {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }
};
