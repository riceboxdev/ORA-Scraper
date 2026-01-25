import { db } from '../firebase.js';
import { embeddingService } from '../services/embedding.js';
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

async function migrate() {
    console.log('[Migration] Starting re-embedding process with Vertex AI...');

    // Get all posts that don't have vertex-v1 status
    const snapshot = await db.collection('userPosts')
        .where('embeddingStatus', '!=', 'vertex-v1')
        .limit(100) // Process in chunks
        .get();

    console.log(`[Migration] Found ${snapshot.size} posts to process in this chunk.`);

    for (const doc of snapshot.docs) {
        const post = doc.data();
        const imageUrl = post.content?.jpegUrl || post.content?.url;

        if (!imageUrl) {
            console.log(`[Migration] Skipping post ${doc.id}: No image URL.`);
            await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
            continue;
        }

        console.log(`[Migration] Processing post ${doc.id}...`);

        try {
            // Generate new embedding using Vertex AI
            const embedding = await embeddingService.generateEmbedding(
                post.description || undefined,
                imageUrl
            );

            if (embedding) {
                const vector = toVectorValue(embedding);
                // Update post with new embedding and status
                await doc.ref.update({
                    embedding: vector,
                    embeddingStatus: 'vertex-v1',
                    embeddingModel: 'vertex-ai-multimodal-001',
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`   - Successfully re-embedded.`);
            } else {
                console.log(`   - Failed to generate embedding.`);
                await doc.ref.update({ embeddingStatus: 'vertex-v1-failed' });
            }
        } catch (error) {
            console.error(`   - Error:`, error);
        }
    }

    console.log('[Migration] Chunk complete.');
}

migrate()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
