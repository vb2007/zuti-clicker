# Fejlesztői dokumentáció – Zuti Clicker

## Projektstruktúra

A projekt két önálló alkalmazásból áll, amelyek egy közös repository gyökér alatt helyezkednek el:

```
zuti-clicker/
--> api/
--> frontend/
--> docs/
```

---

## Előfeltételek

| Eszköz | Verzió |
|---|---|
| Node.js | ≥ 20.19 |
| pnpm | ≥ 10 |
| MariaDB | ≥ 10.6 |

---

## API szerver

### Beállítás

```bash
cd api
cp .env.example .env   # ha van példafájl, különben hozd létre manuálisan
pnpm install
```

A `.env` fájl kötelező mezői:

```env
IP=localhost
PORT=2710

DATABASE_URL="mysql://felhasználó:jelszó@host:3306/zutiClicker"
SHADOW_DATABASE_URL="mysql://felhasználó:jelszó@host:3306/zutiClickerShadow"
DATABASE_USER=felhasználó
DATABASE_PASSWORD=jelszó
DATABASE_NAME=zutiClicker
DATABASE_HOST=host
DATABASE_PORT=3306

CRYPTO_SECRET_KEY=<min. 64 karakteres véletlen string>

# enforce (alapérték) | monitor | off — lásd lent, "Anti-cheat modell".
# NODE_ENV=production esetén mindig enforce-ra kényszerül, függetlenül attól,
# mi van itt beállítva.
ANTICHEAT_MODE=enforce
```

A shadow adatbázis a Prisma migrációk validálásához szükséges; ugyanazon a szerveren kell lennie, de üres adatbázisként.

### Adatbázis migráció

```bash
pnpm prisma migrate deploy   # meglévő migrációk futtatása
pnpm prisma generate         # Prisma client újragenerálása (sémaváltozás után)
```

### Indítás

```bash
pnpm start    # nodemon + tsx – fejlesztői mód, automatikus újraindítás
```

Az API elérhető: `http://localhost:2710`  
Swagger docs: `http://localhost:2710/docs`

A `GET /version` végpont (hitelesítés nélkül elérhető) a futó API pontos
verzióját adja vissza (`{ "version": "1.4.3" }`), egyetlen forrásból,
`api/package.json`-ból beolvasva a szerver indulásakor — ugyanez az érték
kerül a Swagger `info.version` mezőjébe is (korábban egy elavult, kézzel
beírt `"1.0.0"` volt ott). A frontend Settings modalja ezt hívja meg, hogy a
deployolt API verzióját megjelenítse (lásd lent, "Frontend").

### Tesztek futtatása

A tesztekhez az API-nak futnia kell (a tesztek élő szerver ellen dolgoznak):

```bash
pnpm test
```

A tesztek a `tests/` mappában találhatók. Az összes teszt a `TestData` osztályból veszi az adatokat (`tests/test-data.ts`); a belépési adatokat minden futtatás véletlenszerűen generálja, a mentési payloadok hardkódoltak.

Mivel a tesztek élő szerver ellen, valós adatbázisban hoznak létre `test_<random>@example.com` felhasználókat, ezek takarítására szolgál a `pnpm cleanup:test-users` script (`scripts/cleanup-test-users.ts`). Alapértelmezetten csak szimulál (dry run) és kiírja, mit törölne; a tényleges törléshez `--apply` kapcsoló szükséges: `pnpm cleanup:test-users --apply`. A script szigorú, `generateUser()` mintázatához illeszkedő reguláris kifejezéssel dönti el, mely sorokat érinti — az SQL-szűrés csak egy durva előszűrés, sosem a végső hatóság.

**Fontos**: a `src/tests/save.test.ts`, `leaderboard.test.ts` és `boosters.test.ts` fixture-jei (pl. a ranglista-tesztek "óriási" token-értékei, vagy egy régi mentés több órás játékideje) nem férnének bele a `PUT /save` mentés-hitelesség-ellenőrzésébe (lásd lent, "Anti-cheat modell") egy frissen regisztrált, azonnal mentő teszt-felhasználónál — ezért az itt futó szervernek `ANTICHEAT_MODE=monitor` alatt kell futnia (validál és naplóz, de sosem blokkol vagy módosít). Ez a mód pontosan erre való: a teljes alkalmazás szabadon tesztelhető, miközben a detekciós logika minden ága lefut és naplózódik. Az `enforce` mód HTTP-szintű viselkedését (409 elutasítás, csendes korrekció, korlátozás) a `src/tests/envelopeEnforcement.test.ts` és `strikeLadder.test.ts` fájlok saját, dedikált szerverpéldányokkal (más porton, explicit `ANTICHEAT_MODE=enforce`-szal indítva) bizonyítják — ezek nem függnek attól, milyen módban fut a közös teszt-szerver.

---

## Frontend

### Beállítás

```bash
cd frontend
pnpm install
```

### Indítás

```bash
pnpm dev # Vite dev szerver, Hot Module Replacement
```

A frontend elérhető: `http://localhost:5173`

A Vite dev szerver proxy-n keresztül kapcsolódik az API-hoz: minden `/api/*` kérés automatikusan `http://localhost:2710/*` -ra irányítódik. Az API-nak futnia kell a frontend megfelelő működéséhez.

### Build

```bash
pnpm build # type-check + bundle
pnpm preview # a build előnézete lokálisan
```

A frontend statikus nginx image-ként fut, futásidejű környezeti változó nélkül
— minden konfiguráció build time-kor épül be a bundle-be Docker `ARG`/`ENV`
párokon keresztül (lásd `frontend/Dockerfile`):

| Változó | Alapérték | Mit csinál |
|---|---|---|
| `VITE_API_BASE_URL` | `https://zuticlicker-api.vb2007.hu` | Az API abszolút URL-je production build-ben; fejlesztésben a Vite proxy váltja ki, ürese esetén a kód `/api`-ra esik vissza. |
| `VITE_ENABLE_QUICK_RESET` | `false` | Bekapcsolva engedélyezi az Alt+X gyorsbillentyűt, ami megerősítés nélkül azonnal törli a mentést és kijelentkeztet — szándékosan csak power-user/QA célra, alapból kikapcsolva (lásd `src/utils/featureFlags.ts`). Mivel build time-kor dől el, bekapcsolása image-újraépítést igényel, nem csak egy `.env` módosítást. |

Egy harmadik build time-kor beépülő érték, `__APP_VERSION__`, nem Docker
`ARG`/`ENV`, hanem közvetlenül `package.json`-ból olvasott Vite `define` —
nincs hozzá kapcsoló, mindig a build pillanatában érvényes verziószámmal épül
be. A `vite.config.ts`-ben definiált konstanst a `vitest.config.ts` is külön
definiálja (lásd a fájlok egymásra mutató „keep in sync" kommentjeit) —
enélkül a teszt-futáskor `__APP_VERSION__` egy definiálatlan globális lenne.
A Settings modal ezt a frontend-verziót jeleníti meg, az API `GET /version`
végpontjának eredménye mellett (lásd fent, "API szerver").

### Tesztek futtatása

A frontend a Vitest keretrendszert használja, valós szerver vagy adatbázis nélkül:

```bash
pnpm test          # egyszeri futtatás
pnpm test:watch    # watch mód fejlesztéshez
pnpm test:coverage # lefedettségi riport
```

A tesztek a `src/**/__tests__/*.spec.ts` minta alatt találhatók, a forrásfájlok mellett (pl. `src/utils/__tests__/prestige.spec.ts`).

#### E2E tesztek (Playwright)

A Vitest `happy-dom`-ja nem számol elrendezést (a `matchMedia`-ban sem érti a vesszős „vagy" listát), ezért a reszponzív regressziókat — vízszintes túlcsordulás, levágott vagy elérhetetlen vezérlők, érintési célméretek, a Vissza gomb viselkedése — a `frontend/e2e/` alatti Playwright csomag fogja meg valódi Chromiumban. Az API-t a böngészőben a `page.route` teljesen kimockolja (`e2e/fixtures.ts`): **nincs adatbázis és nincs élő szerver**; a `webServer` a Vite dev szervert indítja az `5199`-es porton (`E2E_PORT`-tal felülírható).

```bash
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e                      # mind
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e --project=phone-375  # egy eszközosztály
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e e2e/modals.spec.ts   # egy spec
```

- A `CHROMIUM_PATH` egy rendszerszintű Chromiumra mutat (a Playwright saját böngészője helyett). Ha nincs megadva és nincs letöltött böngésző, előbb `pnpm exec playwright install chromium` kell.
- Az eszközosztályok (Playwright „project"-ek): `phone-320`, `phone-375`, `phone-390`, `phone-landscape` (667×375), `tablet` (768×1024), `desktop` (1280×800), `desktop-wide` (1920×1080). Az érintős projekteken (`hasTouch` + `isMobile`) a `(pointer: coarse)` és a `(hover: none)` teljesül, az asztaliakon nem.
- A fixture (`e2e/fixtures.ts`): `loggedIn` és `language` (`"en"` / `"hu"`) opció a `test.use()`-ban; `app.open()`, `app.seed(fn)` (a Pinia store-ok térképét kapja: `s.ui`, `s.game`, …), `app.settle()` (az egyszeri CSS-animációk lecsengésére vár — **hamis óra (`page.clock`) alatt ne használd**, mert `requestAnimationFrame`-mel pollozik), `app.horizontalOverflow(selectors)`.
- A Chromium nem tudja emulálni az `env(safe-area-inset-*)` értéket, ezért az `--sai-*` tokenek a böngészőben felülírhatók: `document.documentElement.style.setProperty("--sai-bottom", "34px")`.
- **Nincs újrapróbálkozás** (`retries: 0`): a Playwright JUnit-riportja az újrapróbált sikert simán sikernek számolja, ami elrejtene egy ingadozó elrendezés-ellenőrzést.
- Új reszponzív javításhoz a regressziós tesztet ide írd, ha a hiba **elrendezés** (méret, pozíció, túlcsordulás, takarás); ha **logika** (állapotgép, geometria-függvény), akkor Vitest a megfelelő hely. A tesztet bizonyítsd: építsd vissza ideiglenesen a hibát, és győződj meg róla, hogy a megfelelő teszt elbukik.

---

## Architektúra áttekintő

### API rétegek

```
router/ → controllers/ → database/models/ → Prisma → MariaDB
              ↑
         middlewares/  (isAuthenticated)
```

- **`router/`** – Express route regisztráció (`authentication.ts`, `save.ts`, `settings.ts`)
- **`controllers/`** – Request/response kezelés, validáció, Swagger JSDoc
- **`database/models/`** – Adatbázis műveletek (Prisma hívások)
- **`middlewares/`** – `isAuthenticated`: session token ellenőrzés, `req.identity` feltöltése
- **`helpers/`** – HMAC-SHA256 hitelesítés, random token generálás
- **`constants/responses.ts`** – Centralizált HTTP válaszkódok és üzenetek
- **`constants/settings.ts`** – A `UserSettings` mezők megengedett értékei (téma, nyelv, autosave-intervallum, fokozatszerzés-ünneplés, ranglista-elrejtés) és alapértékei — a `config/swagger.ts` és a `controllers/settings.ts` egyaránt ebből importál, hogy ne csúszhassanak szét
- **`constants/leaderboard.ts`** – A ranglista-mérőszámok (`tokens`, `clicks`, `phd`, `playtime`) leképezése a megfelelő `GameSave` mezőre, valamint az alapértelmezett és maximális `limit` érték — lásd lent, "Ranglisták (leaderboard)"

#### Végpontok

| Metódus | Útvonal | Hitelesítés | Leírás |
|---|---|---|---|
| `POST` | `/auth/register`, `/auth/login`, `/auth/logout` | – / kötelező | Regisztráció, bejelentkezés, kijelentkezés |
| `GET` | `/auth/me` | kötelező | Bejelentkezett felhasználó adatai |
| `GET`, `PUT`, `DELETE` | `/save` | kötelező | Játékmentés betöltése, felülírása (részlegesen: a prestige mezők és a fejlesztések listája opcionálisak), törlése |
| `GET`, `PUT` | `/settings` | kötelező | Felhasználói beállítások betöltése (alapértékek, ha még nincs mentve) és részleges frissítése |
| `GET` | `/leaderboard` | kötelező | Rangsor egy adott mérőszám szerint (`tokens`, `clicks`, `phd`, `playtime`), plusz a lekérdező saját helyezése |
| `POST` | `/boosters/claim` | kötelező | Egy véletlenszerű booster igénylése, ha a lehűlési idő már letelt — lásd lent, "Anti-cheat modell" |
| `POST` | `/upgrader/spin` | kötelező | A PhD-kerék egy pörgetése: `{ stake, multiplier }` — a szerver dobja és számolja el a kimenetelt — lásd lent, "Anti-cheat modell" → "Az Upgrader" |
| `POST` | `/career/buy`, `/career/refund`, `/career/close` | kötelező | A Tudományos pálya: egy csomópont megvétele, visszaváltása (a leszármazottakkal együtt), a vásárlási ablak bezárása — csak a fokozatszerzés után nyíló ablakban; lásd lent, "Anti-cheat modell" → "Tudományos pálya" |
| `POST` | `/anticheat/report` | kötelező | Kattintás-időzítési telemetria digest beküldése (fix ütemezéssel + azonnal lokális detekció esetén) — lásd lent, "Anti-cheat modell" |
| `GET` | `/anticheat/status` | kötelező | A jelenlegi korlátozási állapot (`isRestricted`, `restrictedUntil`, `strikeCount`) lekérdezése |

A `PUT /save` öt prestige-mezője (`phdCount`, `prestigeCount`, `runTokensEarned`, `runClicks`, `runSeconds`) **opcionális**: egy régebbi kliens, amely nem ismeri ezeket, biztonságosan tud menteni — a hiányzó mezőket a szerver a már tárolt értéken hagyja (nem nullázza), első mentésnél pedig az életút-mezőkből tölti fel őket.

Egy formailag helyes, de az előző mentéshez és az eltelt időhöz képest fizikailag elérhetetlen mentést a végpont `409`-cel utasít el (semmi nem íródik), vagy — ha csak kismértékben lépi túl a lehetségest — csendben az elérhető határértékre korrigál és `200`-at ad vissza; lásd lent, "Anti-cheat modell". A fiók **első** mentésének elutasítása `code: "save_first_unverifiable"`-t hordoz és sosem strike (lásd ott, "Vendég → fiók").

Egy hatodik, szintén opcionális mező, az `upgrades` (megszerzett fejlesztés-azonosítók tömbje) ugyanezt a mintát követi: hiányzása esetén a szerver a már tárolt fejlesztéseket változatlanul hagyja, jelenléte esetén viszont — az `units` mezőhöz hasonlóan — teljesen felülírja őket. Minden elemének egy ismert fejlesztés-azonosítónak kell lennie (`api/src/constants/upgrades.ts`'s `KNOWN_UPGRADE_IDS`), különben a végpont `400`-at ad vissza. A `GET /save` válasza az `upgrades` mellett egy csak-olvasható `activeBoosters` tömböt is tartalmaz (a jelenleg aktív boosterek, `remainingMs` hátralévő idővel) — ezt a `PUT /save` sosem fogadja el, kizárólag a `POST /boosters/claim` hozhatja létre vagy frissítheti.

A `PUT /save` a `phdCount`-ot egész számként fogadja `2^53 − 1`-ig (a PhD-oszlopok `DOUBLE`-k), és a válasza egy `career` mezőt is hordoz: a mentés nyitott-e Tudományos pálya vásárlási ablakot (egy fokozatszerzést hordozó mentés nyit) — lásd lent, "Tudományos pálya".

A hetedik, szintén opcionális mező, az `upgraderSeq` az Upgrader pörgetés-számlálója: a `GET /save` és a `POST /upgrader/spin` adja ki, a kliens pedig minden mentésnél visszaküldi. A `PUT /save` **sosem tárolja** — kizárólag az írást védi: ha nem egyezik a fiók aktuális értékével, a mentés egy pörgetés (vagy egy Tudományos pálya-vásárlás/-visszaváltás, egy `windfall`-jóváírás) *előtti* állapotot hordoz, ezért `409`-et kap `code: "save_stale"` kóddal (nem strike, minden `ANTICHEAT_MODE` alatt), és semmi nem íródik. Hiányzó értéke `0`-nak számít (egy sosem pörgetett fióknál ez helyes). Lásd lent, "Az Upgrader".

### Frontend state management

```
App.vue
  ├── useGameLoop()          → gameStore.tick() 20x/s
  ├── useAntiCheat()         → 60s telemetria heartbeat + pointerdown/pointermove figyelők — lásd lent, "Anti-cheat modell"
  ├── usePrestige()          → gameStore.prestige() -> ceremónia/szinkron
  ├── useBoosters()          → booster pickup ütemezése (spawn/láthatósági ablak) + igénylés
  ├── useUpgrader()          → egy Upgrader-pörgetés végigvitele (előzetes mentés → szerver-pörgetés → eredmény alkalmazása); UpgraderModal.vue használja
  ├── useCareer()            → Tudományos pálya: vásárlás/visszaváltás/bezárás (előzetes mentés → szerver → állapot átvétele); a CareerOverlay.vue használja
  ├── useAutoBuyer()         → az automatikus egység-/fejlesztésvásárlók másodpercenkénti köre (autoBuyStore: a kapcsolók localStorage-ban)
  ├── useGuestReminders()    → vendég-emlékeztető a függő PhD-nyereség 1, 5, 25, … határainál (bejelentkezés gombos toast)
  ├── useBreakpoint()        → isCompact (matchMedia, < 760px) — a useMediaQuery() vékony burkolója
  ├── useOverlayStack()      → melyik nyitott lap/modál záródik Esc-re és a böngésző/Android Vissza gombra — lásd lent, "Overlayek és a Vissza gomb"
  ├── authStore              → session check, login/register/logout
  ├── settingsStore          → téma, nyelv, autosave, ceremónia — localStorage + szerver szinkron
  ├── saveStore               → load/sync/reset (autosave-időzítő a settingsStore-ból olvas) + withSyncLock (sorba állító lock, lásd lent, "Az Upgrader" és "Tudományos pálya") + reload
  │                             + logout (mentés, majd friss vendég) + carryOverRejected / startAccountFresh (elutasított első mentés)
  ├── uiStore                → modál állapotok (köztük careerOpen — a fa nézet módban), mobilePanel ("none" | "stats" | "units"), shopTab ("units" | "upgrades")
  ├── toastStore             → átmeneti értesítések (pl. beállítások mentése, booster begyűjtése); opcionális gombbal (`action`)
  ├── leaderboardStore       → mérőszámonkénti rangsor lekérése (nincs localStorage-gyorsítótár, mindig a szerver a forrás)
  ├── antiCheatStore         → recordClick()/recordPurchase(), isRestricted/restrictedUntil/strikeCount, telemetria-puffer
  └── gameStore              → tokenek, egységek, fejlesztések (upgrades), aktív boosterek, statisztikák, prestige állapot,
                                upgraderSeq / spinPending / phdCountDisplay, Tudományos pálya (careerNodes, ablak,
                                careerModifiers, careerPending, lendület, demonstrátor-bevétel)
                                (minden progressziót módosító akció előbb antiCheatStore.isRestricted-et ellenőrzi)
```

A `ClickerArea.vue` (középső oszlop) hívja meg a `useBoosters()` composable-t — ez tartja karban a véletlenszerű booster-pickup teljes életciklusát (mikor jelenik meg, meddig látható, mi történik kattintáskor); a `BoosterPickup.vue` és `ActiveBoostersBar.vue` komponensek ebből olvasnak. A tényleges booster-effektus (termelés-/kattintás-szorzó, egységár-kedvezmény) a `gameStore.activeBoosters` állapoton keresztül érvényesül — lásd lent, "Anti-cheat modell" → "Boosterek".

A `saveStore` a `authStore`-tól és a `settingsStore`-tól függ: az autosave-időzítő automatikusan elindul/leáll, amikor `isLoggedIn`, `autosaveEnabled` vagy `autosaveIntervalSecs` megváltozik. A `settingsStore` sosem importálja a `saveStore`-t (a függőségi irány mindig `settings → save`, nem fordítva), hogy elkerülje a körkörös importot.

### Reszponzív töréspontok

Nincs mobil-first felépítés — a `frontend/src/App.vue`, `AppHeader.vue`,
`SaveBar.vue`, `MultiplierSelector.vue`, `UnitCard.vue` és `ToastHost.vue`
saját `@media` szabályai a meglévő asztali elrendezésre épülnek rá:

| Szélesség | Elrendezés |
|---|---|
| `>= 1120px` | Az eredeti, fix szélességű háromoszlopos rács. |
| `760px – 1119px` | Ugyanaz a három oszlop, de a két oldalpanel `clamp()`-pel keskenyedik. |
| `< 760px` | A Kattintó tölti ki a teljes szélességet; a két oldalpanel (`StatusColumn`, `UnitsPanel`) `.rail` osztályt kap az `App.vue`-tól, és `position: fixed` + `transform` segítségével alulról felcsúszó lapként jelenik meg. Az `uiStore.mobilePanel` mező (`"none" | "stats" | "units"`) tárolja, melyik lap van nyitva; ezt olvassa az új `MobileTabBar.vue` (a lenti fülsáv), a lapok maguk, és a köztük lévő elhalványuló háttér (`.mobile-scrim`). |

A két panelkomponens (`StatusColumn`, `UnitsPanel`) egyetlen példányban létezik
minden szélességnél — a mobil nézet nem szerel le és épít újra semmit, csak
CSS-sel repozicionálja őket. Ez azért működik, mert egy komponens gyökérelemére
adott extra `class`/`id` (lásd `App.vue`: `<StatusColumn class="rail rail-stats" />`)
a Vue "fallthrough attribútum" mechanizmusa miatt a szülő saját `scoped` CSS
hash-ét is megkapja a gyermek gyökerén — ezt a viselkedést a tényleges
lefordított kimeneten ellenőriztük, mielőtt erre építettünk volna.

A `frontend/src/composables/useBreakpoint.ts` egy `matchMedia`-alapú
összetevő, ami `isCompact`-ot ad vissza; ez csak arra kell, amit CSS önmagában
nem tud megoldani — pl. hogy egy nyitva hagyott mobil panel automatikusan
bezáródjon, ha az ablak visszaszélesedik 760px fölé. A `useMediaQuery.ts` az
általános változata egy tetszőleges média-lekérdezéshez (az Upgrader így dönti
el, hogy rövid képernyőn szűkebb belső margót kapjon) — a lekérdezést mindig
tartsd szinkronban a megfelelő CSS-sel.

#### További feltételek a szélesség mellett

| Feltétel | Mit változtat |
|---|---|
| `max-width: 759px` és `max-height: 500px` (keskeny telefon fekvő) | A fejléc egysoros (`--header-h-compact: 52px`, a statisztika a fejlécben inline), a fülsáv 48px; a lapok teljes magasságot kapnak (nincs `--sheet-gap`). |
| `max-height: 500px` (bármilyen szélesség — egy fekvő telefon 844×390-nel már 760px fölött van, és az asztali háromoszlopos elrendezést kapja) | Az `ActiveBoostersBar` chipjei bal oldalt, függőlegesen állnak, és csak a kör melletti helyet használhatják (az effekt-szöveg `…`-re vágódik, az idő mindig látszik); az Upgrader kompakt belső margót kap, 640px szélességtől két oszlopra bomlik, 360px magasságtól alacsonyabban az ×1,2/×100 felirat is elmarad. |
| `max-width: 399px` | A fejlécből eltűnik a nyelv- és témagomb (a Beállításokban megvannak). Egy bejelentkezett fejléc ~355px-t igényel, e fölött fér el egy sorban. |
| `max-height: 500px` és `min-width: 640px` | Az Upgrader két oszlopra bomlik (kerék + kimenetek \| tét, szorzó, Spin). 640px alatt egy oszlop marad, mert különben a tét mezője ~70px-re szűkülne. |
| (szélességtől független) | A fejlesztések rácsa `repeat(auto-fill, minmax(68px, 1fr))`: annyi oszlop, amennyi még olvasható csempeszélességgel elfér (a keskenyített tablet-panelen 2, 1280px-es asztalon 3, telefonon 3–5), a csempenév legfeljebb 3 soros. A `minmax(0, …)`-jellegű minimum az, ami megakadályozza, hogy egy hosszú szó kitolja az oszlopot. |
| `(pointer: coarse)` | Az összes 44px-es érintési célméret szabály a `max-width: 759px` mellett erre is vonatkozik — egy tablet 760px fölött is érintős. |
| `(hover: hover)` | **Minden** `:hover` stílus ebbe van csomagolva, különben érintésnél a koppintás után "beragad" a hover-állapot. |

#### Biztonságos területek (safe area) és a fülsáv

A `viewport-fit=cover` miatt a tartalom a bevágás (notch) és a kezdőképernyő-sáv alá is benyúl. A `base.css` `--sai-top/right/bottom/left` tokenjei az `env(safe-area-inset-*)` értékét adják — **tokenként, nem nyers `env()`-ként**, hogy tesztben felülírhatók legyenek. A `--tabbar-total` a fülsáv teljes magassága (`--mobile-tabbar-h` + `--sai-bottom`): **minden, ami "a fülsáv fölé" kerül** (lapok, `.mobile-scrim`, toastok) ezt használja, nem a puszta `--mobile-tabbar-h`-t — különben iPhone-on a fülsáv alá csúszik.

#### A Kattintó körének mérete és a booster pickup

A `ClickerArea.vue` méret-konténer (`container-type: size`), és egyetlen `--circle` változót ad ki: a szélességének ~62%-a, de nem nagyobb, mint ami mellett a felirat, a cps-pill és a booster-sáv még elfér; felülről `clamp(220px, 18vw, 300px)` korlátozza (telefonon és tipikus asztali ablakban így marad az eredeti 220px, csak nagy monitoron nő), alulról 140px. A kör arca, fénye és mindkét gyűrűje ebből származik (`ClickerCircle.vue`). A tartalék érték (`220px`) a konténer-egységeket nem ismerő böngészőknek van. A `ClickerArea` a területét és a kört a pickup megjelenésekor méri le, és a `utils/boosterPlacement.ts` tiszta, pixel-alapú függvénye választ pozíciót: teljesen a területen belül, és a kör + a pickup sugarától távol — a korábbi, százalékos szabály 320px-es telefonon (96px) a kör sugaránál (110px) kisebb volt.

#### Overlayek és a Vissza gomb

A modálok, a mobil lapok és a fokozat-ceremónia **overlay**-ek: mindegyik a `composables/useOverlayStack.ts`-nél regisztrál (`useOverlay(isOpen, close, priority)`; a `BaseModal` automatikusan, a `z-index`-ét használva prioritásként; a mobil lap 400, a ceremónia 2000). A verem mondja meg, mit zár be az **Esc** és a böngésző/Android **Vissza** gomb: mindig a legmagasabb prioritású, azonos prioritásnál a legutóbb regisztrált overlayt, egyszerre csak egyet (a tartott, ismétlődő Esc és az IME-összeállítás nem számít).

A Vissza gomb úgy működik, hogy amíg legalább egy overlay nyitva van, pontosan egy **sentinel** history-bejegyzés ül a valódi fölött (`history.pushState` az aktuális `history.state` másolatával — a `vue-router` route-ok nélkül is ebben tárolja a saját állapotát). A Vissza ezt kapja el, és bezárja a legfelső overlayt; ha marad másik, a sentinel újra felkerül (a visszautasított bezárásnál is, pl. Beállítások mentés közben, vagy a ceremónia a számlálás alatt). Ha az utolsó overlayt más módon zárják be (✕, háttér, Esc), a fölösleges sentinelt a verem egy saját `history.back()`-kel eltávolítja (az ennek megfelelő `popstate`-et figyelmen kívül hagyja). Két ritka eset külön kezelt: egy overlay, ami a saját `history.back()` még úton lévő ideje alatt nyílik, csak a `popstate` beérkezése után kapja meg a sentinelt; egy újratöltés után a `history.state`-ben maradt (immár érvénytelen) sentinelről az első használatkor lelép. Új overlayhez ne írj saját `keydown`/`popstate` figyelőt — regisztrálj a veremnél.

A `BaseModal` `closable` prop-ja fejlécet ad egy mindig látható (`position: sticky`), címkézett ✕ gombbal (`common.close`; érintésen 44px). Tartalmi modáloknál használd (Ranglista, Beállítások — ott a ✕ a „Mégse"-vel azonos —, Auth, Upgrader); a kérdést feltevő, riasztás-jellegű modálok (törlés-megerősítés, fokozat-megerősítés, vendégfigyelmeztetés, anti-cheat) megmaradnak az explicit gombjaiknál, ✕ nélkül.

#### Tooltipek és az érintéses előnézet

A `useAnchoredTooltip` a horgonya alá nyílik; ha ott nem fér el (a konzervatív `estimatedHeight` alapján), fölé fordul (`bottom` kötéssel, így nem kell magasságot mérni), ha egyik irányban sem fér el (fekvő telefon), annyira feljebb csúszik, hogy a nézetablakon belül maradjon. A visszaadott szélesség a nézetablakhoz szorított. A `toggle()` a koppintáshoz való (a fókusz/hover ugyanazon koppintásból érkező nyitását egy rövid türelmi idő védi a rögtöni bezárástól), a nyitott tooltipet egy máshová történő `pointerdown` zárja be.

Az `UpgradeTile` érintésen **hosszú nyomásra** (500ms, legfeljebb 10px mozgás) előnézetet nyit, és ez a nyomás **sosem vásárol**. A gyors koppintás sosem aktiválja: az időzítőt a felemelés, a `pointercancel` és a mozgás is törli, és csak az a nyomás nyeli el a rá következő `click`-et, amely tényleg előnézetet nyitott (egyszeri, saját lejárattal). Az elérhetetlen (drága) csempe `disabled` helyett `aria-disabled`-et kap, hogy fókuszálható/hoverelhető maradjon és a tooltipje olvasható legyen — a `buy()` ettől még elutasítja. Ha ezt a küszöböt módosítod, a Vitest és az e2e (`touch-preview.spec.ts`, emberi hosszúságú koppintásokkal) is bukik, ha túl alacsony.

---

## Új egység hozzáadása

1. Szerkeszd a `frontend/src/utils/gameConstants.ts` fájlt, adj hozzá egy új elemet a `UNIT_DEFINITIONS` tömbhöz:

```typescript
{ id: "iota", baseCost: 5_000_000_000, baseProduction: 150_000, costGrowth: 1.15 }
```

2. Adj hozzá fordítási kulcsokat mindkét i18n fájlhoz (`src/i18n/en.ts`, `hu.ts`):

```typescript
names: { ..., iota: "Iota" },
descriptions: { ..., iota: "Leírás..." }
```

Az egység azonnal megjelenik a shopban (a láthatóság automatikusan számított: `totalTokensEarned >= baseCost * 0.1`).

---

## Új fejlesztés (upgrade) hozzáadása

A fejlesztések (upgrade-ek) egyszeri megvásárlású, prestige-kor elvesző
kattintás-erő bónuszok — lásd `frontend/src/stores/gameStore.ts`
`ownedUpgrades`/`buyUpgrade` és a képleteket a
`frontend/src/utils/upgrades.ts`-ben.

1. Szerkeszd a `frontend/src/utils/gameConstants.ts` fájlt, adj hozzá egy új
   elemet a `UPGRADE_DEFINITIONS` tömbhöz — a `family` mező határozza meg,
   melyik képlet dolgozza fel (`flat`/`multiplier`/`synergy`/`crit`/
   `boosterDuration`/`boosterSpawn`, lásd `upgrades.ts`):

```typescript
{ id: "guestLecturer", family: "flat", cost: 8_000_000, effect: 500 }
```

2. Add hozzá az azonosítót az **API** oldalán is a
   `api/src/constants/upgrades.ts` fájl `KNOWN_UPGRADE_IDS` tömbjéhez — a
   `PUT /save` ez ellen a lista ellen validál, egy nem szereplő azonosító
   `400`-at eredményez.
3. Adj hozzá fordítási kulcsokat mindkét i18n fájlhoz (`src/i18n/en.ts`,
   `hu.ts`), `upgrades.names.<id>` és `upgrades.descriptions.<id>` alatt.

A fejlesztés azonnal megjelenik a boltban (a láthatóság ugyanaz a
felfedezési logika, mint az egységeknél: `totalTokensEarned >= cost *
UPGRADE_REVEAL_FRACTION`), a megfelelő csoportban. A megjelenítési
csoportosítás (`FAMILY_GROUPS` a `UpgradesPanel.vue`-ban) UI-only fogalom,
külön a formula-`family`-től — négy csoport van (`clickValue` = flat +
multiplier, `synergy`, `crit`, `booster` = boosterDuration +
boosterSpawn), mindegyik saját, egysoros magyarázó alcímmel
(`upgrades.groupDesc*`). Egy meglévő családba tartozó új fejlesztéshez nem
kell új csoport-kulcs, csak az 1–3. lépés. A tile-on és a megszerzett
fejlesztések sávjában megjelenő kompakt hatás-felirat (pl. `+0.5%`, `×2`,
`15% ×7`) egyetlen közös helyről, a `utils/upgrades.ts`
`getUpgradeEffectLabel()` függvényéből származik — ha egy `family`
megjelenítési formátumát módosítod, csak ott kell.

---

## Új booster hozzáadása

A boosterek időzített, szerver által kiadott bónuszok — lásd "Anti-cheat
modell" → "Boosterek" lentebb a teljes életciklusért.

1. Szerkeszd a `frontend/src/utils/gameConstants.ts` fájlt, adj hozzá egy új
   elemet a `BOOSTER_DEFINITIONS` tömbhöz (`kind`: `production`/`click`/
   `costReduction`):

```typescript
{ id: "guestSpeaker", kind: "production", multiplier: 4, durationSecs: 90, weight: 2 }
```

2. Tükrözd ugyanezt az **API** oldalán az `api/src/constants/boosters.ts`
   fájl `BOOSTER_IDS`/`BOOSTER_WEIGHTS`/`BOOSTER_DURATION_SECS`
   objektumaiban — a tényleges kiválasztás és időzítés szerver oldalon
   történik (`database/models/boosters.ts`), ez a másolat a forrása.
3. Adj hozzá fordítási kulcsot mindkét i18n fájlhoz, `boosters.names.<id>`
   alatt. A hatás-szöveget (pl. „×7 production", „-25% prices") **nem**
   `<id>` szerint kulcsolva, hanem a `kind` szerint — `boosters.effect.
   {production|click|costReduction}` — kapja mindhárom booster egy közös
   `getBoosterEffectText()` segédfüggvényből
   (`frontend/src/utils/boosterEffectText.ts`), amit az
   `ActiveBoostersBar.vue` aktív-buff sávja és a `useBoosters.ts` claim
   toastja is ugyanonnan hív, hogy a kettő sose térjen el egymástól. Egy új
   `kind` bevezetése esetén ebbe a switch-be és mindkét i18n fájl
   `boosters.effect` blokkjába kell új ágat felvenni; egy meglévő `kind`
   újrafelhasználásakor (mint a fenti példa) nincs itt teendő.

---

## Anti-cheat modell

Négy réteg, amelyek célja explicit **nem** a "minden kattintást szerver-
hitelessé tenni" (ez a kattintás-gazdaság teljes átírását jelentené), hanem
annak biztosítása, hogy amit a kliens állít, az fizikailag elérhető is
legyen, és hogy az automatizálás (auto-clicker, Tampermonkey-szkript, direkt
API-hamisítás) ne érje meg. Legfontosabb tervezési elv mindenhol: **egy
valódi játékos büntetése rosszabb, mint egy csaló át nem kapása** — minden
küszöb szándékosan laza.

### 1. réteg — a mentés-hihetőségi burok (`services/saveValidator.ts`)

A `PUT /save` minden beérkező mentést összevet az előzővel és az azóta eltelt
valós idővel, a szerver-oldali gazdaság-tükör (`services/economy.ts`,
`constants/gameBalance.ts` — a frontend `costCalculator`/`prestige`/
`upgrades.ts` és `gameConstants.ts` kézzel tartott másolata, "keep in sync
with" kommentekkel) segítségével:

- **Monotonitás** (életút-számlálók sosem csökkenhetnek) → mindig azonnali elutasítás.
- **Eltelt idő**: `Δelapsedseconds ≤ dt` (nincs offline progresszió, a tick csak csatolt fül mellett fut).
- **Első mentés** (a fióknak még nincs mentése, és sosem kapott strike-ot): a `dt` kezdőpontja a fiók létrehozása **vagy** a mentés saját, vendégként játszott ideje közül a korábbi — ez utóbbi legfeljebb `FIRST_SAVE_PLAYTIME_CREDIT_SECS` (24 óra) erejéig (lásd lent, "Vendég → fiók").
- **Kattintásszám**: `Δclicks ≤ 45 · dt` (a burkoló-réteg saját, nagyvonalú felső korlátja — nem a statisztikai detektor jelzési küszöbe, lásd lent).
- **Bevétel**: a legkedvezőbb lehetséges termelési/kattintás-érték × `dt`, 1.5-szörös ráhagyással.
- **Elköltés**: az újonnan megszerzett egységek/fejlesztések legolcsóbb lehetséges ára (legjobb PhD-kedvezmény × legjobb booster-kedvezmény) — ez fogja meg az "ingyen egység" hamisítást.
- **Prestige/PhD**: a prestige-szám felülről korlátos az életút-bevétel alapján (minden prestige-hez legalább `PHD_TOKEN_SCALE` token kell, ami tartósan beépül az életút-bevételbe), a PhD-szám pedig ezen *már korlátozott* prestige-szám és az életút-bevétel alapján (Cauchy–Schwarz-egyenlőtlenség) — ez a sorrend zárja be azt a rést, hogy egy korlátlan prestige-szám önmagában tetszőlegesen felfújhatná a PhD-korlátot.

**Éles incidens — a bevétel-korlát prestige alatt** (2026-09-21): egy valódi
fiók kétszer is azonnali strike-ot kapott simán azért, mert prestige-elt,
majd ugyanabban az intervallumban mentés történt. A bevétel-korlát kizárólag
a **prestige UTÁNI** (nullázott) egység-állapotból számolt termelési rátát
használta — ha az intervallumban 0 kattintás történt (a prestige gombhoz nem
kell kattintani), a korlát pontosan 0-ra esett, miközben a `totalTokensEarned`
jogosan nőtt a prestige ELŐTTI futás alatt. A javítás (`maxEconomy()`,
`services/saveValidator.ts`) a bevétel-korlátot most a prestige előtti ÉS
utáni gazdaság közül a nagyobbikkal engedi — ez matematikailag még mindig
érvényes felső korlát (a valódi bevétel a kettő közti valamilyen felosztásból
származik, a nagyobbik teljes intervallumra engedése csak lazítja, sosem
szigorítja a határt), miközben egy valódi "prestige, majd mentés" sosem esik
alatta.

**Éles incidens — egy teljes menet két mentés között** (2026-10-20): a
vezető játékost újra és újra korlátozta a rendszer. Nagy Tudományos pályával
(megtartott egységek, kezdőtőke, automatikus vásárlók) és sok PhD-vel egy
menet ~11 másodperc lett — egy egész menet elkezdődött, felépült és véget ért
két mentés között. A prestige-intervallum bevétel-korlátja az előző mentés
(a menet *eleje*: a megtartott egységek) és a beérkező mentés (a következő
menet eleje) gazdaságából számolt — egyik sem a menet csúcsa, ami a bevételt
termelte. 8,1×10¹¹ bevétel 2,1×10¹¹-es korlát ellen: elutasítás és strike,
majd a kliens a korlátozás lejártakor ugyanazt a mentést küldte újra — újabb
strike (ban-hurok). A javítás (`affordablePeakState`,
`services/saveValidator.ts`) egy harmadik gazdaságot is figyelembe vesz: a
legerősebbet, amit az intervallum saját költségvetése (a meglévő tokenek, a
bevétel és a kezdőtőkék) megvehetett — menetről menetre: a folyamatban lévő
menet az előző mentés egységeiből folytatódik, minden további menet a
`keptUnitCount` szerint megtartottakból indul, és mindegyik legfeljebb a teljes
költségvetésnyit vesz, valódi áron, a legjobb termelés/ár sorrendben (ez az
optimum egy egységen belül — azt az egy egységet hozzá is adjuk). Mivel az ár
típusonként mértani sorban nő, a jóváírt gazdaság csak a követelés
logaritmusával nő, így egy felfújt követelés sem fér bele a saját korlátjába.
Ellenőrzés: a valódi frontend-store-ral játszott, valós mentési ütemű
(autosave 15/30/300 mp vagy kikapcsolva, mentés minden fokozatszerzés után;
a tárolt generátor a 30 mp-es és a kikapcsolt ütemet futtatja)
80 órás szimulációk — a régi korlát mellett 41–254 elutasítás és több száz
érdemi korrekció (strike-ok, illetve a korrekció-minta felé), az újjal
**nulla** elutasítás és nulla érdemi korrekció. A tesztkészlet
(`prestigeIntervalEnvelope.test.ts`) a vezető játékos valódi tárolt állapotát
és a szimulációból vett 73 becsületes intervallumot játssza vissza
(`honest-prestige-intervals.json`, újragenerálás: `pnpm sim:save-cadence` a
frontendben). A hamisítási mozgástér egy prestige-intervallumban ugyanabba a
nagyságrendbe esik, mint amit egy okos hamisító egy *sima* intervallumban
eddig is kapott (ha a követelt bevételből megvett egységeket és fejlesztéseket
is bejelenti) — a burok nagyvonalú védőháló, nem pontos mérés.

**Éles incidens — lebegőpontos tolerancia** (2026-09-21): a `checkBound`
függvény korábban egy fix, **abszolút** (`1e-6`) toleranciát használt az
"elfogadva"/"korrigálva" határon. Mivel a token-egyenlegek ezres `tick()`
összeadásokból épülnek fel, a float64-kerekítési eltérés a mérettel arányosan
(**relatívan**), nem fixen nő — egy valódi fiókot 5 egymást követő csendes
korrekció ért, mindegyik 2,4×10⁻⁶–8,4×10⁻⁶ abszolút túllépéssel egy ~10⁷
nagyságrendű egyenlegen (~10⁻¹³ relatívan) — ami az 5 korrekciós mintát
(a korábbi `SOFT_CLAMP_STRIKE_THRESHOLD`) elérve tényleges strike-hoz
vezetett. A `floatTolerance()` (`constants/antiCheat.ts`) mostantól a nagyobb
operandushoz relatívan (`1e-9`) skálázódik — a hat valódi, éles korrekciós
esetet visszajátszva mindegyik 1000×-es ráhagyással belefér az új
toleranciába.

Minden határ a **legkedvezőbb** feltételezéssel számol (max booster/kritikus
találat, legjobb kedvezmény), hogy egy szerencsés vagy erősen kedvezményezett
valódi játékos sose szoruljon korlátozásba. Kimenet:

| Eltérés | Hatás |
|---|---|
| a határon belül | elfogadás változatlanul |
| a határ 1×–2×-szerese közt | csendes korrekció a határértékre, `200`, `AntiCheatEvent` info-bejegyzés |
| a határ 2×-szerese fölött, vagy monotonitás-sértés | `409`, semmi nem íródik, azonnali *strike* (lásd 4. réteg) |
| ugyanez — vagy egy *érdemi* (material) korrekció — a fiók **első** mentésénél (nincs tárolt mentés, és a fiók sosem kapott strike-ot) | `409` `code: "save_first_unverifiable"`, semmi nem íródik, **nincs strike** — csak egy `first_save_reject` info-esemény |

Egy elutasított mentésre (`409`, `code: "save_implausible"`) a kliens 1.7.3 óta
**újratölti** a szerver utolsó ellenőrzött mentését (mint egy `save_stale`-nél),
ahelyett, hogy ugyanazt a haladást küldené újra — korábban minden korlátozás
lejártakor újabb strike jött ugyanarra (a 2026-10-20-i ban-hurok). A játékos csak
a nem mentett másodperceket veszíti; a szerver hiteles marad, az első strike
megmarad.

**Vendég → fiók.** Egy vendég a fiók létrehozása *előtt* játszik, így az első
mentése rendszerint több játékidőt hordoz, mint amennyi idős a fiók. Korábban
a burok ezt a fiók korától mérte, ezért minden vendég, aki a regisztráció előtt
tovább játszott, `elapsed_exceeds_wallclock` elutasítást és **strike-ot** kapott
(és minden további autosave újabbat — a büntetési létra mentés-törlésig vitte
volna). Most:

- Az első mentés `dt`-je `max(fiók kora, min(elapsedSeconds, 24 óra)) + CLOCK_GRACE_SECS`. A vendég játékideje nem tanúsított, ezért csak a plafonig hitelesítünk: egy hamisított első mentés így sem kaphat többet, mint egy eldobható fiók, amely ennyit egyszerűen *várt* (ugyanaz a burok, mint két mentés közt bármely hosszú szünet — autosave kikapcsolva ez ma is lehetséges), a ranglistán pedig legfeljebb 24 óra játékidőt állíthat. A plafon fölött a szokásos kétszintű ellenőrzés jár (2×-ig korrekció, fölötte elutasítás).
- **Vendég nem szerezhet fokozatot és nem vásárolhat a Tudományos pályán** (`usePrestige`, `useCareer`; a `PrestigePanel` gombja vendégnek „Védéshez jelentkezz be" és a bejelentkezést nyitja). Egy fokozatszerzés lenullázza a menetet, és a korábbi menetek csúcs-gazdaságát a szerver nem ismeri — a 72 órás szimuláció szerint egy fokozatot szerzett vendég első mentése ~10 óra után 45–800×-osan túllépte volna a bevétel-korlátot. Így a hitelesítendő vendég-haladás mindig **egyetlen menet**, amit a kiterjesztett `dt` pontosan fed (a valódi frontend-store-ral játszott 10 perces, 6 órás és 30 órás vendég-állapotok a `saveValidator.test.ts`-ben).
- Az első mentés elutasítása sosem strike: egy vadonatúj fióknak nincs mit veszítenie, egy csaló egyszerűen újra regisztrálna, így a strike csak becsületes játékost érne. Egy **érdemi korrekciót** igénylő első mentést (pl. 24–48 óra vendég-játékidő) szintén elutasítunk, nem írunk be korrigálva: a kliens a korrigált értékeket nem kapja meg, így a következő mentése újra a korrigálatlanokat küldené — az már nem első mentés, tehát strike lenne. Az „első mentés" feltétele: nincs tárolt mentés **és** a fiók `strikeCount`-ja 0 — egy a büntetési létra által törölt (5. strike) mentés után így nem válik minden további elutasítás ingyenessé. A kliens a `save_first_unverifiable` kódra (`isFirstSaveUnverifiableError`) megállítja a mentéseket (`saveStore.carryOverRejected`) és a nem bezárható `FirstSaveRejectedModal` két kiutat kínál: **játék folytatása vendégként** (kijelentkezés a haladás megtartásával, `saveStore.logout({ keepProgress: true })`) vagy **új kezdés a fiókkal** (`startAccountFresh`: nullázás és azonnali mentés).
- **Kijelentkezés = mentés, majd nullázás** (`saveStore.logout()`): előbb a `withSyncLock` flush-a menti az aktuális állapotot (ha ez nem sikerül, a játékos megerősítést kap: „Kijelentkezel mentés nélkül?"), aztán friss vendégként indul a játék. Így a vendég-haladás mindig fiók nélkül szerzett haladás — egy fiók fokozatai, PhD-jai és fája sosem „vándorolhat" egy következő fiók első mentésébe.
- A vendéget a `useGuestReminders` emlékezteti: amikor a függő PhD-nyeresége először éri el az 1, 5, 25, 125, … (×5) határt, egy „Bejelentkezés / Regisztráció" gombos értesítés jelenik meg (a `toastStore` opcionális `action`-nel bővült).

### 2. réteg — kliens-oldali bemenet-hitelesség

- **`event.isTrusted`**: `ClickerCircle.vue`, `UnitCard.vue`, `UpgradeTile.vue` és `usePrestige.ts confirmPrestige` mind az eredeti eseményből olvassák — egy szkript által `dispatchEvent`/`el.click()`-kel indított kattintás sosem ér célba, és `untrustedClicks`-ként számít a telemetriában.
- **Rejtett/fókusz nélküli dokumentum**: `document.hidden || !document.hasFocus()` → a kattintás el sem indul, még `untrustedClicks`-be sem számít (valódi bemenet fizikailag nem juthatna el egy rejtett laphoz).
- **Lenyomva tartott billentyű**: egy natív gombon a lenyomva tartott Enter minden operációs rendszer szintű ismétlése újabb (megbízható, `isTrusted`) kattintást váltana ki — eszköz nélküli auto-clicker az ismétlési rátán (Linuxon 100+/s is beállítható). A `ClickerCircle` ezért az ismételt (`repeat`) Enter/Space `keydown`-t elnyeli: csak egy új lenyomás számít.
- **Csendes burst-korlát**: 45 kattintás/másodperc fölött a kattintás eldobódik — nincs token, nincs jelzés, a játékos észre sem veszi.
- **Script-integritás és csali (honeypot)** (`utils/integrityChecks.ts`): natív függvények (`dispatchEvent`, `click`, `bind`, `setInterval`, `Date.now`) `toString()`-jét ellenőrzi `"[native code]"` jelenlétére — ezt a modul betöltéskor, még egy oldal-injektált szkript előtt menti el. Egy inert globális (`window.__zutiGame.addTokens`) és egy képernyőn kívüli, `aria-hidden`, nem tab-elérhető csapda-elem egyike sem érhető el valódi egér/billentyűzet/AT úton — bármelyik megérintése egyértelmű bizonyíték. Ezek a jelek **döntőek** (nem kell hozzájuk másik jel).
- **Pointer-fizika** (`utils/pointerPhysics.ts`), csak egérre: `getCoalescedEvents()` üres marad valódi mozgás mellett, `movementX`/`Y` nulla marad, miközben `clientX`/`Y` látszólag változik, vagy a nyomás (`pressure`) egyetlen nem-nulla értéken fagy — ezek a CDP-alapú automatizálás (Playwright/Puppeteer) jelei, amik `isTrusted: true` eseményt produkálnak, de elvesztik ezt a metaadatot. **Nem** döntőek önmagukban (lásd lent).

Sem WebGL, sem canvas-alapú ujjlenyomat-vétel nincs a rendszerben — ezeket a
tervezés kifejezetten kizárta adatvédelmi okokból.

### 3. réteg — szerver-oldali statisztikai verdikt (`POST /anticheat/report`)

A kliens 60 másodpercenként (az autosave-beállítástól függetlenül) és minden
döntő helyi detekció után azonnal beküld egy tömör, anonim digest-et
(`utils/clickTelemetry.ts`): egy 24 elemű, logaritmikusan skálázott
kattintás-köz-hisztogramot, a leghosszabb "metronóm-szerű" sorozatot,
kattintás-/vásárlásszámot, és a 2. réteg jelzéseit. **Sosem** tartalmaz
időbélyeget, koordinátát vagy eszköz-/böngésző-azonosítót.

A szerver (`services/antiCheat.ts`) először a digest önellentmondását nézi
(a hisztogram összege nem egyezik a kattintásszámmal, vagy a ráta meghaladja
a burok saját felső korlátját) — ez **biztos**, nem valószínűsített jel.
Utána a statisztikai jeleket súlyozza:

| Jel | Küszöb | Súly |
|---|---|---|
| `lowVariance` | variációs együttható < 0.12, ≥40 kattintás, ≥5 cps | 2 |
| `metronome` | leghosszabb közel-azonos-közű sorozat ≥30 | 2 |
| `narrowSupport` | a nem-üres hisztogram-mezők tartománya ≤2 | 2 |
| `unimodalSpike` | egyetlen mező a minták >90%-át adja | 1 |
| `uniformShape` | ferdeség < 0.15, tartomány ≤4 | 1 |
| `sustainedRate` | átlag >22 cps az egész ablakban | 1 |
| `singleMethodExceedsHumanLimit` | egyetlen mód (`primary`/`secondary`/`enter`/`space` — `touch`/`other` kizárva, lásd lent) adja a kattintások ≥95%-át, ÉS annak saját rátája >20 cps | 2 |
| `weak:*` (pointer-fizika) | lásd 2. réteg | 1/jel |
| `untrustedInput` / csali (`honeypot:*`) | bármelyik jelenléte | **az egyetlen**, ami korlátoz — azonnal |
| natív-felülírás (`patched:*`), önellentmondó digest | bármelyik jelenléte | csak naplózás (`flagged`) |

A `singleMethodExceedsHumanLimit` jel más okból szigorúbb, mint a
`sustainedRate`: az utóbbi az ÖSSZESÍTETT rátát nézi, aminek több egyidejű
bemeneti csatornát (pl. két ember, egér + billentyű) is el kell viselnie —
ezért 22 cps. Egyetlen bemeneti mód (pl. csak jobb klikk, ahogy egy hétköznapi
auto-clicker tenné) emberi felső korlátja viszont jóval alacsonyabb: a kutatás
szerint a hiteles, tartós egykezes kattintási rekord ~14–16 cps (Guinness:
12,67 cps hivatalos 2026-os rekord), a legszélsőségesebb dokumentált technika
("butterfly clicking", két ujjal ugyanazon a gombon) is csak ~32 cps
igazoltan / ~35–40 cps elméletileg (ideg-vezetési sebesség korlátozza) — és
ezek rövid versenyburst-ök, nem egy teljes perces tényleges játékmenet. A 20
cps-es küszöb bőséges tartalékot hagy még a szélsőséges technikáknak is,
mégis jóval az összesített 45 cps-es burok-plafon alatt marad.

Az Enter és a Space **külön** módként számít (`enter`/`space`), nem egy közös
"billentyűzet" kategóriaként — egy ember, aki mindkét billentyűt váltva
üti (pl. egy-egy ujjal), a két gomb kombinálásával simán majdnem
megduplázhatja azt a rátát, amit egyetlen billentyűvel elérne, pontosan
úgy, ahogy a bal/jobb egérgomb váltogatása is engedett. Ha ezt a két
billentyűt egy közös kategóriaként kezelné a rendszer, ez a teljesen
normális, két billentyűs váltogatás 100%-os koncentrációnak tűnne egyetlen
módban, és tévesen jelzésre kerülne. A
`methodCounts` mező (`utils/clickTelemetry.ts` / `services/antiCheat.ts`)
**opcionális** a digest-ben — egy régebbi, gyorsítótárazott kliens, amely még
nem küldi, sosem kap emiatt 400-at, csak ez az egy jel marad kiértékeletlen.
(Ez a tervezési döntés egy éles incidensből ered: a `windowMs` mezőt korábban
tévesen egész számként validálta a szerver, holott az egy törtrészt is
tartalmazó `performance.now()`-időtartam — emiatt minden valós heartbeat
400-at kapott, még mielőtt a detekciós logika egyáltalán lefutott volna. Egy
új, opcionális mezőt úgy bevezetni, hogy a hiánya elutasítást okozzon, ugyanezt
a hibaosztályt reprodukálná egy fokozatos kiadás közben.)

**Harmadik, éles környezetben talált incidens, ugyanennek a mezőnek a FELSŐ
korlátjából** (2026-09-21): egy háttérbe került fül vagy lezárt képernyő
(iOS/WebKit teljesen felfüggeszti a `setInterval`-t háttérben) miatt a
`windowMs` a felfüggesztés teljes hosszát hordozza, `clicks: 0` mellett — ez
"banned for opening the prestige modal for a few seconds" tünetként jelent
meg egy teljesen tétlen játékosnál. A `windowMs > MAX_DIGEST_WINDOW_MS` eset
korábban ugyanabba a `malformed_digest` (`consistent: false`) kategóriába
esett, mint egy valóban rossz alakú body, és a `processDigest`
(`database/models/antiCheat.ts`) minden ilyen inkonzisztenciát **azonnal**
büntetett, két egymást követő ablak nélkül. A `DigestVerdict` mostantól
külön mezőt is hordoz: `scoreable: false` jelenti, hogy a digest NEM
bizonyíték semmire (sem a hiányos/rossz alakú body, sem egy felfüggesztett
ablak) — ez sosem strike-ol, de egy valódi jelzett sorozatot sem "mos"
tisztára (a `suspicionScore` érintetlen marad). Egy `consistent: false`
(hisztogram-összeg vagy ráta önellentmondás) **továbbra is azonnal döntő** (1.7.2 óta már nem — lásd lent, „csak biztos bizonyíték korlátoz”),
pontosan úgy, mint korábban — ez a rész maga nem volt hibás, csak a
"strukturálisan rossz alakú" (`malformed_digest`) esettel volt egy közös
kategóriában a `windowMs` felső korlátjával együtt. (Egy önellenőrző
kódátvizsgálás ezt a fixet menet közben ideiglenesen a szokásos
két-ablakos szabály alá helyezte volna át, azzal az indokkal, hogy
ugyanaz az "adj egy esélyt felépülni" elbánás jár neki, mint egy
statisztikai jelnek — de ez valódi kikerülési rést nyitott volna: egy
inkonzisztens és egy tiszta digest felváltva küldve minden második
ablakban nullázta volna a gyanú-számlálót, így a minta sosem érte volna
el a kettőt, és sosem strike-olt volna. A javítás előtt ez ki lett
zárva.) A zéró-hamis-pozitív jelek (`untrustedClicks`, `integrityFlags`)
kiértékelése emellett most szándékosan a `windowMs`-felső-korlát ellenőrzés
ELŐTT fut — egy hamisított kérés, ami MINDKETTŐT egyszerre állítja be
(valódi hamisítás bizonyítékát ÉS egy túl nagy `windowMs`-t), a régi
sorrendben a felső-korlát ágon "unscoreable"-ként tűnt volna el, mielőtt a
döntő jel egyáltalán kiértékelődött volna — egy `windowMs` értéket viszont
egy valódi kliens szemben egy `integrityFlags`/`untrustedClicks` jellel
semmilyen költséggel nem tud hamisítani, úgyhogy ez egy valós, bár szűk,
kikerülési rés lett volna. A kliens (`stores/antiCheatStore.ts`) emellett
most már egyáltalán el sem küldi az ilyen ablakot — a
`MAX_DIGEST_WINDOW_MS`-nél hosszabb ablakot csendben újraindítja —, és egy
`visibilitychange` figyelő (`composables/useAntiCheat.ts`) az előtérbe
kerülés pillanatában is újraindítja, hogy a következő ablak valódi,
folytonos méréssel induljon.

**Negyedik, éles környezetben talált incidens ugyanebből a mezőből**: a
"hiánya sosem utasít el" szabály önmagában nem volt elég — egy **jelen lévő,
de elavult alakú** `methodCounts` (pl. egy gyorsítótárazott régi kliens, ami
még a `keyboard` mezőt küldi az `enter`/`space` szétválasztása előttről) a
teljes digestet érvénytelenítette, nem csak ezt az egy jelet hagyta ki —
pontosan ugyanaz a hibaosztály, csak a "hiányzik" eset helyett a "jelen van,
de rossz alakú" esetre. A `sanitizeMethodCounts` (`services/antiCheat.ts`,
az EGYETLEN közös implementáció, amit a `controllers/anticheat.ts` importál)
ezért sosem dob el semmit emiatt. Mostantól **mezőnként** is toleráns, nem
csak alak-szinten: minden ismert mezőt (`primary`/`secondary`/`enter`/
`space`/`touch`/`other`) egyenként fogad el (jelen van és érvényes egész
szám → érték; hiányzik vagy hibás → 0), és csak egy teljesen nem-objektum
érték esetén ad vissza `undefined`-et (ekkor ez az egy jel marad
kiértékeletlen, minden más jel lefut). Ez az eredeti javítás általánosítása:
egy jövőbeli új bemeneti mód hozzáadása nem igényel újabb, saját
`methodCounts`-alak-incidenst.

`touch`/`other` bemeneti mód (2026-09-21): a kliensben korábban nem volt
`pointerType`-ellenőrzés — minden érintés (`pointerdown`, `button: 0`) úgy
került a szerverre, mintha bal egérgomb lenne (`primary`), ami egy mobil
játékost örökre ~100%-os egyetlen-mód-koncentrációba kényszerített, miközben
a `SINGLE_METHOD_MAX_CPS` (20 cps) EGÉR-kattintási kutatásból származik,
nem érintőképernyőből. A `ClickerCircle.vue` mostantól `pointerType`
alapján `"touch"` módként jelöli az érintést/tollat, ami a
`singleMethodExceedsHumanLimit` jel `dominant` (a kapott-módszám) számításából
KI van zárva — a `methodTotal` viszont továbbra is tartalmazza, hogy egy
valódi vegyes (egér+érintés) munkamenet helyesen hígítsa a koncentrációt.
`other` mód egy olyan aktivációt jelöl, amit a kliens nem tud konkrét
billentyűhöz kötni (`MouseEvent.detail === 0`, nincs megelőző `keydown` —
pl. VoiceOver dupla-koppintás) — korábban ez tévesen egy fantom `"enter"`-ként
íródott (a `lastKeyMethod` régi alapértéke), ami olyan billentyűlenyomást
jelentett, ami sosem történt meg.

**Tudatosan vállalt kockázat**: mivel `methodCounts` a kliens saját, nem
ellenőrizhető állítása, egy módosított kliens vagy közvetlen API-hívás
tetszőleges kattintást bejelenthet `touch`/`other` módként, hogy elkerülje
a `singleMethodExceedsHumanLimit` jelet — ez nem új típusú gyengeség (a
`primary`/`secondary`/`enter`/`space` szétosztása ugyanígy kijátszható
volt már korábban is, lásd a "több módra szétosztva" tesztet), de a
kizárás miatt egyetlen címke elég hozzá, nem kell szétosztani a
kattintásokat több hamis mód között. Ez a döntés a tervezés során
tudatosan, a felhasználó explicit jóváhagyásával született (a
"legfeljebb saját, kutatás nélküli plafon" és a "maradjon `primary`-ként"
alternatívák helyett) — az aggregált 45 cps burok és a többi statisztikai
jel (nem csak `methodCounts`-ra épülő) továbbra is fedezi ezt az esetet.

Egy verdikt csak **legalább 3 pontnál és legalább 2 különböző jelcsoportnál**
számít jelzettnek — a nyers kattintás-ráta önmagában (súly 1) sosem érheti el
egyik küszöböt sem. Ez szándékos: két ember, aki felváltva/együtt kattint
ugyanazon a fiókon (egér + szóköz + enter), simán elérhet ~25–30 cps-t
természetes szórással, széles hisztogram-tartománnyal és valódi fáradási
görbével — ez legfeljebb a `sustainedRate` jelet adja, ami önmagában sosem
elég. Egy valódi auto-clicker ezzel szemben a variancia/tartomány/sorozat-
hosszúság jeleken bukik el, jóval a ráta figyelembevétele előtt.

**1.7.2 óta csak biztos bizonyíték korlátoz** (`processDigest`,
`database/models/antiCheat.ts`): egy böngésző által nem megbízhatónak
jelölt kattintás (`isTrusted: false` — szkript küldte; minden kattintás-kezelő
az eredeti eseményt ellenőrzi) vagy egy csali-találat (a rejtett csapda-gomb,
a hamis `window.__zutiGame.addTokens`). Minden más, amit ez a réteg számol — a
statisztikai időzítési jelek, egy önmagának ellentmondó digest, egy nem natív
natív függvény — **csak naplózódik** (`statistical_digest` /
`digest_inconsistent`, `severity: "info"`, a `detail.flagged` mutatja, mit
jelzett volna a régi szabály), sosem strike. Ok: mindhárom ért már becsületes
játékost élesben — egy gyors, egyenletes emberi kattintó (a vezető játékos
2026-10-20-án szinte minden heartbeat-ben két gyenge jelet adott, és egy
jelzett ablakkal már csak egy választotta el a strike-tól), négy kliens-oldali
digest-hiba (2026-09-21-én egy fiók négy strike-ot és mentés-nullázást kapott
egy rossz alakú digest miatt), illetve böngésző-bővítmények (reklámblokkoló
szkriptletek, ujjlenyomat-védő kiegészítők) jogosan írják felül a vizsgált
natív függvényeket. Egy auto-clicker bevételét a mentés-burok kattintás- és
bevétel-korlátja továbbra is lekorlátozza. A vendég helyi korlátozása
(`antiCheatStore`) ugyanezt a szabályt követi: csak csali-találat vagy nem
megbízható kattintás. A strike oka (`lastStrikeReason`) ilyenkor
`certain_evidence`.

### 4. réteg — büntetési létra és korlátozás

| Strike | Korlátozás hossza |
|---|---|
| 1 | 1 perc |
| 2 | 15 perc |
| 3 | 2 óra |
| 4 | 24 óra |
| 5 | **mentés nullázása** (a `GameSave` sor törlődik) + 24 óra |
| 6+ | 24 óra, ismétlődik |

Nincs végleges kitiltás. A strike-szám 30 egymást követő tiszta nap után
szintenként csökken (`AntiCheatState.lastCleanAt`), ami egyben a felhalmozott
csendes-korrekció/gyanú-számlálókat is nullázza — egy hosszú tiszta időszak a
kisebb gyanújeleket is eltörli, nem csak a formális strike-okat.

**Csendes-korrekció minta — ablak és lényegesség** (`recordSoftClamp`,
`database/models/antiCheat.ts`, 2026-09-21): `SOFT_CLAMP_STRIKE_THRESHOLD`
(korábban 5, mostantól 10) csendes korrekció eszkalál strike-ká — de ennek a
számlálónak korábban SEM időablaka nem volt (bármely 5 korrekció valaha,
akármilyen távol egymástól, eszkalált), SEM lényegességi szűrője (minden
korrekció számított, akkor is, ha az eltérés puszta float64-kerekítési zaj
volt). Egy valódi fiókot pontosan ez a hiány ért: 5 egymást követő
korrekció, mindegyik 10⁻¹³ nagyságrendű relatív eltéréssel, strike-ká
eszkalált. A `checkBound` (`services/saveValidator.ts`) mostantól minden
korrekciónál jelzi, hogy az eltérés **lényeges** volt-e (a határ
`SOFT_CLAMP_MATERIAL_RATIO`-nál, 0,1%-nál, nagyobb hányadával haladta-e meg)
— egy nem lényeges korrekció sosem számít a mintába, akárhányszor
ismétlődik. A számláló emellett egy valódi, `ANTICHEAT_STATE_WINDOW_HOURS`
(24 óra) hosszú, gördülő ablakban él (`AntiCheatState.softClampWindowStartedAt`
— ez a konstans már korábban is létezett, de sosem volt bekötve) — egy
lényeges korrekció az ablakon túlról már nem adódik hozzá egy új mintához.
A `lastCleanAt` mezőt egy korrekció mostantól **nem** írja felül (korábban
minden korrekció `now()`-ra állította) — ez blokkolta a 30 napos
strike-lecsökkenési órát bármely, valaha korrigáló fiók esetén.

A `requireNotRestricted` middleware (`middlewares/index.ts`) a `PUT /save`-t,
a `POST /boosters/claim`-et és a `POST /upgrader/spin`-t zárja le aktív korlátozás alatt — a
`GET /save` és a `DELETE /save` szándékosan **nem** záródik le (a korlátozott
játékos továbbra is látja a saját állapotát, és törölheti is a mentését, ha
úgy dönt). Csak `ANTICHEAT_MODE=enforce` alatt aktív; `monitor`/`off` alatt
nincs mit lezárni, mivel korlátozás azokban sosem íródik.

A ranglistán (`GET /leaderboard`) egy aktívan korlátozott játékos ki van
zárva mások nézetéből — pontosan addig, amíg a korlátozás tart, utána nincs
tartós kizárás (`database/models/leaderboard.ts`'s `visibleFilter`).

Minden verdikt (döntő és statisztikai egyaránt) egy `AntiCheatEvent` sorba
naplózódik — beleértve a `monitor` módban elfojtottakat is (`enforced:
false`) —, ez teszi lehetővé a küszöbök éles forgalom elleni hangolását
anélkül, hogy bármit is élesben ki kellene próbálni.

### `ANTICHEAT_MODE` — fejlesztői kapcsoló

`enforce` (alapérték) | `monitor` (validál és naplóz, sosem blokkol vagy
korrigál — lásd fent, "Tesztek futtatása") | `off` (a teljes burkot kihagyja,
egy nyers API-kliensből végzett helyi teszteléshez). `NODE_ENV=production`
alatt mindig `enforce`-ra kényszerül, hangos figyelmeztetéssel, függetlenül
attól, mi van kérve — egy hibásan konfigurált deploy, ami csendben
anti-cheat nélkül fut, sokkal rosszabb, mint egy hangos felülbírálás.

A ténylegesen feloldott mód minden indításkor kiíródik a szerver saját
logjába (`ANTICHEAT_MODE resolved to "..."`) — enélkül nincs mód
megkülönböztetni "a helyi `.env`-be írt érték nem ért célba" és "a mód
tényleg más, mint vártam" esetét, ami valós debug-időt vett el, mielőtt ez a
sor bekerült.

### Boosterek

A boosterek közvetlenül a ranglistákat torzíthatnák (aki gyakrabban tud
"booster-farmolni", végérvényesen jobb statisztikákat ér el), ezért ez a
rész — a fenti négy rétegtől függetlenül, már a projekt korábbi állapotában
is — **kizárólag szerver-hiteles**:

- A `PUT /save` **sosem fogad el aktív booster állapotot** — a `GameSave`
  modellben az `activeBoosters` reláció csak a `POST /boosters/claim`
  végponton keresztül írható.
- A `POST /boosters/claim` **nem fogad kérés-törzset**: a szerver saját maga
  választja ki a boostert (súlyozott véletlen, `constants/boosters.ts`), és
  a saját órájából számítja ki a lejárati időt. A kliens nem választhat jobb
  boostert, és nem hosszabbíthatja meg a sajátját.
- A lehűlési idő (`GameSave.nextBoosterAt`) az egyetlen kapu: egy igénylés
  csak akkor sikeres, ha `most >= nextBoosterAt`. Sikeres igénylés után a
  szerver egy új, `60`–`300` másodperc közötti véletlen intervallumra
  állítja be ezt a mezőt. Az ismételt, gyors igénylés-spam így legfeljebb
  ugyanannyi boostert eredményez, mint a szabályos játék — nincs külön
  "spawn ablak", nincs órakülönbség-kezelés, egyetlen összehasonlítás elég.
- A kliens **sosem lát abszolút lejárati időt** — a válaszok (és a
  `GET /save` `activeBoosters` mezője is) `remainingMs`-t adnak vissza, amit
  a kliens a saját órájához rögzít (`gameStore.grantBooster`,
  `loadFromSave`). Egy órakülönbség így nem hosszabbíthatja meg a bónuszt.
- Egy kihagyott pickup semmibe sem kerül, csak időbe — a lehűlés csakis egy
  sikeres igényléskor változik.

**Elfogadott, dokumentált korlát**: a `conferenceBadge`/
`departmentNewsletter` fejlesztések hatását (booster-időtartam, illetve
-lehűlés csökkentése) a szerver a játékos saját (kliens által állított, de
szerveren tárolt) `UpgradeSave` sorai alapján olvassa vissza. Egy hamisított
fejlesztés-birtoklás így legfeljebb azt éri el, amit a játékos amúgy is
jogszerűen megvehetett volna — ez korlátozott és arányos kockázat, a teljes
lezárásához a kattintás-gazdaság szerver-hitelessé tétele kellene, ami nem
része ennek a változtatásnak.

A frontend oldalon a `composables/useBoosters.ts` felelős a pickup
megjelenési ütemezéséért (mindig kliens-oldali becslés, súlyozott ugyanúgy,
mint a szerver saját elosztása) és az igénylésért; részletek a fájl saját
kommentjeiben.

### Az Upgrader (PhD-kerék)

A játékos tetszőleges számú PhD-t tesz fel egy kerékre, egy választott szorzóval (×1,2–×100, legfeljebb 2 tizedesjeggyel). Nyerésnél `floor(tét × szorzó)` PhD-je lesz a tét helyett; vesztésnél a tét elvész, és vigaszdíjként egy **Értékelési Roham** (`frenzy`, ×7 termelés) booster-t kap. Az első PhD-*sink* a játékban: eddig a PhD csak nőhetett.

**Miért szerver-hiteles.** Az 1. réteg a `phdCount`-ot monoton növekvőnek, és a prestige-ekből felülről korlátozottnak tekintette. Egy kliensben eldöntött pörgetés mentése ezért vesztéskor monotonitás-sértés (409 + strike), nyereményként pedig a PhD-korlát lenyesné. A kimenetelt tehát — a boosterekhez hasonlóan — a szerver dönti el: `POST /upgrader/spin` (`isAuthenticated` + `requireNotRestricted`), a kliens csak `{ stake, multiplier }`-t küld.

**Esély és kifizetés** (`api/src/services/upgrader.ts`, a frontend `utils/upgrader.ts` kézzel tartott tükre). Kizárólag egész számokkal számol, mert `100 × 4,35` lebegőpontosan `434,99999999999994`, a `floor()` így 435 helyett 434-et fizetne. A szorzó először egész századdá alakul (`toHundredths`: legfeljebb 2 tizedes, 1,2–100), onnan `payout = floor(tét × század / 100)` és `winPpm = min(800 000, floor(900 000 × tét / payout))` (BigInt; ppm = milliomod). A lefelé kerekítés miatt a valós megtérülés legfeljebb 90%, sosem több; a nyerési esély sosem haladja meg a 80%-ot (pl. 9 PhD ×1,2: korlát nélkül 81% lenne). Érvénytelen a fogadás, ha `payout ≤ tét` (pl. 1 PhD ×1,5 → 1 — a „nyeremény" nem hozna semmit); a legkisebb érvényes tét `ceil(100 / (század − 100))` (a frontend `minStake`).

**Szerver-oldali elszámolás** (`database/models/upgrader.ts`), egyetlen tranzakcióban:

1. `SELECT … FOR UPDATE` — **zároló** olvasás, nem sima `findUnique`. A tranzakció sima olvasása a saját kezdeti pillanatfelvételét látja, amely nem látja egy párhuzamos tranzakció commit-ját: a versenyben alulmaradó pörgetés rossz hibát kapott (méréskor 60 párhuzamos vesztesből 48 „túlcsordulást"), és elavult egyenleget jelentett. A zárolt olvasásnál a párhuzamos pörgetések sorba állnak, és mind az előző által hagyott egyenleget látja.
2. Fedezet: `phdCount < tét` → `409` `INSUFFICIENT_PHD`, a válasz a **valós** egyenleget is tartalmazza.
3. Túlcsordulás-előszűrés a dobás **előtt**, sima aritmetikával: ha egy nyeremény a `phdCount`, a `phdTotal` vagy az `upgraderNet` pontosan tárolható tartományán (`2^53 − 1`, lásd „Tudományos pálya” → a PhD-oszlopok szélesítése) túlra vinné → `409` `LIMIT_REACHED`. Egy pörgetés tétje legfeljebb `2 147 483 647` (`UPGRADER_MAX_STAKE`). Így a válasz sosem függ a szerencsétől, és tartományon kívüli érték sosem jut a Prismáig.
4. `crypto.randomInt(0, 1 000 000)`; nyer, ha `roll < winPpm`. A válasz a `rollPpm`-et és a `winPpm`-et is tartalmazza, így a kerék pontosan a szerver dobására áll rá — nincs megrendezett „majdnem".
5. Feltételes `updateMany` (`WHERE phdCount >= tét`): a `phdCount`, az `upgraderNet` és az `upgraderSeq` növelése. A sor már zárolt, ez egy második, független garancia.
6. Vesztésnél vigaszdíj (lent).

Az újrapróbálkozás (`withWriteConflictRetry`) új dobást jelent, ami biztonságos: a visszagörgetett tranzakció semmit nem írt, a kliens az első dobást sosem látta.

**Vigaszdíj.** A hossza **szigorúan arányos** a feltett PhD-k hányadával (`tét / phdElőtte × 60 s`), **minimum nélkül**; 1 másodperc alatt nem jár. Egy review találta meg, miért kell: a korábbi 10 s-os minimummal 1 PhD ismételt feltétele (a booster-lehűlést megkerülve) kb. 0,6 PhD/perc áron tartotta volna a játékost szinte folyamatosan ×7 termelésben. Szigorúan arányosan egy másodperc roham várható ára csak a PhD-készlet nagyságától függ, ezért nincs mit farmolni. Egy futó rohamot meghosszabbít, de a hátralévő idő legfeljebb 120 s, és sosem rövidít; a ×7 szorzó a burok `MAX_PRODUCTION_BOOSTER_MULTIPLIER` határán belül marad.

**Két új `GameSave` oszlop** (additív, `NOT NULL DEFAULT 0`; a `20261001071241_add_upgrader` migráció): `upgraderNet` (a `payout − tét` előjeles összege az összes pörgetésen), `upgraderSeq` (pörgetés-számláló). Kizárólag a `POST /upgrader/spin` írja őket.

**Hogyan illeszkedik a `PUT /save`-hez:**

- **Elavult-írás védelem.** Egy pörgetés közvetlenül az adatbázisba írja a PhD-változást; egy már úton lévő vagy másik lapról érkező mentés ezt felülírhatná (egy vesztés után „visszahozhatná" az elvesztett PhD-ket). Ezért a `PUT /save` az `upgraderSeq`-et visszaküldi (lásd fent), eltérésnél `409 save_stale`. Az ellenőrzés a vezérlőben a burok **előtt** fut: a burok PhD-korlátja ugyanis már tükrözi a pörgetést, így egy elavult, magasabb egyenleg hamis strike-ot okozna egy becsületes játékosnak. Az `upsertSave` `UPDATE`-je ugyanerre a számlálóra feltételes (a vezérlő-beli ellenőrzés és az írás közti ablak bezárására; `ANTICHEAT_MODE=off` alatt ez az egyetlen védelem). Következmény: ha a fiókon már volt pörgetés, egy a funkció előtti kliens-bundle minden mentése `409`-et kap, amíg a lap újra nem töltődik.
- **A burok PhD-korlátja** `√(prestige × összes / SCALE) + PHD_BOUND_SLACK + upgraderNet`, alulról 0-ra korlátozva: a birtokolt PhD = prestige-ből szerzett (≤ a Cauchy-korlát) + a kerék nettója. Egy nettó vesztes korlátja szűkül, így a kerék által elvett PhD-ket mentéssel nem lehet visszaigényelni.

**Kliens-szerződés** (ettől függ, hogy a burok többi ellenőrzése — kiadás, bevétel — igaz maradjon): a pörgetés közvetlenül az adatbázisba ír, ezért ezek az ellenőrzések csak akkor korrektek, ha az előző mentés a pörgetés előtti állapotot már tartalmazza. Ezt a kliens garantálja:

1. `saveStore.withSyncLock` először **elmenti** a jelenlegi állapotot (ennek sikerülnie kell, különben a pörgetés el sem indul), majd a pörgetés alatt minden más mentést (autosave, kézi, fokozatszerzés utáni) visszatart, és az eredmény alkalmazása után egyszer, az akkori állapottal engedi el.
2. `gameStore.spinPending` az előzetes mentés előtt bekapcsol, és az eredmény alkalmazásáig tiltja a vásárlást és a fokozatszerzést — különben a mentés után, a régi PhD-kedvezménnyel vett egység a szervernek úgy tűnne, mintha a legolcsóbb árnál is kevesebbért vették volna.
3. Az eredmény (PhD-egyenleg + számláló + vigaszdíj) **azonnal** a `gameStore`-ba kerül, amint a szerver válaszol, így a kliens gazdasága ugyanattól a pillanattól egyezik a szerverével. A PhD-kijelzők (`phdCountDisplay`) viszont a kerék megállásáig a régi értéken maradnak (`phdDisplayHold`), hogy a háttérben látszó szám ne árulja el az eredményt.
4. A szerver válaszából a `phdCount`-ot átvesszük, nem számoljuk újra (`applySpinResult`). Egy mentés, amely a pörgetés előtt egy másik lapon elavulttá vált, `save_stale`-t kap, a kliens újratölt és szól a játékosnak.

**Elfogadott, dokumentált korlátok**: (a) a flush és a szerver-válasz közti kérés-késleltetésnyi ablakban a kliens a régi PhD-szorzóval termel — ezt a burok `×1,5` margója és a `×7` booster-tartalék bőven elnyeli, kivéve extrém, 50 000 feletti PhD-arányokat; (b) a vendég helyben, ugyanazzal a képlettel pörget (`settleSpin`), mert nincs szerver-állapot, amit védeni kellene — az eredmény viszont **nem megy át a fiókra**: a szerver nem tud róla, így az első mentés (előzmény nélkül, `upgraderNet = 0`) a keréken nyert PhD-ket hamisítottnak olvasná (és strike-ot adna egy becsületes játékosnak), a vendég helyi számlálója pedig sosem egyezne egy új fiók `0`-jával (végtelen `save_stale` ciklus). Ezért a vendég pörgetései nem növelik az `upgraderSeq`-et, a nettó eredményüket a `gameStore.guestUpgraderNet` tartja, és bejelentkezéskor a `saveStore` egy figyelője levonja (`forfeitGuestSpins`, a nyereséget és a veszteséget egyaránt) és szól a játékosnak; (c) egy **bizonytalan kimenetelű** pörgetés (időtúllépés, megszakadt kapcsolat, 5xx, olvashatatlan válasz) után a szerver *lehet*, hogy már elszámolta a pörgetést — a kliens ezért nem feltételez semmit: „nem tudtuk megerősíteni" üzenetet ad és újratölti a szerver állapotát (`useUpgrader.reportFailure`). A pörgetés (15 mp) és a mentés (20 mp) kérése időtúllépést kap (`lib/api.ts`), hogy egy elakadt kérés ne tarthassa a `spinPending` tilalmat (vásárlás, fokozatszerzés) a böngésző saját, több perces időtúllépéséig; egy pörgetés közben törölt/nullázott mentésre (`gameStore.resetEpoch`) késve érkező eredményt sem írja a friss játékra; (d) ha az éles image-et egy régebbi verzióra állítják vissza, miután játékosok már pörgettek, a régi burok nem ismeri az `upgraderNet`-et, és a nyertesek/vesztesek mentéseit hamisan korrigálhatja vagy elutasíthatja (strike!) — visszaállás után futtasd a `reset:anticheat-state` scriptet az érintett fiókokra (lásd lent, "Visszaállás egy korábbi verzióra").

**Tesztek.** `api/src/tests/upgrader-parity.test.ts` / `frontend/src/utils/__tests__/upgrader-parity.spec.ts` a közös, kézzel számolt `upgrader-vectors.json` táblát ellenőrzi (byte-azonos másolat mindkét oldalon); `upgrader.test.ts` és `upgraderSave.test.ts` a végpontot és a mentés-integrációt, utóbbi saját `enforce` és `off` szerverpéldánnyal. A párhuzamossági teszt szándékosan ×1,2-vel (75%) pörget: egy vesztő pörgetés egy booster-sort is ír, aminek holtpont-majd-újrapróbálás viselkedése elfedné egy hiányzó egyenleg-védelmet, a nyerő ág viszont nem.


### Tudományos pálya (Academic Career — a végleges PhD-fa)

A PhD-k második, **végleges** felhasználási módja: egy ~250 csomópontos fa, amelynek csomópontjait PhD-ért lehet megvenni, és amelyek a fokozatszerzést is túlélik. A fa az első fokozatszerzés után válik láthatóvá (`prestigeCount ≥ 1`, egyirányú feltárás), vásárolni azonban **csak a fokozatszerzés után nyíló vásárlási ablakban** lehet. Egy befektetett PhD már nem „birtokolt": elveszti a +2% termelés / −0,5% egységár bónuszát — ez a valódi döntés (megtartani vagy befektetni).

**A katalógus** (`services/careerCore.ts` ↔ `frontend/src/utils/careerCore.ts`, **byte-azonos** másolat, ezért nincs benne import): egy gyökér (`habilitation`) és hat ág (Kutatás, Oktatás, Adminisztráció, Konferenciák, Disszertáció, Labor). Minden ág kulcscsomópontok (keystone) láncából áll, ezekről lógnak a többfokozatú sávok (track, `Pályázatírás I…X`). Minden csomópont **pontosan egy** módosítót ad (`kind` + `value` + opcionális `target`). Minden ár és érték **egész szám**: az árak egész aritmetikával (`costAtLevel`: a szint első hat lépése ×1,6, utána ×2,65, felfelé kerekítve), a módosítók bázispontban (1 bp = 0,01%) — se `Math.pow`, se `Math.log`, mert azok JS-motoronként az utolsó bitben eltérhetnek, egy ár vagy egy `floor()` pedig nem térhet el a kliens és a szerver között. A katalógus **csak bővíthető**: egy csomópont-azonosítót sosem szabad átnevezni vagy törölni (a `CareerNodeSave` sorok hivatkoznak rá); egy kivezetett csomópontot az aggregátor és a `GET /save` figyelmen kívül hagy.

**Módosítók** (`getCareerModifiers`, a katalógus rögzített sorrendjében iterál, sosem a bemenet sorrendjében — a lebegőpontos szorzás nem asszociatív, az adatbázis sorrendje pedig tetszőleges): termelés (globális %, szorzó, egységenkénti szorzó, PhD-nkénti extra bónusz), kattintás (szorzó, szinergia, kritikus esély és szorzó, **előadói lendület**), árak (egység- és fejlesztéskedvezmény, magasabb PhD-kedvezmény-plafon), **fokozatszerzéskor megmaradó dolgok** (egységek %-a, fejlesztéscsaládok, kezdőtőke), boosterek (időtartam, gyakoriság, begyűjtési ablak, erősség, két új booster: `windfall` és `critStorm`), PhD-nyereség (%), **automatizálás** (demonstrátor auto-kattintás, automatikus egység- és fejlesztésvásárlás). Minden összegzett értéknek plafonja van (`CAREER_CAPS`; a teljes fával is tartaniuk kell — mindkét oldal katalógus-tesztje ellenőrzi): pl. az egységár-szorzó sosem megy `0,1` alá, a kezdőtőke legfeljebb `PHD_TOKEN_SCALE` (így a `tokens ≤ totalTokensEarned` állapotmentes ellenőrzés becsületes játékosnál sosem sérülhet).

**Új mechanikák:**

- *Előadói lendület* — folyamatos kattintás egy 0–1 közti mérőt tölt (`MOMENTUM_PER_CLICK`), ami `MOMENTUM_GRACE_MS` szünet után fogy; a kattintás értéke `× (1 + momentumMax × mérő)`. Kizárólag kliens-oldali, a burok a teli mérőt feltételezi.
- *Demonstrátorok* — automatikus kattintások másodpercenként, egy sima kattintás értékével (nincs kritikus találat, lendület, kattintás-booster). **Csak bevétel**: a `tick()` írja jóvá, sosem a `clickToken()`, ezért nem kerül a `totalClicks`/`runClicks` számlálóba és a kattintás-telemetriába sem (egy 10/s-os időzítő a statisztikai verdikt szemében metronóm lenne → strike).
- *Automatikus vásárlók* (`useAutoBuyer`, `autoBuyStore` — a ki/be kapcsoló csak ebben a böngészőben, localStorage-ban él) — ugyanazon a `buyUnit`/`buyUpgrade` úton vásárolnak, mint egy kattintás, így minden korlátozás érvényes rájuk; nyitott vásárlási ablak vagy függő szerver-művelet alatt semmit nem vesznek.
- *Fokozatszerzéskor megmaradó dolgok* — a `prestige()` az **akkor birtokolt** csomópontok szerint dolgozik: egységenként `floor(birtokolt × bp / 10000)` marad, a megtartott családok fejlesztései maradnak (a `booster` család a két booster-fejlesztést jelenti), a menet a kezdőtőkével indul (csak `tokens`, **sosem** `totalTokensEarned`/`runTokensEarned` — nem kereset). Egy ablakban vett ilyen csomópont tehát a *következő* fokozatszerzéstől hat (a panel kiírja).
- *Új boosterek* — `windfall` (azonnali jóváírás: `windfallSecs` másodpercnyi **boostolatlan** termelés) és `critStorm` (+50% kritikus esély 30 mp-ig). Az alap három booster azonosítója, súlya és időtartama változatlan.

**A vásárlási ablak.** Csak a `PUT /save` nyitja, a szerver maga állapítja meg: ha a mentés (esetleg korrigált) `prestigeCount`-ja nagyobb a tároltnál **és** a `phdCount` is nőtt (egy becsületes fokozatszerzés mindig legalább 1 PhD-t hoz, és két mentés között más nem csökkentheti a `phdCount`-ot — minden más PhD-változás szerver-oldali és már a tárolt sorban van), akkor `careerWindowOpen = true` és `careerWindowId++`. Egy első mentés, amely már fokozatszerzést hordoz, ugyanígy nyit. Minden ablaknyitás új azonosítót kap, ezért egy újabb fokozatszerzés az előző ablak vásárlásait véglegessé teszi, sorok átírása nélkül (`CareerNodeSave.boughtInWindow` ≠ aktuális azonosító). Az ablak a `POST /career/close`-ig marad nyitva (Kihagyás / Kész) — újratöltés és másik eszköz után is —, kivéve, ha egy mentés azt mutatja, hogy az új menet már elindult (`runClicks > 0`, vagy `runSeconds > CAREER_WINDOW_RUN_GRACE_SECS`): ilyenkor a szerver zárja be. A kliens ugyanis az ablak alatt **megállítja a játékot** (`tick()` és kattintás nem csinál semmit, booster nem jelenik meg, fokozatot sem lehet szerezni); e nélkül egy „fokozatszerzéskor" vett csomópontot egy egész menetre lehetne használni, majd a következő előtt teljes áron visszaváltani.

**Végpontok** (`router/career.ts`, `controllers/career.ts`, `database/models/career.ts`), mind szerver-hitelesek, az Upgrader mintájára: zároló `SELECT … FOR UPDATE` a `GameSave` soron (mindig a `GameSave` előbb, a gyerek-táblák utána — egységes zárolási sorrend), validálás minden írás előtt, `withWriteConflictRetry`:

| Végpont | Mit csinál | Hibák |
|---|---|---|
| `POST /career/buy { nodeId }` | levonja az árat, `phdInvested`-et növeli, `upgraderSeq++` | `400 INVALID_NODE` (ismeretlen azonosító, `Map`-keresés, így `__proto__`/`toString` sem talál), `404`, `409 WINDOW_CLOSED`/`ALREADY_OWNED`/`PREREQUISITE_MISSING`/`INSUFFICIENT_PHD` |
| `POST /career/refund { nodeId }` | a csomópontot és **minden birtokolt leszármazottját** visszaváltja a ténylegesen fizetett áron (`refundClosure`), `upgraderSeq++` | `409 WINDOW_CLOSED`/`NOT_OWNED`/`NOT_REFUNDABLE` (korábbi ablakból) |
| `POST /career/close { windowId? }` | bezárja az ablakot; idempotens; korlátozott fiókkal is megy (semmit nem ad); `upgraderSeq`-et **nem** növeli | `409 WINDOW_CHANGED`, ha közben újabb ablak nyílt |

Minden `409` `code`-ot és a fiók valós karrier-állapotát hordozza (a kliens átveszi). A `GET /save` és a `PUT /save` válasza `career` mezőt kap (ablak + csomópontok `refundable` jelzéssel); a `PUT /save` sosem olvas karrier-mezőt a kérésből.

**Adatbázis** (`20261019083757_add_academic_career`, additív): `GameSave.phdInvested` (befektetett PhD), `phdTotal` (birtokolt + befektetett — a `phd` ranglista mezője, minden `phdCount`-író abszolút értékkel írja újra, így egy régi API által elavulttá tett érték a következő írásnál helyreáll), `careerWindowOpen`, `careerWindowId`; új `CareerNodeSave` tábla (`nodeId`, a ténylegesen fizetett `cost`, `boughtInWindow`). Ablakot a migráció **nem** nyit: aki a bevezetés előtt szerzett fokozatot, a következőnél kapja az elsőt.

**A PhD-oszlopok szélesítése** (`20261019120000_widen_phd_columns`): a `phdCount`, `upgraderNet`, `phdInvested`, `phdTotal` és `CareerNodeSave.cost` `INT` helyett `DOUBLE` (mint a `tokens`). A `phdCount` korlátlanul, nagyjából négyzetesen nő a játékidővel: a balance-szimuláció szerint egy hatékony játékos fa nélkül ~1000, a teljes fával ~175 óra után túllépné a 2 147 483 647-et, és onnantól minden mentése 400-at kapna. A `DOUBLE` 2^53-ig pontosan tárol egész számokat — ugyanaddig, ameddig egy JS `number` (és így a frontend) egyáltalán képes; a `BIGINT`-et a Prisma JS `bigint`-ként adná vissza, ami JSON-ba nem szerializálható. A validáció ennek megfelelően egész számot vár `2^53 − 1`-ig (`SAVE.PHD_LIMIT`, ha a birtokolt + befektetett túllépné); egy pörgetés tétje továbbra is legfeljebb `2 147 483 647` (`UPGRADER_MAX_STAKE`, a kliens is erre korlátoz). **Ellenőrizve, nem feltételezve:** a `main` ág teljes API tesztkészlete (392 teszt) hibátlanul fut egy erre a sémára migrált adatbázison, vagyis a deploy-ablakban még futó régi API működik.

**A mentés-hihetőségi burok** (`services/saveValidator.ts`) a fiók **saját, tárolt** csomópontjaiból (sosem a kérésből) számolt módosítókkal tágítja minden korlátját — két elfogadott mentés között a fa nem változhat `upgraderSeq`-ugrás nélkül, ezért ugyanazok a módosítók érvényesek a fokozatszerzés előtti és utáni gazdaságra is:

- `maxTps`: egységenkénti és globális szorzók, PhD-nkénti bónusz, booster-erősség (a játékos booster-készletének azonos fajtájú szorzóinak szorzata);
- `maxClickValue`: kattintásszorzó, szinergia (plafonnal), `MAX_CRIT + critMultAdd`, `× (1 + momentumMax)`; a demonstrátorok bevétele (`maxAutoIncome × dt`) **idővel** korlátozott, a kattintás-korlát változatlan;
- legolcsóbb ár: egység- és fejlesztéskedvezmény, magasabb plafon, a `clearance` erősítése;
- fokozatszerzés az intervallumban: a megtartott egységek `before = floor(előző × bp/10000)` (az alsó korlát bármennyi fokozatszerzésre érvényes), a megtartott családok fejlesztései ingyenesek, és fokozatszerzésenként egy kezdőtőke költhető — de legfeljebb annyi, amennyit a kereset (`floor(ΔE/S) + 1`) és a PhD-növekedés megmagyaráz, így egy hamisított `prestigeCount` nem sokszorozhatja;
- PhD-korlát: `(1 + phdGainBp/10000) × √(n × E / S) + slack + upgraderNet − phdInvested` — a befektetett PhD-ket mentéssel nem lehet „visszahozni".

Nulla csomóponttal a burok **bitre azonos** a korábbival (egy reviewer 50 000 véletlen bemenettel ellenőrizte a `main` és az ág között).

**Kliens-szerződés** (az Upgraderével azonos, ettől függ, hogy a burok igaz maradjon):

1. Minden PhD-t mozgató hívás (vásárlás, visszaváltás, a `windfall`-t is tartalmazó booster-igénylés, pörgetés) a `saveStore.withSyncLock` alatt fut: előbb **elmenti** a jelenlegi állapotot, a lock alatt más mentés nem megy ki. A lock **sorba állít**: egy második igénylő megvárja a sorát (és maga is elment), így a szerver-oldali PhD-/token-változások szigorúan egymás után történnek. A bizonytalan kimenetelű hiba utáni újratöltés is a lock alatt fut (`save.reload()`), hogy ne keveredhessen egy másik művelet mentésével.
2. `gameStore.careerPending` (és `spinPending`, együtt `serverActionPending`) az előzetes mentéstől az eredmény alkalmazásáig tiltja a vásárlást és a fokozatszerzést.
3. A szerver válaszából a `phdCount`-ot és az `upgraderSeq`-et átvesszük (`applyCareerState`), nem számoljuk újra. A bezárás (`close`) is a lock alatt, előzetes mentéssel fut, és csak a karrier-részt veszi át (az egyenleg egy, a fokozatszerzés mentése előtti állapotot tükrözhetne).
4. Egy `PUT /save` válaszának ablak-állapotát csak akkor vesszük át, ha a mentés óta nem történt fokozatszerzés (egy úton lévő autosave válasza különben becsukná az épp megnyílt ablakot).

**Vendég → fiók.** 1.7.1 óta vendég nem szerezhet fokozatot és nem vásárolhat a fán (lásd fent, "1. réteg" → "Vendég → fiók"), így vendég-fa a gyakorlatban nem jön létre. A bejelentkezéskori `forfeitGuestCareer` (minden csomópont visszaváltása, a vendég PhD-nyereség-bónuszával szerzett PhD-k levonása, értesítés — csak ha a fa helyben változott) védelmi tartalékként marad: ma csak egy 1.7.1 előtti, még nyitva lévő lap vendég-fáját érhetné el.

**A felület** (`components/career/`): teljes képernyős overlay (`CareerOverlay`, z-index 1150) — vásárlási ablak módban Esc, Vissza és a vászonra kattintás sem zárja be (csak a kijelölést törli), csak a Kihagyás / Kész; nézet módban (a Fokozat panel „Tudományos pálya" gombja) bezárható. A vászon (`CareerCanvas`) egyetlen transzformált rétegen SVG-éleket és valódi `<button>` csomópontokat tartalmaz; a bevitel kizárólag Pointer Events (egér, érintés, toll egy kódúton): húzás `DRAG_SLOP` felett pásztáz és sosem jelöl ki, két ujj a középpont körül nagyít, görgő a kurzor körül, dupla koppintás ott nagyít; a nyilak a fában lépkednek (roving tabindex). A geometria tiszta, tesztelt függvényekben él (`utils/panZoom.ts`, `utils/careerLayout.ts`). Egérrel a teljes legyezőt (a gyökeret és mind a hat ágat) mutatva nyílik; érintéssel szándékosan 1-es nagyítással (44 px-es célpontok — a teljes fát „Az egész fa” gomb, a jelmagyarázatot a „?” mutatja), a részletpanel alsó lap (alacsony fekvő képernyőn jobb oldali), és a vászon a kijelölt csomópontot a lap fölé hozza.

**Balance-szimuláció** (`frontend/src/utils/__tests__/career-balance.sim.spec.ts`, `pnpm sim:balance`; alapértelmezésben kihagyva): a valódi `gameStore`-ral több száz szimulált órát játszik (3 katt/s, minden booster, a legjobb PhD/óra szerinti fokozatszerzés, ablakonként a birtokolt PhD-k rögzített hányadának befektetése; `SIM_INVEST`, `SIM_ORDER=value`, `SIM_SEED`, `SIM_HOURS`). A jelenlegi árakkal a leggyorsabb talált stratégia (~10% befektetés ablakonként) **~129 óra** alatt maxolja a fát; a felét minden ablakban befektető ~172 óra. Ár- vagy hatásmódosítás után futtasd újra.

**Paritás és tesztek.** `api/scripts/generate-career-fixtures.ts` (`pnpm generate:career-fixtures`) írja a byte-azonos `career-catalog.json`-t és `career-vectors.json`-t mindkét app-ba; `career-parity.test.ts` / `.spec.ts` ezekhez hasonlítja a saját másolatot (plusz kézzel számolt értékek és katalógus-invariánsok). API: `careerEnvelope.test.ts` (minden módosító mindkét irányban), `career.test.ts` (végpontok, ablakszabályok, párhuzamosság), `careerSave.test.ts` (saját `enforce`/`off` szerver), `careerBoosters.test.ts`. Frontend: `gameStoreCareer.spec.ts`, `useCareer.spec.ts`, `useBoostersCareer.spec.ts`, `useAutoBuyer.spec.ts`, `careerText.spec.ts`, `panZoom.spec.ts`, `careerLayout.spec.ts`; e2e: `e2e/career.spec.ts` (mind a kilenc eszközprojekten, CDP-s csippentés és húzás).

**Új csomópont / sáv hozzáadása:** bővítsd a `BRANCH_DEFS`-et a `careerCore.ts`-ben (csak hozzáadás!), másold a fájlt byte-azonosan a másik app-ba, futtasd a `pnpm generate:career-fixtures`-t, add hozzá a nevét mindkét i18n fájlhoz (`career.nodes.*` / `career.tracks.*`; a `careerText.spec.ts` minden csomópontot ellenőriz mindkét nyelven), és ha új `kind`-ot vezetsz be: a hatását mindkét economy-tükörben, a burokban és a `careerEffectText`-ben is. Végül futtasd a balance-szimulációt.

---

## Ranglisták (leaderboard)

A `GET /leaderboard` végpont (bejelentkezést igényel) egy adott életút-mérőszám
szerinti rangsort ad vissza. A mérőszám-választék és a hozzá tartozó `GameSave`
mező a `src/constants/leaderboard.ts`-ben van definiálva:

| `metric` érték | `GameSave` mező |
|---|---|
| `tokens` (alapértelmezett) | `totalTokensEarned` |
| `clicks` | `totalClicks` |
| `phd` | `phdTotal` — a birtokolt és a Tudományos pályába befektetett PhD-k összege, így a befektetés sosem ront a helyezésen (az Upgrader nyeresége/vesztesége viszont közvetlenül mozgatja) |
| `playtime` | `elapsedSeconds` |

Query paraméterek: `metric` (fenti értékek egyike) és `limit` (egész szám,
`1`–`100`, alapértelmezett `50`). A válasz:

```jsonc
{
  "metric": "tokens",
  "entries": [{ "rank": 1, "username": "...", "value": 123.45 }, ...],
  "viewer": { "rank": 7, "value": 12.3, "hidden": false } // null, ha a lekérdezőnek nincs mentése
}
```

Az `entries` sosem tartalmaz `userId`-t vagy e-mailt, csak `rank`/`username`/`value`-t.
A `viewer` mező akkor is megjelenik, ha a lekérdező kívül esik a visszaadott
`entries` listán (`limit`-en túli helyezés) — ilyenkor a frontend egy külön,
"a te helyezésed" sort jelenít meg a lista alatt (`LeaderboardModal.vue`).

**Adatvédelmi kizárás** – a `UserSettings.hideFromLeaderboards` mező (alapértéke
`false`, a többi opcionális beállítási mezővel megegyező mintán a `PUT /settings`
végponton keresztül módosítható) kizárja a játékost mások ranglistájáról. A
kizárt játékos saját lekérdezése a `viewer.hidden: true` jelzést kapja, de a
helyezése továbbra is a látható játékosok közötti (elméleti) helyét mutatja.

**Holtverseny** – azonos érték esetén a sorrend a `userId` szerint növekvő,
hogy a rangsor minden lekérdezésnél ugyanazt az eredményt adja (`getTopEntries`
és `getViewerStanding` a `src/database/models/leaderboard.ts`-ben ugyanazt a
`VISIBLE_FILTER`-t és tie-break szabályt használja).

**Új mérőszám hozzáadása**: bővítsd a `LEADERBOARD_METRICS` objektumot a
`src/constants/leaderboard.ts`-ben egy új kulccsal és a megfelelő `GameSave`
mezővel, adj hozzá egy `@@index([...])`-et a mezőre a `prisma/schema.prisma`
`GameSave` modelljéhez (additív migráció — lásd fent), majd tükrözd a
mérőszám-kulcsot a frontend oldalán is: `frontend/src/types/index.ts`
`LeaderboardMetric` típusa és a `LeaderboardModal.vue`-ban a `metricLabels`
(plusz az új `leaderboard.metricXxx` fordítási kulcs mindkét i18n fájlban).

---

## Új API endpoint hozzáadása

1. Hozd létre a controller függvényt `src/controllers/` mappában (Swagger JSDoc kommenttel együtt).
2. Regisztráld a route-ot a megfelelő `src/router/*.ts` fájlban.
3. Ha szükséges, adj hozzá új válaszkódokat a `src/constants/responses.ts`-be.
4. Ha az endpoint új adatbázis-mezőt vagy táblát igényel: bővítsd a `prisma/schema.prisma`-t, majd `pnpm prisma migrate dev --create-only` paranccsal generálj vázlat-migrációt, formázd át a repo meglévő migrációinak stílusára (lásd pl. `20260912120000_add_prestige_fields`), és futtasd le. Additív változtatásnál (`NOT NULL DEFAULT ...`) a már futó, régebbi kliens nem törik el.
5. Bővítsd a `config/swagger.ts` sémáit, ha a request/response alak változott.
6. Írj teszteket a `tests/` mappában — ha a mező opcionális egy régebbi kliens kompatibilitása miatt, tesztelj mindkét irányban (jelen van / hiányzik).

---

## Prestige egyensúly (balance) állandók módosítása

A PhD-formula és a szorzók egyetlen helyen, a `frontend/src/utils/gameConstants.ts` fájlban vannak (`PHD_TOKEN_SCALE`, `PHD_PRODUCTION_BONUS`, `PHD_COST_REDUCTION`, `PHD_COST_REDUCTION_CAP`); a képletek maguk a `frontend/src/utils/prestige.ts`-ben. Egy balance-módosítás után futtasd le a `frontend/src/utils/__tests__/prestige.spec.ts` és `costCalculator.spec.ts` teszteket — ezek konkrét, számított határértékeket ellenőriznek, amik a konstansok módosításával változni fognak.

Hasonlóan, a kattintás-erő (fejlesztések) és a boosterek minden balance-száma
is a `gameConstants.ts`-ben lakik (`UPGRADE_DEFINITIONS`, `BOOSTER_DEFINITIONS`,
`UPGRADE_REVEAL_FRACTION`, a `BOOSTER_SPAWN_*`/`BOOSTER_VISIBLE_*`
időablakok), a képletek a `frontend/src/utils/upgrades.ts`-ben. A tervezett
célérték: teljesen felfejlesztve, kb. 5 kattintás/másodperces tempó mellett
a kattintás kb. +25%-kal növelje az idle bevételt az egyáltalán nem
kattintó esethez képest — egy balance-módosítás után ezt egy rövid,
szimulált menetet futtató szkripttel érdemes ellenőrizni, ne csak a
`frontend/src/utils/__tests__/upgrades.spec.ts` egységteszteket lefuttatva
(azok a képleteket, nem az egész gazdaság egyensúlyát ellenőrzik).

Ha egy balance-állandó (egység ára/termelése, fejlesztés hatása, PhD-formula)
módosul, a szerver oldali tükröt (`api/src/constants/gameBalance.ts`,
`api/src/services/economy.ts`) **ugyanabban a változtatásban** kell
frissíteni — ellenkező esetben a mentés-hihetőségi burok (lásd "Anti-cheat
modell") a régi, elavult képlet szerint fog számolni, és vagy hamisan
elutasít valódi mentéseket, vagy túl engedékennyé válik. A két oldal
szinkronban tartását egy közös arany-vektor tábla (`api/src/tests/fixtures/
economy-vectors.json`, byte-azonos másolat a frontend oldalán) és a hozzá
tartozó két parity-teszt (`economy-parity.test.ts` / `.spec.ts`) ellenőrzi —
egy balance-módosítás után mindkét parity-tesztet le kell futtatni, és ha a
vektorok konkrét várt értékei is változtak, újra kell generálni őket.

A Tudományos pálya árai és hatásai a `careerCore.ts` két byte-azonos másolatában élnek (`CAREER_*_GROWTH_PERCENT`, `KEYSTONE_*_SCALE`, a `BRANCH_DEFS` értékei); módosítás után másold át a fájlt, futtasd a `pnpm generate:career-fixtures`-t és a `pnpm sim:balance`-ot (lásd „Tudományos pálya”).

Az Upgrader balance-állandói (`UPGRADER_RTP`, `UPGRADER_WIN_CHANCE_CAP`, a szorzó-tartomány, a vigaszdíj `UPGRADER_CONSOLATION_*` értékei) két helyen élnek, kézzel tartva: `api/src/constants/upgrader.ts` (a szerver — ez a hiteles) és `frontend/src/utils/gameConstants.ts` (a kliens előnézete és a vendég-mód), mindkettőn „keep in sync" kommenttel. A képletek tükrei (`api/src/services/upgrader.ts` ↔ `frontend/src/utils/upgrader.ts`) közös, **kézzel számolt** arany-vektor táblát használnak (`upgrader-vectors.json`, byte-azonos másolat mindkét oldalon, `upgrader-parity.test.ts` / `.spec.ts`) — a vektorok szándékosan nem a megvalósításból generáltak, hogy egy hibát ne másoljanak le. Módosítás után mindkét parity-tesztet és az `upgraderMath.test.ts`-t futtasd, és ha egy várt érték megváltozott, kézzel számold újra, majd másold át a fájlt a másik oldalra is.

---

## Anti-cheat küszöbök módosítása

Minden detekciós küszöb egyetlen fájlban, az `api/src/constants/antiCheat.ts`-ben
található, csoportosítva a réteg szerint (mentés-burok / statisztikai
verdikt / büntetési létra). **Egyik érték sem kerül a kliens-oldali
bundle-be** — ez a teljes pont abban, hogy a detekció szerver-oldalon fut:
egy csaló-szkript szerzője nem tudja kiolvasni, hol a pontos határ, és egy
küszöb-hangolás egy szerver-redeploy, sosem egy kliens-frissítés.

Egy küszöb módosítása után:

1. Futtasd le a `api/src/tests/saveValidator.test.ts` (1. réteg) és
   `antiCheatDigest.test.ts` (3. réteg) tiszta egységteszteket — ezek
   konkrét határeseteket ellenőriznek, amik a küszöbök módosításával
   változni fognak.
2. Ha a módosítás a `PUT /save` viselkedését érinti, futtasd a
   `envelopeEnforcement.test.ts`-t is (saját, `ANTICHEAT_MODE=enforce`
   szerverpéldánnyel).
3. Ha valós forgalmon szeretnéd validálni egy hangolás előtt: állítsd
   `ANTICHEAT_MODE=monitor`-ra egy ideig, majd nézd át az `AntiCheatEvent`
   táblát (`kind`, `severity`, `enforced: false` sorok) — ez pontosan azt
   mutatja, mi *történt volna* enforce alatt, anélkül hogy bárkit
   ténylegesen korlátozott volna.

A büntetési létra (`RESTRICTION_MINUTES_BY_STRIKE`, `SAVE_RESET_STRIKE`,
`STRIKE_DECAY_DAYS`) módosításakor a frontend oldali guest-mód másolatát is
(`frontend/src/utils/antiCheatConstants.ts` `GUEST_RESTRICTION_MINUTES_BY_STRIKE`/
`GUEST_SAVE_RESET_STRIKE`) frissíteni kell — ezek a konkrét percértékek nem
számítanak érzékenynek (a "várj 1 percet" tudása nem segít a detekció
megkerülésében), ezért ez az egyetlen anti-cheat konstans-csoport, ami
szándékosan létezik kliens-oldalon is.

---

## CI/CD

Két GitHub Actions workflow fut a self-hosted runneren (`vbServer`, bare metal, Docker konténerezés nélkül):

### `ci.yml` – tesztek PR-en

Minden `main`-re nyíló pull request-en lefut, hat jobban. Öt közülük (`typecheck`, `verify-migrations`, `frontend-tests`, `frontend-e2e`, `honest-play`) egymástól független (egyetlen runner miatt sorban futnak, de a State külön látszik); az `api-tests` a `verify-migrations`-tól függ, hogy már migrált, ellenőrzött adatbázison fusson:

| Job | Mit ellenőriz |
|---|---|
| `typecheck` | `api`: `tsc --noEmit` · `frontend`: `vue-tsc --build` |
| `verify-migrations` | `prisma migrate deploy` + `prisma migrate diff --exit-code` a dedikált `zutiClickerTest` adatbázis ellen — a merge előtti bizonyíték arra, hogy egy migráció nemcsak létezik, hanem helyes is (lásd lent, `deploy.yml`) |
| `frontend-tests` | Vitest (`src/**/__tests__/*.spec.ts`), szerver/adatbázis nélkül |
| `frontend-e2e` | Playwright (`frontend/e2e/`), a böngészőben kimockolt API-val (nincs adatbázis, nincs élő szerver) — a reszponzív/elrendezési regressziók, lásd fent, "E2E tesztek". Rendszerszintű Chromiumot keres (`chromium`, `chromium-browser`, `google-chrome[-stable]`), és csak ennek hiányában tölti le a sajátját. Hiba esetén a nyomokat (`test-results/`) `e2e-traces-<futás>` artifactként feltölti (szándékosan nem `junit-*` nevűként, mert a `reports` job ezt a mintát gyűjti) |
| `honest-play` | **Becsületes-játék kapu**: a frontend `pnpm sim:honest-play-gate` szimulációja a valódi `gameStore`-ral, a valódi kliens mentési ütemében játszik (gyors fokozatszerzés automatikus vásárlókkal és a teljes Tudományos pályáig, kerék-pörgetések, 20 katt/s-es kattintó), és minden mentési intervallumot kiír; az `api/src/tests/honestPlayGate.test.ts` mindegyiket (~20 000) a valódi mentés-burkon játssza vissza — egyetlen elutasítás vagy érdemi korrekció is bukás. Minden eddigi téves anti-cheat tiltás abból fakadt, hogy a burok nem illett valamire, amit egy becsületes kliens ténylegesen csinál; ez a kapu merge előtt fogja meg az ilyet. Nincs adatbázis, nincs szerver. |
| `api-tests` | Jest, éles szerver a `:2710` porton ugyanazon `zutiClickerTest` adatbázis ellen — a `verify-migrations`-tól függ, hogy már migrált adatbázison fusson |

Az `api-tests` és a `verify-migrations` job egyaránt egy futtatáshoz kötött, runner-lokális `.env` fájlt vár `/mnt/raid1/zuti-clicker-ci/.env.ci` alatt (sosem GitHub secret) — ez tartalmazza a `zutiClickerTest` / `zutiClickerTestShadow` adatbázisok elérését és egy eldobható `CRYPTO_SECRET_KEY`-t. **Ennek a fájlnak tartalmaznia kell az `ANTICHEAT_MODE=monitor` sort is** (lásd fent, "Tesztek futtatása" és lent, "Anti-cheat modell") — enélkül az `api-tests` job elbukik, mert a meglévő `save`/`leaderboard`/`booster` tesztek fixture-jei nem férnek bele a mentés-hitelesség-ellenőrzésbe `enforce` módban. A teszt lefutása után az `api-tests` job a `cleanup:test-users --apply` scriptet futtatja, hogy a `test_<random>@example.com` felhasználók ne halmozódjanak.

Mind az öt job feltölt egy `junit-<stage>` artifactot; egy hatodik (`reports`) job ezekből generálja a `.github/scripts/junit-report.mjs` scripttel a `report.html`, `report.ods` (valódi OpenDocument táblázat, Summary + Tests munkalapokkal) és `summary.md`/`summary.json` fájlokat, `test-reports` artifactként. A hetedik (`summary`) job publikálja az eredményt:

- a futás GitHub Actions job summary-jába,
- egy "sticky" PR-kommentbe (pusholásonként frissül, nem szaporodik) — **csak
  ugyanabból a repóból nyitott PR-eken**: egy fork PR `GITHUB_TOKEN`-je
  írásvédett a job `permissions:` blokkjától függetlenül, így ott ez a lépés
  kimarad, és a job summary-ba egy egysoros megjegyzés kerül helyette,
- inline check-run annotációkba a hibás teszteknél.

### `deploy.yml` – build, release, deploy

Minden `main`-re kerülő push-on lefut (branch protection miatt ez mindig egy már CI-tesztelt, mergelt PR):

1. **version** — beolvassa és összeveti az `api/package.json` és `frontend/package.json` verzióját (a kettőnek meg kell egyeznie — lásd a repo-konvenciót a kézzel duplikált értékekről), és megnézi, létezik-e már `v<version>` tag.
2. **build-push** — megépíti és pusholja mindkét image-et a GitHub Container Registry-be (`ghcr.io/vb2007/zuti-clicker-api`, `ghcr.io/vb2007/zuti-clicker-frontend`), mindig `sha-<rövid_sha>` és `latest` taggel, új verzió esetén a puszta `<version>` taggel is. A frontend image build-argjai közt a `VITE_ENABLE_QUICK_RESET` értékét egy `ENABLE_QUICK_RESET` nevű repo-szintű Actions variable adja (hiányában `'false'`) — ez az egyetlen módja annak, hogy az Alt+X gyorsbillentyű production-ben bekapcsoljon, és mivel build time-kor dől el, a variable módosítása után is csak egy új push/deploy után lép életbe.
3. **migrate** — a **build-push**-sal párhuzamosan fut (nem függ az image-ektől), és lefuttatja a `prisma migrate deploy`-t az **éles, production adatbázis** ellen. A hitelesítő adatokat a telepítési könyvtár saját `.env` fájljából olvassa ki (sosem írja) — ugyanabból a fájlból, amit a `docker-compose.prod.yml` is használ `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`SHADOW_DB_NAME` néven —, és ezekből építi fel mind a `DATABASE_URL`-t, mind a `SHADOW_DATABASE_URL`-t. Ez utóbbit a `prisma migrate deploy` ténylegesen nem használja, de a `prisma.config.ts` minden Prisma-parancsnál rögtön betöltéskor feloldja — hiányzó env változó esetén hibával leáll még azelőtt, hogy a tényleges parancs lefutna (ezt ez a job éles hibaként tapasztalta meg először, miután egy korábbi helyi teszt hamisan biztonságosnak tűnt egy megmaradt `.env` fájl miatt, ami a hiányzó változót észrevétlenül visszatöltötte). A `DB_HOST` értéke a `.env`-ben tipikusan `host.docker.internal` (ez a Docker-only alias csak konténeren belülről oldható fel, a `docker-compose.prod.yml` `extra_hosts: host.docker.internal:host-gateway` beállítása miatt) — mivel ez a job sima folyamatként fut közvetlenül a runner gépén, nem konténerben, a job `127.0.0.1`-re cseréli ezt az értéket (szintén éles hibaként derült ki: `P1001: Can't reach database server at host.docker.internal:3306`). Mivel a migráció idempotens, ez a job feltétel nélkül, minden `main`-push-on lefut, nem csak új verziónál.
4. **release** (csak ha a verzió új) — létrehozza a `v<version>` taget és egy GitHub release-t automatikusan generált jegyzetekkel, kiegészítve image digest-ekkel és a mergelt PR CI-futásának teszteredményeivel. Csatolt fájlok: a verzióra rögzített `docker-compose.prod.yml`, egy `images.json` digest-lista, a frontend build tartalma (`.tar.gz`), és a teszt-riport csomag.
5. **deploy** — csak a `docker-compose.prod.yml`-t szinkronizálja a `/mnt/raid1/zuti-clicker` telepítési könyvtárba (a már ott lévő `.env`-hez soha nem nyúl), lehúzza a sha-hoz rögzített image-eket, és újraindítja a stacket a meglévő healthcheckek megvárásával. Csak akkor fut, ha a **migrate** job is sikeres volt — egy sikertelen migráció blokkolja a deployt (a régi konténerek változatlanul futnak tovább a régi sémán/image-eken).

**Migráció**: a `migrate` job **automatikusan** lefuttatja a `prisma migrate deploy`-t az éles adatbázis ellen minden `main`-push-on — ez a deploy előtti kézi lépést váltotta fel (lásd fent, "Adatbázis migráció"). Mivel a projektnek nincs külön staging adatbázisa, az egyetlen védőháló az additív-only migrációs szabály, a PR review, és a `ci.yml` `verify-migrations` jobja (lásd fent) — ez utóbbi bizonyítja merge előtt, hogy egy migráció *helyes* (tisztán alkalmazható, és megegyezik a `prisma/schema.prisma` tartalmával), de azt nem tudja kiszűrni, ha egy migráció szintaktikailag helyes, mégis hibás (pl. valódi adatot töröl).

**Verziózás**: egy funkció leszállításakor mindkét `package.json`-ban (api + frontend) egyszerre kell emelni a `version` mezőt — ez a release-mechanizmus egyetlen forrása.

**Visszaállás egy korábbi verzióra:**

```bash
cd /mnt/raid1/zuti-clicker
IMAGE_TAG=sha-<korábbi_rövid_sha> docker compose -f docker-compose.prod.yml up -d
```

**Figyelem — a Tudományos pálya előtti verzióra visszaállva:** a régi burok nem ismeri a csomópontok módosítóit és a `phdInvested`-et, ezért a fát használó játékosok mentéseit hamisan korrigálhatja vagy elutasíthatja (strike) — futtasd utána a `reset:anticheat-state` scriptet. Ha egy játékos `phdCount`-ja már túllépte a régi `INT` tartományt (2 147 483 647), a régi API validációja minden mentését `400`-zal utasítja el; ez visszaállással nem javítható, csak előre. A régi ranglista a `phdCount` szerint rangsorol (a `phdCount` index megmaradt). Visszaállás és újbóli előrelépés után a `phdTotal` a következő mentésnél helyreáll.

**Figyelem — az Upgrader előtti verzióra visszaállva:** ha a játékosok közben már pörgettek, a régi mentés-hihetőségi burok nem ismeri az `upgraderNet` oszlopot (a séma additív, ezért a régi image fut, de figyelmen kívül hagyja). A nyertesek PhD-készlete a régi burok szerint a prestige-ekből elérhetetlen (korrigálja vagy elutasítja), a vesztesek mentése pedig monotonitás-sértés — mindkettő **strike**-ot okozhat becsületes játékosoknak. Visszaállás után ezért a `pnpm reset:anticheat-state` scripttel (alapértelmezésben próbafuttatás, `--apply`-jal éles) nullázd az anti-cheat állapotot — a script **minden** fiókra hat, nem csak az érintettekre —, vagy inkább előre javíts, ne visszaállj.

---

## Fontos tudnivalók fejlesztőknek

- A projekt `"type": "module"` (ESM). CommonJS `require()` nem működik; minden import ESM `import` szintaxist használ.
- A lodash CJS named import (`import { merge } from "lodash"`) az ESM miatt hibát okoz; kerüld a használatát.
- A Prisma client a `generated/prisma/` mappában van, nem a szokásos `node_modules/@prisma/client` helyen. A `pnpm prisma generate` futtatása után commitolni kell a generált fájlokat is.
- A `CORS_ORIGIN_URLS` environment változó nincs beállítva a `.env`-ben; fejlesztési módban a Vite proxy kezeli a cross-origin kéréseket, így CORS konfiguráció nem szükséges.
- A session tokenek az `Authentication.sessionToken` mezőben tárolódnak. Kijelentkezéskor ez üres stringre áll vissza, nem törlődik a rekord.
- Új modálablakot a `frontend/src/components/modals/BaseModal.vue` közös héjára építve érdemes létrehozni (Esc és Vissza a közös overlay-vermen át, fókuszcsapda, fókusz-visszaállítás, `aria-labelledby`, testreszabható `dismiss-on-backdrop`/`max-width`/`z-index`, `closable` ✕ fejléc, telefonon `compact` szűkebb belső margóhoz, biztonságos területekhez igazodó margók) — ne másold újra a Teleport/backdrop mintát, amit ez váltott fel, és ne írj saját Esc/`popstate` figyelőt (lásd fent, "Overlayek és a Vissza gomb").
- Reszponzív szabályt írva: az érintési célméret (`min-height: 44px`) `(max-width: 759px), (pointer: coarse)` alatt él, a hover-stílus `@media (hover: hover)` alatt; `transition: all` helyett sorold fel a tulajdonságokat; folyamatos animációt (`infinite`) csak `transform`/`opacity`-re írj, `box-shadow`-ra ne (lásd a `breathe` kulcskockát).
- A `@vue/test-utils`'s `trigger()` metódusa mindig `isTrusted: false` eseményt küld (ez böngésző-specifikáció, nem tesztkörnyezeti hiba — pont ezt a jelet ellenőrzi az anti-cheat rendszer 2. rétege). Egy valódi kattintást szimuláló teszthez használd a `frontend/src/__tests__/testEvents.ts`'s `dispatchTrusted()` segédfüggvényét; egy `isTrusted: false` esemény viselkedését ellenőrző teszthez a sima `trigger()` pont megfelelő (alapból is bizalmatlan eseményt küld).
```
