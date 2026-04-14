/**
 * Baby Tracker — Firebase Configuration
 * ──────────────────────────────────────
 * Fill in the values below to enable cross-device sharing and sync.
 * Leave them empty ("") to run in local-only mode (no sharing).
 *
 * SETUP STEPS:
 *  1. Go to https://console.firebase.google.com and create a project.
 *  2. Add a Web app (</> icon) — copy the config here.
 *  3. In the left sidebar: Build → Firestore Database → Create database
 *     Choose "Start in test mode" (or use the rules below).
 *  4. In Firestore → Rules, paste and publish:
 *
 *     rules_version = '2';
 *     service cloud.firestore {
 *       match /databases/{database}/documents {
 *         // Access is controlled by knowledge of the random baby token.
 *         // Tokens are 128-bit random values — unguessable without the link.
 *         match /babies/{babyId}/{document=**} {
 *           allow read, write: if true;
 *         }
 *       }
 *     }
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCnrGE__MgycGuGl1g8f3k8dZe2CzCRklw",
  authDomain: "babyrepo-984e8.firebaseapp.com",
  projectId: "babyrepo-984e8",
  storageBucket: "babyrepo-984e8.firebasestorage.app",
  messagingSenderId: "985910728334",
  appId: "1:985910728334:web:6e1f80a1222b7a02519bdf"
};
