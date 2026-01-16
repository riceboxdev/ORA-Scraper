/**
 * Firebase Admin SDK initialization
 */

import admin from 'firebase-admin';
import { Auth } from 'firebase-admin/auth';
import { Storage } from 'firebase-admin/storage';
import { Firestore } from 'firebase-admin/firestore';
import { config } from './config.js';

// Initialize Firebase Admin
if (!admin.apps.length) {
    let credential;

    // Check for raw JSON in env (e.g. from Dokploy)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            credential = admin.credential.cert(serviceAccount);
        } catch (error) {
            console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:', error);
        }
    }

    admin.initializeApp({
        credential,
        projectId: config.firebaseProjectId,
        storageBucket: `${config.firebaseProjectId}.firebasestorage.app`,
    });
}

export const db: Firestore = admin.firestore();
export const storage: Storage = admin.storage();
export const auth: Auth = admin.auth();

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
