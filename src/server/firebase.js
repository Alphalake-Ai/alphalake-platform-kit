const path = require('path');

// Builds the Firebase credential. Prefer a service-account JSON file when one is
// configured: systemd's EnvironmentFile parser eats backslash escapes, so a
// \n-escaped private key cannot be stored there intact. Falls back to discrete
// env vars for environments where that is safe (local dev, Cloud Run secrets).
function buildFirebaseCredential(admin, env = process.env) {
  const file = env.FIREBASE_SERVICE_ACCOUNT_FILE;
  if (file) {
    return admin.credential.cert(require(path.resolve(file)));
  }
  return admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  });
}

// Lazily initialised firebase-admin app — only touched by callers that actually
// use central auth, so apps running in local-auth mode never need credentials.
let _firebaseApp = null;
function getFirebaseAuth(env = process.env) {
  if (!_firebaseApp) {
    const admin = require('firebase-admin');
    _firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: buildFirebaseCredential(admin, env) });
  }
  return _firebaseApp.auth();
}

module.exports = { buildFirebaseCredential, getFirebaseAuth };
