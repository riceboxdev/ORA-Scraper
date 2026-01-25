import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load service account directly since we are running as a script
const serviceAccountPath = join(process.cwd(), 'firebase-credentials.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function migrateTopics() {
    console.log('Starting migration: Backfilling topic status...');

    const snapshot = await db.collection('categories').get();
    let updatedCount = 0;

    // Process in chunks of 500
    const batchSize = 450;
    const chunks = [];

    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        chunks.push(snapshot.docs.slice(i, i + batchSize));
    }

    for (const chunk of chunks) {
        const batch = db.batch();

        for (const doc of chunk) {
            const data = doc.data();
            if (!data.status) {
                batch.update(doc.ref, {
                    status: 'active',
                    lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            await batch.commit();
        }
    }

    console.log(`Migration complete. Updated ${updatedCount} topics to 'active'.`);
    process.exit(0);
}

migrateTopics().catch(console.error);
