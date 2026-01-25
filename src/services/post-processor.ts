
import { db } from '../firebase.js';
import { embeddingService } from './embedding.js';
import admin from 'firebase-admin';

/**
 * Background worker to process pending embeddings
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
                await this.processPendingEmbeddings();
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

    async processPendingEmbeddings() {
        // Query for pending posts
        const snapshot = await db.collection('userPosts')
            .where('embeddingStatus', '==', 'pending')
            .limit(20)
            .get();

        if (snapshot.empty) return;

        console.log(`[Processor] Processing ${snapshot.size} pending embeddings...`);

        for (const doc of snapshot.docs) {
            const post = doc.data();
            const imageUrl = post.content?.jpegUrl || post.content?.url;

            if (!imageUrl) {
                await doc.ref.update({ embeddingStatus: 'failed' });
                continue;
            }

            try {
                const embedding = await embeddingService.generateEmbedding(
                    post.description || undefined,
                    imageUrl
                );

                if (embedding) {
                    await doc.ref.update({
                        embedding: (admin.firestore as any).VectorValue.create(embedding),
                        embeddingStatus: 'vertex-v1', // Using our new version tag
                        embeddingModel: 'vertex-ai-multimodal-001',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    await doc.ref.update({ embeddingStatus: 'failed' });
                }
            } catch (error) {
                console.error(`[Processor] Failed to process post ${doc.id}:`, error);
                // Keep status as pending to retry later or mark as failed
            }
        }
    }
};
