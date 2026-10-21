/* ============================================================
   KONFIGURACE FIREBASE  —  projekt spanish2000-91271
   ============================================================
   Tento soubor obsahuje VEŘEJNÉ identifikátory Firebase.
   Nejsou to tajné údaje — Google je sám označuje jako veřejné.
   Skutečnou ochranu tvoří:
     • Firestore Security Rules  (viz firestore.rules, už nasazeno)
     • seznam povolených domén   (Authentication → Authorized domains)

   ZBÝVAJÍ 2 RUČNÍ KROKY (v CLI pro ně neexistuje příkaz):
     https://console.firebase.google.com/project/spanish2000-91271/authentication/providers
       1) Authentication → Sign-in method → Google → Povolit → Uložit
       2) Authentication → Settings → Authorized domains → Add domain
            • losmaniac.github.io     (bez https:// a bez cesty!)
            • localhost               (jen pokud testuješ lokálně)

   Dokud nejsou hotové, appka funguje normálně, ale přihlášení
   skončí chybou "auth/unauthorized-domain" nebo "auth/operation-not-allowed".
   ============================================================ */

window.FIREBASE_CONFIG = {
  projectId: "spanish2000-91271",
  appId: "1:701707240029:web:cc989489b2c771ac2483b4",
  storageBucket: "spanish2000-91271.firebasestorage.app",
  apiKey: "AIzaSyAuuFq_pRjyCBFM0dCvIVZSFd4M_Rg8djc",
  authDomain: "spanish2000-91271.firebaseapp.com",
  messagingSenderId: "701707240029"
};

