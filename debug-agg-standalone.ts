
import admin from 'firebase-admin';
import fs from 'fs';

// Initialize independently to avoid src/firebase.ts logic
if (!admin.apps.length) {
    try {
        const credPath = './firebase-credentials.json';
        if (fs.existsSync(credPath)) {
            const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase initialized successfully.');
        } else {
            console.error('Credentials file not found at ./firebase-credentials.json');
            process.exit(1);
        }
    } catch (e) {
        console.error('Init failed:', e);
        process.exit(1);
    }
}

const db = admin.firestore();

async function testAggregation() {
    try {
        console.log('Testing aggregation...');
        console.log('Admin SDK Version:', admin.SDK_VERSION);

        const coll = db.collection('userPosts');
        // Count works?
        const snapshot = await coll.count().get();
        console.log('Count:', snapshot.data().count);

        // Check AggregateField
        if (!admin.firestore.AggregateField) {
            console.error('admin.firestore.AggregateField is UNDEFINED. Current version might be too old?');
            return;
        }

        console.log('Attempting aggregation...');
        const aggSnapshot = await coll.aggregate({
            totalLikes: admin.firestore.AggregateField.sum('likeCount'),
            totalSaves: admin.firestore.AggregateField.sum('saveCount'),
            totalViews: admin.firestore.AggregateField.sum('viewCount'),
        }).get();

        console.log('Aggregation result:', aggSnapshot.data());

    } catch (e) {
        console.error('Test failed:', e);
    }
}

testAggregation();
