import firebaseAdmin from 'firebase-admin';

try {
	const projectId = process.env.FIREBASE_PROJECT_ID;
	const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
	let privateKey = process.env.FIREBASE_PRIVATE_KEY;
	if (privateKey) privateKey = privateKey.replace(/\\n/g, '\n');

	if (!projectId || !clientEmail || !privateKey) {
		throw new Error('Missing Firebase Admin credentials in environment variables.');
	}

	if (!firebaseAdmin.apps.length) {
		firebaseAdmin.initializeApp({
			credential: firebaseAdmin.credential.cert({
				projectId,
				clientEmail,
				privateKey,
			}),
		});
	}
	console.log('Firebase: Initialized successfully');
} catch (error: any) {
	console.error('Firebase initialization error:', error?.message || error);
	process.exit(1);
}

export const auth = firebaseAdmin.auth();