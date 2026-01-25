import { db } from '../firebase.js';
import admin from 'firebase-admin';

async function cleanupDeletedTopics() {
    console.log('[Cleanup] Starting cleanup of posts with deleted topics...');

    // 1. Get all valid category IDs
    console.log('[Cleanup] Fetching valid categories...');
    const categoriesSnapshot = await db.collection('categories').select('name').get(); // Only need ID, but selecting name is cheap
    const validTopicIds = new Set(categoriesSnapshot.docs.map(d => d.id));
    console.log(`[Cleanup] Found ${validTopicIds.size} valid topics.`);

    // 2. Scan posts with a topicId
    // Note: If we have millions of posts, we should use a cursor. 
    // For now, we'll fetch in batches of 500 where topicId != null (if possible) or just all posts.
    // Querying where('topicId', '!=', null) requires an index.
    // Querying orderBy('topicId') implies non-null.

    console.log('[Cleanup] Scanning posts...');

    // We'll iterate through all posts that have a topicId.
    // To do this efficiently without a perfect index, we might just have to scan recent posts or specific ones.
    // BUT we added an index for (topicId ASC, createdAt DESC). So we can order by topicId.

    let processed = 0;
    let cleaned = 0;
    let lastDoc = null;

    while (true) {
        let query = db.collection('userPosts')
            .orderBy('topicId') // This filters out docs where topicId is missing/null
            .limit(500);

        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = db.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const topicId = data.topicId;

            if (topicId && !validTopicIds.has(topicId)) {
                // Topic does not exist anymore
                batch.update(doc.ref, {
                    topicId: admin.firestore.FieldValue.delete(),
                    topicConfidence: admin.firestore.FieldValue.delete()
                });
                batchCount++;
                cleaned++;
                process.stdout.write(`\r[Cleanup] Cleaned post ${doc.id} (topic: ${topicId})`);
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        processed += snapshot.size;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        if (processed % 1000 === 0) {
            console.log(`\n[Cleanup] Processed ${processed} posts...`);
        }
    }

    console.log('\n[Cleanup] Finished.');
    console.log(`Total Processed: ${processed}`);
    console.log(`Total Cleaned: ${cleaned}`);
}

cleanupDeletedTopics()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
