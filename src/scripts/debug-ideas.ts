import { db } from '../firebase.js';

async function debugIdeas() {
    console.log('[Debug] Checking Categories (Topics)...');

    const snapshot = await db.collection('categories').get();
    console.log(`[Debug] Total Categories: ${snapshot.size}`);

    let activeCount = 0;
    let withEmbeddingCount = 0;
    let activeWithEmbeddingCount = 0;

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const isActive = data.status === 'active';
        const hasEmbedding = !!data.centroidEmbedding;

        if (isActive) activeCount++;
        if (hasEmbedding) withEmbeddingCount++;
        if (isActive && hasEmbedding) activeWithEmbeddingCount++;

        // Print sample of problem docs
        if (activeCount <= 5 && isActive && !hasEmbedding) {
            console.log(`[Warn] Active category '${data.name}' (${doc.id}) missing embedding.`);
        }
    });

    console.log(`[Debug] Active: ${activeCount}`);
    console.log(`[Debug] With Embedding: ${withEmbeddingCount}`);
    console.log(`[Debug] Active + With Embedding: ${activeWithEmbeddingCount}`);

    if (activeWithEmbeddingCount === 0) {
        console.error('[Error] No active categories have embeddings! "Ideas for You" will fail.');
    } else {
        console.log('[Info] Metadata looks okay. Issue might be with user interests or thresholds.');
    }
}

debugIdeas()
    .then(() => process.exit(0))
    .catch(console.error);
