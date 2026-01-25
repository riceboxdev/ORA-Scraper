import { db } from '../firebase.js';

async function resetEmbeddings() {
    console.log('[Reset] Finding posts with status "vertex-v1"...');

    // Get all posts with vertex-v1 status
    const snapshot = await db.collection('userPosts')
        .where('embeddingStatus', '==', 'vertex-v1')
        .limit(500) // Process in chunks just in case
        .get();

    if (snapshot.empty) {
        console.log('[Reset] No posts found with status "vertex-v1".');
        return;
    }

    console.log(`[Reset] Found ${snapshot.size} posts to reset.`);

    const batch = db.batch();
    let count = 0;

    for (const doc of snapshot.docs) {
        // Reset status to pending so the background worker picks it up
        // Or if the user just wants to mark them as completed without re-embedding if they worked?
        // User said: "re embed them and change statuses to complete"
        // So we set to 'pending'.
        batch.update(doc.ref, {
            embeddingStatus: 'pending',
            embeddingError: null, // Clear any errors
            updatedAt: new Date()
        });
        count++;
    }

    await batch.commit();
    console.log(`[Reset] Successfully reset ${count} posts to 'pending'.`);
    console.log('[Reset] Run this script again if there are more posts.');
}

resetEmbeddings()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
