import { db } from '../firebase.js';
import { embeddingService } from '../services/embedding.js';
import admin from 'firebase-admin';
import * as firestoreModule from 'firebase-admin/firestore';

const getVectorValueClass = () => {
    try {
        if ((firestoreModule as any).VectorValue) return (firestoreModule as any).VectorValue;
        if ((firestoreModule as any).default?.VectorValue) return (firestoreModule as any).default.VectorValue;
        if ((admin.firestore as any).VectorValue) return (admin.firestore as any).VectorValue;
    } catch (e) {
        console.warn('[Backfill] Failed to resolve VectorValue class:', e);
    }
    return null;
};

const VectorValueClass = getVectorValueClass();

const toVectorValue = (arr: number[]) => {
    if ((firestoreModule as any).FieldValue?.vector) return (firestoreModule as any).FieldValue.vector(arr);
    if (VectorValueClass && typeof VectorValueClass.create === 'function') return VectorValueClass.create(arr);
    if (VectorValueClass) {
        try { return new (VectorValueClass as any)(arr); } catch (e) { }
    }
    return arr;
};

async function backfillTopics() {
    console.log('[Backfill] Starting backfill for topic embeddings...');

    const snapshot = await db.collection('categories').get();
    console.log(`[Backfill] Found ${snapshot.size} categories total.`);

    let count = 0;
    let failed = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.centroidEmbedding) {
            skipped++;
            continue;
        }

        console.log(`[Backfill] Processing '${data.name}' (${doc.id})...`);

        // Construct text to embed: Name + Description + Tags
        let text = data.name;
        if (data.description) text += `: ${data.description}`;

        try {
            // Wait 1s to behave nicely with rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));

            const embedding = await embeddingService.generateEmbedding(text);

            if (embedding && embedding.length > 0) {
                await doc.ref.update({
                    centroidEmbedding: toVectorValue(embedding),
                    embeddingUpdatedAt: new Date()
                });
                console.log(`   - Saved embedding for '${data.name}'.`);
                count++;
            } else {
                console.warn(`   - Failed directly generating embedding for '${data.name}'.`);
                failed++;
            }
        } catch (e) {
            console.error(`   - Error processing '${data.name}':`, e);
            failed++;
        }
    }

    console.log('--- Summary ---');
    console.log(`Updated: ${count}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
}

backfillTopics()
    .then(() => process.exit(0))
    .catch(console.error);
