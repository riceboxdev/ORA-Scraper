
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import admin from 'firebase-admin';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Initialize Firebase Admin
if (!admin.apps.length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            credential = admin.credential.cert(serviceAccount);
        } catch (error) {
            console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:', error);
            process.exit(1);
        }
    } else {
        console.error('FIREBASE_SERVICE_ACCOUNT_JSON is missing');
        process.exit(1);
    }

    admin.initializeApp({
        credential,
        projectId: process.env.FIREBASE_PROJECT_ID
    });
}

const auth = admin.auth();

async function setAdmin(email: string) {
    try {
        console.log(`Looking up user: ${email}`);
        const user = await auth.getUserByEmail(email);

        console.log(`Setting admin claim for user: ${user.uid}`);
        await auth.setCustomUserClaims(user.uid, { admin: true });

        console.log(`✅ Successfully granted admin privileges to ${email}`);
        console.log('NOTE: The user must sign out and sign back in for changes to take effect.');

        process.exit(0);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            console.error(`❌ User with email ${email} not found.`);
        } else {
            console.error('❌ Failed to set admin claim:', error);
        }
        process.exit(1);
    }
}

const email = process.argv[2];
if (!email) {
    console.error('Usage: tsx scripts/set-admin.ts <email>');
    process.exit(1);
}

setAdmin(email);
