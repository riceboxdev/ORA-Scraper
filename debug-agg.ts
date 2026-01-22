
import { db } from './src/firebase.js';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env vars manually
dotenv.config();

// Fix credential loading for manual script execution
if (!admin.apps.length) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-credentials.json';
    console.log('Loading credentials from:', credPath);

    if (fs.existsSync(credPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID || 'angles-423a4'
        });
    } else {
        console.error('Credentials file not found!');
        process.exit(1);
    }
}

async function testAggregation() {
    try {
        console.log('Testing aggregation...');
        console.log('Admin SDK Version:', admin.SDK_VERSION);

        // Check if userPosts collection exists and has data
        const coll = db.collection('userPosts');
        const snapshot = await coll.count().get();
        console.log('Count:', snapshot.data().count);

        if (snapshot.data().count === 0) {
            console.log('Collection is empty, aggregation might return 0s.');
        }

        if (!admin.firestore.AggregateField) {
            console.error('admin.firestore.AggregateField is UNDEFINED');
            console.log('Available keys on admin.firestore:', Object.keys(admin.firestore));
            return;
        } else {
            console.log('admin.firestore.AggregateField is defined');
        }

        console.log('Attempting sum aggregation...');
        try {
            const aggSnapshot = await coll.aggregate({
                totalLikes: admin.firestore.AggregateField.sum('likeCount'),
                totalSaves: admin.firestore.AggregateField.sum('saveCount'),
                totalViews: admin.firestore.AggregateField.sum('viewCount'),
            }).get();

            console.log('Aggregation result:', aggSnapshot.data());
        } catch (aggError) {
            console.error('Original aggregation failed:', aggError);
        }

    } catch (e) {
        console.error('Test failed:', e);
    }
}

testAggregation();
