/* ============================================================
   KONFIGURACE FIREBASE  —  TADY DOPLŇ SVÉ ÚDAJE
   ============================================================

   Postup (jednorázově, ~5 minut):

   1) https://console.firebase.google.com  →  „Add project"
      (Google Analytics můžeš přeskočit)

   2) V projektu: Build → Authentication → Get started
        • Sign-in method → Google → Enable → Save

   3) Authentication → Settings → Authorized domains → Add domain
        • losmaniac.github.io            (bez https:// a bez cesty!)
        • localhost                      (pro lokální testování)

   4) Build → Firestore Database → Create database
        • zvol produkční režim (Production mode) a region (např. europe-west3)

   5) Firestore → Rules → vlož a publikuj (Publish) tyto zásady:

        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /progress/{userId} {
              allow read, write: if request.auth != null
                                 && request.auth.uid == userId;
            }
          }
        }

      ⚠️ Bez těchto pravidel je databáze buď otevřená všem, nebo zamčená.
      Tato pravidla zaručují, že každý uživatel vidí jen SVŮJ dokument.

   6) Project settings (ozubené kolo) → Your apps → Web app (</>)
        • Zaregistruj webovou aplikaci, zkopíruj objekt „firebaseConfig"
        • Vlož ho níže místo null

   POZNÁMKA K BEZPEČNOSTI:
   Hodnoty níže (apiKey apod.) NEJSOU tajné — Google je sám označuje jako
   veřejné identifikátory. Skutečnou ochranu tvoří Firestore Rules (krok 5)
   a seznam povolených domén (krok 3). Klidně je můžeš mít ve veřejném repu.

   Dokud je hodnota null, appka funguje úplně normálně — jen bez synchronizace
   a v záložce „Víc" se zobrazí upozornění, že cloud není nastavený.
   ============================================================ */

window.FIREBASE_CONFIG = null;

/* Až budeš mít údaje z konzole, nahraď řádek výše tímto a odkomentuj:

window.FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "tvuj-projekt.firebaseapp.com",
  projectId: "tvuj-projekt",
  storageBucket: "tvuj-projekt.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
  measurementId: "G-XXXXXXX"          // volitelné
};

*/
