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

    async startWorker() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[Processor] Embedding worker started.');

        // Loop indefinitely with a delay
        while (this.isRunning) {
            try {
                await this.processWorkBatch();
            } catch (error) {
                console.error('[Processor] Worker error:', error);
            }
            // Wait 30 seconds between rounds
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    },

    stopWorker() {
        this.isRunning = false;
        console.log('[Processor] Embedding worker stopping...');
    },

    async processWorkBatch() {
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

        if (docs.length === 0) return;

        console.log(`[Processor] Processing ${docs.length} embeddings (${pendingSnap.size} new, ${migratingSnap.size} migration)...`);

        for (const doc of docs) {
            const post = doc.data();
            const imageUrl = post.content?.jpegUrl || post.content?.url;

            if (!imageUrl) {
                await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
                continue;
            }

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
            } catch (error) {
                console.error(`[Processor] Failed to process post ${doc.id}:`, error);
                // Mark as failed for now to prevent infinite loops, can be reset manually if needed
                await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
            }
        }
    }
};
