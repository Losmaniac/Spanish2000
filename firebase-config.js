/* ============================================================
   FIREBASE CONFIGURATION  —  project spanish2000-91271
   ============================================================
   This file contains PUBLIC Firebase identifiers.
   They are not secrets — Google itself treats them as public.
   The real protection is:
     • Firestore Security Rules  (see firestore.rules, already deployed)
     • the authorised-domains list (Authentication → Authorized domains)

   2 MANUAL STEPS REMAIN (there is no CLI command for them):
     https://console.firebase.google.com/project/spanish2000-91271/authentication/providers
       1) Authentication → Sign-in method → Google → Enable → Save
       2) Authentication → Settings → Authorized domains → Add domain
            • losmaniac.github.io     (no https:// and no path!)
            • localhost               (only if you test locally)

   Until those are done the app works normally, but sign-in
   will fail with "auth/unauthorized-domain" or "auth/operation-not-allowed".
   ============================================================ */

window.FIREBASE_CONFIG = {
  projectId: "spanish2000-91271",
  appId: "1:701707240029:web:cc989489b2c771ac2483b4",
  storageBucket: "spanish2000-91271.firebasestorage.app",
  apiKey: "AIzaSyAuuFq_pRjyCBFM0dCvIVZSFd4M_Rg8djc",
  authDomain: "spanish2000-91271.firebaseapp.com",
  messagingSenderId: "701707240029"
};

