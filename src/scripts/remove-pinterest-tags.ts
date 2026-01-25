import { db } from '../firebase.js';
import admin from 'firebase-admin';

async function removePinterestTags() {
    console.log('[Maintenance] Starting removal of "pinterest" tags...');

    try {
        // Query for posts containing "pinterest" in tags
        const snapshot = await db.collection('userPosts')
            .where('tags', 'array-contains', 'pinterest')
            .get();

        if (snapshot.empty) {
            console.log('[Maintenance] No posts found with "pinterest" tag.');
            return;
        }

        console.log(`[Maintenance] Found ${snapshot.size} posts to update.`);

        const batchSize = 500;
        let batch = db.batch();
        let count = 0;
        let totalUpdated = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const currentTags = data.tags || [];

            // Filter out 'pinterest' (case-insensitive just in case)
            const newTags = currentTags.filter((tag: string) => tag.toLowerCase() !== 'pinterest');

            batch.update(doc.ref, {
                tags: newTags,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            count++;
            totalUpdated++;

            // Commit batch every batchSize documents
            if (count >= batchSize) {
                await batch.commit();
                console.log(`[Maintenance] Committed batch of ${count} updates. Total so far: ${totalUpdated}`);
                batch = db.batch();
                count = 0;
            }
        }

        // Final batch commit
        if (count > 0) {
            await batch.commit();
            console.log(`[Maintenance] Committed final batch of ${count} updates.`);
        }

        console.log(`[Maintenance] Cleanup complete. Total posts updated: ${totalUpdated}`);
    } catch (error) {
        console.error('[Maintenance] Error during cleanup:', error);
    }
}

removePinterestTags()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
