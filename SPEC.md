# Zadání: PWA pro učení španělštiny (vanilla HTML/CSS/JS)

Postav **jednoduchou, funkční, offline PWA** pro češtinu mluvícího začátečníka (A1→A2, ~1 rok Duolinga). Žádný framework, žádný build krok, žádné npm závislosti. Uživatel si to otevře z telefonu a nainstaluje na plochu.

**Princip: nejmenší verze, která plně funguje.** Nepřidávej účty, backend, databázi, animační knihovny ani nic, o co se nežádá. UI česky, učená slova španělsky, překlady anglicky (z knihy).

## 1. Soubory (přesně tyto)


```
index.html        # shell + <nav> se 4 záložkami
style.css         # mobile-first, světlý/tmavý režim přes prefers-color-scheme
app.js            # veškerá logika (ES modules nejsou nutné)
sw.js             # service worker, cache-first
manifest.webmanifest
words.json        # DODÁNO, neměnit (viz §2)
grammar.json      # VYTVOŘ ty (viz §5)
verbs.json        # VYTVOŘ ty (viz §6)
icon-192.png, icon-512.png   # jednoduchá ikona (např. vygenerovaná přes canvas skript, pak smazat skript)
```

Všechny cesty **relativní** (`./words.json`), aby běželo i z podadresáře (GitHub Pages).

## 2. Data: `words.json`

Pole objektů, seřazeno podle frekvence (rank 1 = nejčastější), ~1 991 záznamů (v knize chybí pár čísel):

```json
{"rank":1,"es":"De","en":"From","ex_es":"Él es de la ciudad de Nueva York.","ex_en":"He is from New York City."}
```

Poznámky k datům (z knihy "2000 Most Common Spanish Words in Context", extrahováno strojově):
- `en` může obsahovat víc významů přes `/` a poznámku rodu v závorce: `"Good (Feminine)"`, `"The (Plural Masculine)"`. Při zobrazení **nech závorku viditelnou** (je to užitečná informace o rodu), při kontrole odpovědi ji ignoruj.
- `es` je s velkým písmenem na začátku; při procvičování zobraz malými (kromě vlastních jmen – nevadí).
- V pár příkladech jsou překlepy z originálu (např. „prívate“). Neopravuj.
- Zdroj je chráněná kniha: **jen osobní použití, nepublikuj words.json veřejně** (hostuj soukromě nebo jen lokálně).

## 3. Úložiště a SRS

Vše v `localStorage` pod jedním klíčem `es_state_v1` (JSON). Obalit try/catch; app musí fungovat i když storage selže (jen bez ukládání).

```js
state = {
  cards: { [rank]: { box: 0..5, due: "YYYY-MM-DD", seen: n, ok: n } },  // jen naučená slova
  xp: 0, streak: 0, lastDay: "YYYY-MM-DD", dailyGoal: 20, doneToday: 0,
  settings: { tts: true, newPerSession: 10 }
}
```

**Leitnerův systém**, intervaly po boxech ve dnech: `[0, 1, 3, 7, 16, 35]`.
- Správně → `box = min(box+1, 5)`, `due = dnes + interval[box]`.
- Špatně → `box = 0`, `due = dnes` (znovu ještě v téže session na konci fronty).
- „Nová slova“ = nejnižší rank, který ještě není v `cards`. Po naučení 10 nových se karty vloží s `box 1`.
- „K opakování“ = karty s `due <= dnes`.

XP: +10 správně, +2 špatně (za snahu), +20 za dokončenou session. Streak: +1 pokud `lastDay` byl včera, reset na 1 pokud starší, beze změny pokud dnes. Úroveň = `floor(xp/200)+1`, zobraz progress bar do další.

## 4. Obrazovky (4 záložky dole)

### 🏠 Domů
- Pozdrav, streak 🔥, XP + úroveň, denní cíl (kruhový nebo lineární progress).
- Dvě velká tlačítka: **Opakovat (N)** a **Nová slova (10)**.
- Statistika: naučeno slov / 1 991, pokrytí běžné řeči (viz tabulka níže), počet slov po boxech.
- Tabulka pokrytí (statická, z úvodu knihy): 1 000 slov ≈ 87,8 % mluvené řeči, 2 000 ≈ 92,7 %. Ukaž „tvé slovní zásoby ≈ x %“ lineární interpolací do 1 000 / 2 000.

### 📚 Učit (slovíčka)
Session se skládá z fází, v tomto pořadí, aby to nebyla nudná statická prezentace:
1. **Seznámení**: karta slova (es velkým písmem, en, příklad es + en, tlačítko 🔊 výslovnost přes `speechSynthesis` s `lang='es-ES'`, tlačítko „Znám / Nová“). U příkladu zvýrazni hledané slovo (case-insensitive nalezení `es` v `ex_es`; když se nenajde, nezvýrazňuj).
2. **Mini-kvíz po každých 5 slovech**: výběr ze 4 (distraktory = náhodná slova z blízkého ranku ±30, stejný „typ“ pokud jde).
3. **Závěrečné kolo** všech 10: psaní španělského slova podle anglického významu (tolerance: ignoruj velikost písmen a diakritiku → `normalize('NFD')`, ale ukaž správný tvar s diakritikou; chybějící/špatná diakritika = „skoro“, počítá se jako správně).

### 🔁 Opakovat
Fronta karet `due <= dnes` (max 30 na session), každá karta losuje jeden z režimů:
- **ES → EN** výběr ze 4
- **EN → ES** psaní
- **Doplň větu**: `ex_es` s mezerou místo slova (jen když se `es` v `ex_es` najde jako celé slovo; jinak režim vynech) + 4 možnosti
- **Poslech**: přehraj `es` přes TTS, uživatel vybere anglický význam (jen když je TTS dostupné, jinak vynech)
Po odpovědi hned zpětná vazba (zelená/červená, správná odpověď, příklad věty). Tlačítko „Další“ nebo Enter.

### 🧩 Gramatika
- Seznam lekcí z `grammar.json` (viz §5), odškrtávací stav v `state`.
- Lekce: krátké vysvětlení česky (max ~120 slov) → tabulka/příklady → **3–5 cvičení** (výběr / doplnění / seřaď slova) → shrnutí s XP.
- Pod gramatikou podzáložka **Slovesa**: vyhledávač sloves z `verbs.json` + tabulka časování (viz §6) + cvičení „napiš správný tvar“.

### ⚙️ Víc (v hlavičce jako ozubené kolo nebo 5. záložka)
- Procházet všech 1 991 slov: vyhledávání (es i en), filtr „naučená / nenaučená“, klik → karta se příkladem.
- Nastavení: TTS on/off, denní cíl, počet nových slov.
- **Export / Import** pokroku jako JSON soubor (záloha, přenos na jiné zařízení).
- Reset (s potvrzením).

## 5. `grammar.json` (napiš ty)

~12 krátkých lekcí pro A1→A2, česky, s odkazem na rozdíly proti češtině. Doporučené pořadí:
1. Člen a rod podstatných jmen (el/la, un/una, koncovky -o/-a, výjimky el día, la mano)
2. Množné číslo (-s/-es, změna z→c)
3. Ser vs. estar (stálé vs. stav/místo)
4. Přítomný čas pravidelných sloves (-ar/-er/-ir)
5. Tener, ir, hacer, querer, poder (nejčastější nepravidelná)
6. Hay vs. está/están
7. Ir a + infinitiv (budoucnost)
8. Zvratná slovesa (levantarse, llamarse)
9. Gustar a podobná (me gusta / me gustan)
10. Por vs. para
11. Zápor a otázky (no, nunca, ¿qué/cómo/dónde/cuándo/por qué?)
12. Pretérito perfecto (he + participio) a úvod do indefinida

Schéma:
```json
{"id":"ser-estar","title":"Ser vs. estar","text":"…česky, markdown-lite: **tučně**, řádky…",
 "table":[["yo","soy","estoy"]],
 "exercises":[
  {"type":"choice","q":"Ella ___ médica.","options":["es","está"],"answer":"es","why":"profese = ser"},
  {"type":"fill","q":"Nosotros ___ cansados.","answer":"estamos","why":"…"},
  {"type":"order","words":["yo","voy","a","comer"],"answer":"yo voy a comer"}
 ]}
```
Cvičení musí mít jednoznačnou odpověď. U `fill` přijímej i variantu bez diakritiky.

## 6. `verbs.json` (napiš ty)

~30 nejčastějších sloves (ser, estar, tener, hacer, ir, poder, decir, ver, dar, saber, querer, llegar, pasar, deber, poner, parecer, quedar, creer, hablar, llevar, dejar, seguir, encontrar, llamar, venir, pensar, salir, volver, tomar, conocer…), pro každé:
```json
{"inf":"hablar","en":"to speak","cz":"mluvit","type":"regular -ar",
 "presente":{"yo":"hablo","tú":"hablas","él/ella/usted":"habla","nosotros":"hablamos","vosotros":"habláis","ellos/ustedes":"hablan"},
 "pretérito":{…},"futuro_ir_a":"voy a hablar","participio":"hablado","example":{"es":"…","en":"…"}}
```
Časování **pečlivě zkontroluj** (nepravidelnosti: o→ue, e→ie, e→i, -go). Chybné tvary jsou horší než žádné; u nejistých sloves radši vynech pretérito.

## 7. PWA požadavky

- `manifest.webmanifest`: `name`, `short_name`, `start_url:"./"`, `display:"standalone"`, `theme_color`, `background_color`, ikony 192 a 512 (`purpose:"any maskable"`), `lang:"cs"`.
- `sw.js`: při `install` předcachuj všechny soubory z §1; `fetch` = cache-first s fallbackem na síť; `CACHE_NAME = 'es-v1'` a při `activate` smaž staré cache. Při změně kódu zvyš verzi.
- `<meta name="viewport" content="width=device-width,initial-scale=1">`, `<meta name="theme-color">`, `apple-touch-icon`.
- Service worker vyžaduje HTTPS nebo `localhost`. Lokální test: `python3 -m http.server 8000`. Nasazení: GitHub Pages / Netlify (privátně, viz poznámka k autorským právům).

## 8. UX a kvalita

- Mobile-first, palcem ovladatelné (tlačítka min. 48 px), čitelné písmo (≥ 18 px u slov), kontrast WCAG AA, světlý i tmavý režim.
- Hravost bez balastu: barevná zpětná vazba, malá animace při správné odpovědi (CSS transition), konfety **ne** (žádná knihovna), emoji jsou OK.
- Klávesnice: Enter potvrdí, 1–4 vybírá možnost.
- Číselný formát: `toLocaleString('cs-CZ')` (mezera jako oddělovač tisíců, čárka jako desetinná).
- Přístupnost: `aria-live` pro zpětnou vazbu, `<button>` na ovládání, focus viditelný.
- Žádné `alert/confirm` pro běžný tok (pro reset použij `confirm` jednou, to je v pořádku).
- Při načtení `words.json` selže-li fetch, zobraz srozumitelnou chybu, nepadej.

## 9. Kontrola hotového (musí projít)

Přidej do `app.js` (nebo samostatný `test.html`) krátké asserty na čistou logiku a spusť je:
- Leitner: správná odpověď na boxu 0 → box 1, `due = dnes+1`; špatná na boxu 3 → box 0, `due = dnes`.
- `normalize("estás") === normalize("estas")` pro porovnání odpovědí.
- Streak: `lastDay = včera` → +1; `lastDay = předevčírem` → 1.
- `words.json` se načte, délka > 1 900, každý záznam má neprázdná `es, en, ex_es, ex_en`.

Ruční test: nová karta → mini-kvíz → opakování → refresh stránky (stav zůstane) → letadlový režim (app běží) → instalace na plochu.

## 10. Co NEdělat (záměrně mimo rozsah)

Účty a cloud sync, push notifikace, rozpoznávání řeči, AI generování obsahu za běhu, překlad do češtiny (kniha má jen angličtinu), pokročilé statistiky. Přidat jde později.

## Pořadí práce

1. Kostra (`index.html`, záložky, načtení `words.json`, stav + storage) → 2. Učit + Opakovat + SRS → 3. Domů/XP/streak → 4. Gramatika + slovesa (obsah + UI) → 5. PWA (manifest, sw, ikony) → 6. Asserty a ruční test.

---

## 11. Dodatečné rozšíření: cloudová synchronizace

> **Pozn.:** §10 původně stavělo „účty a cloud sync" mimo rozsah. Na přání uživatele
> bylo toto rozšíření doplněno dodatečně. Ostatní body zadání zůstávají v platnosti.

**Nové soubory**

```
firebase-config.js   # konfigurace Firebase; dokud je null, sync je vypnutý
sync.js              # ES modul: Firebase Auth (Google) + Cloud Firestore
```

**Jak to funguje**

- `localStorage` zůstává **zdrojem pravdy** → offline-first z §7/§8 není nijak dotčen.
- Pokrok se zrcadlí do dokumentu `progress/{uid}` ve Firestore (jeden JSON blob).
- Při přihlášení se cloudový stav s lokálním **slučuje** funkcí `mergeProgress()`
  v `app.js` — nikdy se naslepo nepřepisuje:
  | pole | pravidlo |
  |---|---|
  | `cards` | u každého ranku vyhrává více procvičený záznam (`seen`), při shodě vyšší `box` |
  | `grammarDone` | sjednocení |
  | `xp` | maximum (součet by dvojitě počítal stejné session) |
  | `streak`, `lastDay`, `doneToday` | z novějšího `lastDay`; při shodě `doneToday = max` |
  | `settings` | vyhrává lokální zařízení |
- Zápis do cloudu: ~2,5 s po poslední změně (debounce) + při `pagehide`.
- Živé změny z jiného zařízení se aplikují přes `onSnapshot` (vlastní zápisy se
  ignorují podle `device` id).
- UI: panel **„Účet a synchronizace"** v záložce ⚙️ Víc + ruční „⬆ Nahrát" / „⬇ Stáhnout".

**Bezpečnost**

- Hodnoty ve `firebase-config.js` **nejsou tajné** (Google je označuje za veřejné identifikátory).
  Ochranu tvoří Firestore Security Rules (`allow read, write: if request.auth.uid == userId;`)
  a seznam povolených domén v Authentication → Authorized domains.
- Bez vyplněné konfigurace se nenačítá ani CDN Firebase a aplikace funguje beze změny.

