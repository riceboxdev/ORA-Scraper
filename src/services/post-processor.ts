import { db } from '../firebase.js';
import { embeddingService } from './embedding.js';
import admin from 'firebase-admin';
import * as firestoreModule from 'firebase-admin/firestore';

const getVectorValueClass = () => {
    try {
        if ((firestoreModule as any).VectorValue) return (firestoreModule as any).VectorValue;
        if ((firestoreModule as any).default?.VectorValue) return (firestoreModule as any).default.VectorValue;
        if ((admin.firestore as any).VectorValue) return (admin.firestore as any).VectorValue;
    } catch (e) { }
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

/**
 * Background worker to process pending embeddings and migrate older ones
 */
export const postProcessingService = {
    isRunning: false,
    currentCooldown: 30000, // Start at 30s

    async startWorker() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[Processor] Embedding worker started.');

        // Loop indefinitely with a delay
        while (this.isRunning) {
            try {
                const hadQuotaError = await this.processWorkBatch();

                // If we hit quota, increase cooldown exponentially
                if (hadQuotaError) {
                    this.currentCooldown = Math.min(this.currentCooldown * 3, 600000); // Max 10 mins
                    console.log(`[Processor] Quota hit. Increasing cooldown to ${this.currentCooldown / 1000}s`);
                } else {
                    // Slowly decrease cooldown on success back to 30s
                    this.currentCooldown = Math.max(30000, this.currentCooldown - 30000);
                }
            } catch (error) {
                console.error('[Processor] Worker error:', error);
            }

            // Wait with current cooldown
            await new Promise(resolve => setTimeout(resolve, this.currentCooldown));
        }
    },

    stopWorker() {
        this.isRunning = false;
        console.log('[Processor] Embedding worker stopping...');
    },

    async processWorkBatch(): Promise<boolean> {
        // Interleave processing: 10 new (pending), 10 old (migrating)
        const pendingSnap = await db.collection('userPosts')
            .where('embeddingStatus', '==', 'pending')
            .limit(10)
            .get();

        const migratingSnap = await db.collection('userPosts')
            .where('embeddingStatus', 'not-in', ['vertex-v1', 'pending', 'vertex-v1-failed'])
            .limit(pendingSnap.empty ? 20 : 10)
            .get();

        const docs = [...pendingSnap.docs, ...migratingSnap.docs];

        if (docs.length === 0) return false;

        console.log(`[Processor] Processing ${docs.length} embeddings (${pendingSnap.size} new, ${migratingSnap.size} migration)...`);

        for (const doc of docs) {
            const post = doc.data();
            const imageUrl = post.content?.jpegUrl || post.content?.url;

            if (!imageUrl) {
                await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
                continue;
            }

            // Small throttle between requests (1000ms) to stay safely under 120 RPM limit
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                const embedding = await embeddingService.generateEmbedding(
                    post.description || undefined,
                    imageUrl
                );

                if (embedding) {
                    const vector = toVectorValue(embedding);
                    await doc.ref.update({
                        embedding: vector,
                        embeddingStatus: 'vertex-v1',
                        embeddingModel: 'vertex-ai-multimodal-001',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
                }
            } catch (error: any) {
                // Specific check for Vertex AI Quota / Resource Exhausted
                if (error.message?.includes('RESOURCE_EXHAUSTED') || error.code === 8) {
                    console.warn(`[Processor] Resource exhausted for post ${doc.id}. Stopping batch.`);
                    return true; // Signal quota hit
                }

                console.error(`[Processor] Failed to process post ${doc.id}:`, error);
                await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
            }
        }
        return false;
    }
};
