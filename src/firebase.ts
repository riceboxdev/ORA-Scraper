/**
 * Firebase Admin SDK initialization
 */

import admin from 'firebase-admin';
import { config } from './config.js';

// Initialize Firebase Admin with application default credentials
// In Docker, this uses GOOGLE_APPLICATION_CREDENTIALS env var
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: config.firebaseProjectId,
        storageBucket: `${config.firebaseProjectId}.firebasestorage.app`,
    });
}

export const db = admin.firestore();
export const storage = admin.storage();
export const auth = admin.auth();

// System curator account ID
export const SYSTEM_AUTHOR_ID = 'ora-curator';

/**
 * Ensure the system curator account exists in Firestore
 */
export async function ensureSystemAccount(): Promise<void> {
    const profileRef = db.collection('userProfiles').doc(SYSTEM_AUTHOR_ID);
    const doc = await profileRef.get();

    if (!doc.exists) {
        console.log('Creating system curator account...');
        await profileRef.set({
            id: SYSTEM_AUTHOR_ID,
            displayName: 'ORA Curator',
            username: 'ora-curator',
            bio: 'Curated inspiration from around the web',
            isSystemAccount: true,
            postCount: 0,
            followerCount: 0,
            followingCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log('System curator account created');
    }
}

export default { db, storage, auth, SYSTEM_AUTHOR_ID, ensureSystemAccount };
