
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
            // Relaxed Query: fetch recent posts regardless of status, then filter for embeddings
            const snapshot = await db.collection('userPosts')
                .orderBy('createdAt', 'desc')
                .limit(300) // Bumped to 300 to find more potential seeds
                .get();

            const allDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));

            const candidates = allDocs.filter(p => {
                const hasTopic = !!p.topicId;
                const hasEmbedding = p.embedding && Array.isArray(p.embedding) && p.embedding.length > 0;
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

            // Pick random seeds
            const seeds = candidates.sort(() => 0.5 - Math.random()).slice(0, sampleSize);
            console.log(`[Discovery] Selected ${seeds.length} seeds.`);

            for (const seed of seeds) {
                try {
                    // 2. Call Worker for Vector Search
                    const neighbors = await this.workerVectorSearch(seed.embedding);

                    // Filter locally
                    const validNeighbors = neighbors.filter(n => n.score > 0.55);
                    if (validNeighbors.length < 3) continue;

                    // 3. Get neighbor post details
                    const neighborIds = validNeighbors.map(n => n.id);
                    // Fetch neighbors (chunked if needed, but <20 is fine)
                    if (neighborIds.length === 0) continue;

                    const neighborsSnaps = await db.collection('userPosts')
                        .where(admin.firestore.FieldPath.documentId(), 'in', neighborIds)
                        .get();

                    const neighborPosts = neighborsSnaps.docs.map(d => d.data());

                    // 4. Analyze Tags
                    const tagCounts: Record<string, number> = {};
                    neighborPosts.forEach(p => {
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

                    // 5. Call Worker for Naming
                    const context = neighborPosts.slice(0, 8)
                        .map(p => `- ${p.description || 'No desc'} [Tags: ${p.tags?.join(', ')}]`)
                        .join('\n');

                    const namingResult = await this.workerGenerateName(context, topTags);

                    if (namingResult && namingResult.ideas && namingResult.ideas.length > 0) {
                        const idea = namingResult.ideas[0];
                        topicsFound++;

                        // 6. Persist Topic
                        // Check dedupe by slug
                        const slug = this.generateSlug(idea.name);
                        const existing = await db.collection(CATEGORIES_COLLECTION).where('slug', '==', slug).limit(1).get();

                        let topicId;

                        if (!existing.empty) {
                            // Update existng
                            topicId = existing.docs[0].id;
                            await existing.docs[0].ref.update({
                                lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
                                confidence: idea.confidence
                            });
                        } else {
                            // Create New
                            const newRef = await db.collection(CATEGORIES_COLLECTION).add({
                                name: idea.name,
                                slug,
                                description: idea.description,
                                color: idea.suggestedColor,
                                iconName: idea.suggestedIcon,
                                matchingTags: topTags.split(', '),
                                confidence: idea.confidence,
                                thumbnailUrls: neighborPosts.slice(0, 3).map(p => p.content?.jpegUrl || p.content?.url).filter(Boolean),
                                status: idea.confidence > 0.85 ? 'emerging' : 'suggestion',
                                isSystemGenerated: true,
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                            topicId = newRef.id;
                            topicsCreated++;
                        }

                        // 7. Tag Posts
                        if (topicId) {
                            const batch = db.batch();
                            neighborsSnaps.docs.forEach(doc => {
                                batch.update(doc.ref, { topicId });
                            });
                            await batch.commit();
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

    // Worker Wrappers
    async workerVectorSearch(vector: number[]): Promise<{ id: string; score: number }[]> {
        const response = await fetch(`${config.workerUrl}/vector/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vector, limit: 20 })
        });
        const json = await response.json() as any;
        return json.success ? json.data.matches : [];
    },

    async workerGenerateName(context: string, keywords: string): Promise<any> {
        const response = await fetch(`${config.workerUrl}/ai/generate-name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, keywords })
        });
        const json = await response.json() as any;
        return json.success ? json.data : null;
    },

    generateSlug(name: string): string {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }
};
