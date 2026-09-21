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

### Tesztek futtatása

A frontend a Vitest keretrendszert használja, valós szerver vagy adatbázis nélkül:

```bash
pnpm test          # egyszeri futtatás
pnpm test:watch    # watch mód fejlesztéshez
pnpm test:coverage # lefedettségi riport
```

A tesztek a `src/**/__tests__/*.spec.ts` minta alatt találhatók, a forrásfájlok mellett (pl. `src/utils/__tests__/prestige.spec.ts`).

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
| `POST` | `/anticheat/report` | kötelező | Kattintás-időzítési telemetria digest beküldése (fix ütemezéssel + azonnal lokális detekció esetén) — lásd lent, "Anti-cheat modell" |
| `GET` | `/anticheat/status` | kötelező | A jelenlegi korlátozási állapot (`isRestricted`, `restrictedUntil`, `strikeCount`) lekérdezése |

A `PUT /save` öt prestige-mezője (`phdCount`, `prestigeCount`, `runTokensEarned`, `runClicks`, `runSeconds`) **opcionális**: egy régebbi kliens, amely nem ismeri ezeket, biztonságosan tud menteni — a hiányzó mezőket a szerver a már tárolt értéken hagyja (nem nullázza), első mentésnél pedig az életút-mezőkből tölti fel őket.

Egy formailag helyes, de az előző mentéshez és az eltelt időhöz képest fizikailag elérhetetlen mentést a végpont `409`-cel utasít el (semmi nem íródik), vagy — ha csak kismértékben lépi túl a lehetségest — csendben az elérhető határértékre korrigál és `200`-at ad vissza; lásd lent, "Anti-cheat modell".

Egy hatodik, szintén opcionális mező, az `upgrades` (megszerzett fejlesztés-azonosítók tömbje) ugyanezt a mintát követi: hiányzása esetén a szerver a már tárolt fejlesztéseket változatlanul hagyja, jelenléte esetén viszont — az `units` mezőhöz hasonlóan — teljesen felülírja őket. Minden elemének egy ismert fejlesztés-azonosítónak kell lennie (`api/src/constants/upgrades.ts`'s `KNOWN_UPGRADE_IDS`), különben a végpont `400`-at ad vissza. A `GET /save` válasza az `upgrades` mellett egy csak-olvasható `activeBoosters` tömböt is tartalmaz (a jelenleg aktív boosterek, `remainingMs` hátralévő idővel) — ezt a `PUT /save` sosem fogadja el, kizárólag a `POST /boosters/claim` hozhatja létre vagy frissítheti.

### Frontend state management

```
App.vue
  ├── useGameLoop()          → gameStore.tick() 20x/s
  ├── useAntiCheat()         → 60s telemetria heartbeat + pointerdown/pointermove figyelők — lásd lent, "Anti-cheat modell"
  ├── usePrestige()          → gameStore.prestige() -> ceremónia/szinkron
  ├── useBoosters()          → booster pickup ütemezése (spawn/láthatósági ablak) + igénylés
  ├── useBreakpoint()        → isCompact (matchMedia, < 760px)
  ├── authStore              → session check, login/register/logout
  ├── settingsStore          → téma, nyelv, autosave, ceremónia — localStorage + szerver szinkron
  ├── saveStore               → load/sync/reset (autosave-időzítő a settingsStore-ból olvas)
  ├── uiStore                → modál állapotok, mobilePanel ("none" | "stats" | "units"), shopTab ("units" | "upgrades")
  ├── toastStore             → átmeneti értesítések (pl. beállítások mentése, booster begyűjtése)
  ├── leaderboardStore       → mérőszámonkénti rangsor lekérése (nincs localStorage-gyorsítótár, mindig a szerver a forrás)
  ├── antiCheatStore         → recordClick()/recordPurchase(), isRestricted/restrictedUntil/strikeCount, telemetria-puffer
  └── gameStore              → tokenek, egységek, fejlesztések (upgrades), aktív boosterek, statisztikák, prestige állapot
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
bezáródjon, ha az ablak visszaszélesedik 760px fölé.

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
- **Kattintásszám**: `Δclicks ≤ 45 · dt` (a burkoló-réteg saját, nagyvonalú felső korlátja — nem a statisztikai detektor jelzési küszöbe, lásd lent).
- **Bevétel**: a legkedvezőbb lehetséges termelési/kattintás-érték × `dt`, 1.5-szörös ráhagyással.
- **Elköltés**: az újonnan megszerzett egységek/fejlesztések legolcsóbb lehetséges ára (legjobb PhD-kedvezmény × legjobb booster-kedvezmény) — ez fogja meg az "ingyen egység" hamisítást.
- **Prestige/PhD**: a prestige-szám felülről korlátos az életút-bevétel alapján (minden prestige-hez legalább `PHD_TOKEN_SCALE` token kell, ami tartósan beépül az életút-bevételbe), a PhD-szám pedig ezen *már korlátozott* prestige-szám és az életút-bevétel alapján (Cauchy–Schwarz-egyenlőtlenség) — ez a sorrend zárja be azt a rést, hogy egy korlátlan prestige-szám önmagában tetszőlegesen felfújhatná a PhD-korlátot.

Minden határ a **legkedvezőbb** feltételezéssel számol (max booster/kritikus
találat, legjobb kedvezmény), hogy egy szerencsés vagy erősen kedvezményezett
valódi játékos sose szoruljon korlátozásba. Kimenet:

| Eltérés | Hatás |
|---|---|
| a határon belül | elfogadás változatlanul |
| a határ 1×–2×-szerese közt | csendes korrekció a határértékre, `200`, `AntiCheatEvent` info-bejegyzés |
| a határ 2×-szerese fölött, vagy monotonitás-sértés | `409`, semmi nem íródik, azonnali *strike* (lásd 4. réteg) |

### 2. réteg — kliens-oldali bemenet-hitelesség

- **`event.isTrusted`**: `ClickerCircle.vue`, `UnitCard.vue`, `UpgradeTile.vue` és `usePrestige.ts confirmPrestige` mind az eredeti eseményből olvassák — egy szkript által `dispatchEvent`/`el.click()`-kel indított kattintás sosem ér célba, és `untrustedClicks`-ként számít a telemetriában.
- **Rejtett/fókusz nélküli dokumentum**: `document.hidden || !document.hasFocus()` → a kattintás el sem indul, még `untrustedClicks`-be sem számít (valódi bemenet fizikailag nem juthatna el egy rejtett laphoz).
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
| `singleMethodExceedsHumanLimit` | egyetlen bemeneti mód (`primary`/`secondary`/`enter`/`space` négy közül) adja a kattintások ≥95%-át, ÉS annak saját rátája >20 cps | 2 |
| `weak:*` (pointer-fizika) | lásd 2. réteg | 1/jel |
| `untrustedInput` / integritás-jel | bármelyik jelenléte | döntő, azonnali |

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

**Második, éles környezetben talált incidens ugyanebből a mezőből**: a
"hiánya sosem utasít el" szabály önmagában nem volt elég — egy **jelen lévő,
de elavult alakú** `methodCounts` (pl. egy gyorsítótárazott régi kliens, ami
még a `keyboard` mezőt küldi az `enter`/`space` szétválasztása előttről) a
teljes digestet érvénytelenítette, nem csak ezt az egy jelet hagyta ki —
pontosan ugyanaz a hibaosztály, csak a "hiányzik" eset helyett a "jelen van,
de rossz alakú" esetre. A `sanitizeMethodCounts` (`controllers/anticheat.ts`
és `services/antiCheat.ts`, mindkét helyen külön, védelmi rétegenként) ezért
sosem dob el semmit emiatt — egy fel nem ismerhető alakot egyszerűen
hiányzóként kezel, csak ez az egy jel marad kiértékeletlen, minden más jel
(beleértve a `metronome`-ot, `sustainedRate`-et stb.) továbbra is lefut.

Egy verdikt csak **legalább 3 pontnál és legalább 2 különböző jelcsoportnál**
számít jelzettnek — a nyers kattintás-ráta önmagában (súly 1) sosem érheti el
egyik küszöböt sem. Ez szándékos: két ember, aki felváltva/együtt kattint
ugyanazon a fiókon (egér + szóköz + enter), simán elérhet ~25–30 cps-t
természetes szórással, széles hisztogram-tartománnyal és valódi fáradási
görbével — ez legfeljebb a `sustainedRate` jelet adja, ami önmagában sosem
elég. Egy valódi auto-clicker ezzel szemben a variancia/tartomány/sorozat-
hosszúság jeleken bukik el, jóval a ráta figyelembevétele előtt.

Egy jelzett (de nem döntő) ablak csak **két egymást követő** jelzett ablak
után válik tényleges *strike*-á (`AntiCheatState.suspicionScore`) — egy
határeseti ablak zaj, egy minta nem az. Egy tiszta ablak azonnal nullázza a
számlálót (önjavító).

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

A `requireNotRestricted` middleware (`middlewares/index.ts`) a `PUT /save`-t
és a `POST /boosters/claim`-et zárja le aktív korlátozás alatt — a
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

---

## Ranglisták (leaderboard)

A `GET /leaderboard` végpont (bejelentkezést igényel) egy adott életút-mérőszám
szerinti rangsort ad vissza. A mérőszám-választék és a hozzá tartozó `GameSave`
mező a `src/constants/leaderboard.ts`-ben van definiálva:

| `metric` érték | `GameSave` mező |
|---|---|
| `tokens` (alapértelmezett) | `totalTokensEarned` |
| `clicks` | `totalClicks` |
| `phd` | `phdCount` |
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

Minden `main`-re nyíló pull request-en lefut, négy jobban. Három közülük (`typecheck`, `verify-migrations`, `frontend-tests`) egymástól független (egyetlen runner miatt sorban futnak, de a State külön látszik); az `api-tests` a `verify-migrations`-tól függ, hogy már migrált, ellenőrzött adatbázison fusson:

| Job | Mit ellenőriz |
|---|---|
| `typecheck` | `api`: `tsc --noEmit` · `frontend`: `vue-tsc --build` |
| `verify-migrations` | `prisma migrate deploy` + `prisma migrate diff --exit-code` a dedikált `zutiClickerTest` adatbázis ellen — a merge előtti bizonyíték arra, hogy egy migráció nemcsak létezik, hanem helyes is (lásd lent, `deploy.yml`) |
| `frontend-tests` | Vitest (`src/**/__tests__/*.spec.ts`), szerver/adatbázis nélkül |
| `api-tests` | Jest, éles szerver a `:2710` porton ugyanazon `zutiClickerTest` adatbázis ellen — a `verify-migrations`-tól függ, hogy már migrált adatbázison fusson |

Az `api-tests` és a `verify-migrations` job egyaránt egy futtatáshoz kötött, runner-lokális `.env` fájlt vár `/mnt/raid1/zuti-clicker-ci/.env.ci` alatt (sosem GitHub secret) — ez tartalmazza a `zutiClickerTest` / `zutiClickerTestShadow` adatbázisok elérését és egy eldobható `CRYPTO_SECRET_KEY`-t. **Ennek a fájlnak tartalmaznia kell az `ANTICHEAT_MODE=monitor` sort is** (lásd fent, "Tesztek futtatása" és lent, "Anti-cheat modell") — enélkül az `api-tests` job elbukik, mert a meglévő `save`/`leaderboard`/`booster` tesztek fixture-jei nem férnek bele a mentés-hitelesség-ellenőrzésbe `enforce` módban. A teszt lefutása után az `api-tests` job a `cleanup:test-users --apply` scriptet futtatja, hogy a `test_<random>@example.com` felhasználók ne halmozódjanak.

Mind a négy job feltölt egy `junit-<stage>` artifactot; egy ötödik (`reports`) job ezekből generálja a `.github/scripts/junit-report.mjs` scripttel a `report.html`, `report.ods` (valódi OpenDocument táblázat, Summary + Tests munkalapokkal) és `summary.md`/`summary.json` fájlokat, `test-reports` artifactként. A hatodik (`summary`) job publikálja az eredményt:

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

---

## Fontos tudnivalók fejlesztőknek

- A projekt `"type": "module"` (ESM). CommonJS `require()` nem működik; minden import ESM `import` szintaxist használ.
- A lodash CJS named import (`import { merge } from "lodash"`) az ESM miatt hibát okoz; kerüld a használatát.
- A Prisma client a `generated/prisma/` mappában van, nem a szokásos `node_modules/@prisma/client` helyen. A `pnpm prisma generate` futtatása után commitolni kell a generált fájlokat is.
- A `CORS_ORIGIN_URLS` environment változó nincs beállítva a `.env`-ben; fejlesztési módban a Vite proxy kezeli a cross-origin kéréseket, így CORS konfiguráció nem szükséges.
- A session tokenek az `Authentication.sessionToken` mezőben tárolódnak. Kijelentkezéskor ez üres stringre áll vissza, nem törlődik a rekord.
- Új modálablakot a `frontend/src/components/modals/BaseModal.vue` közös héjára építve érdemes létrehozni (Esc, fókuszcsapda, fókusz-visszaállítás, `aria-labelledby`, testreszabható `dismiss-on-backdrop`/`max-width`/`z-index`) — ne másold újra a Teleport/backdrop mintát, amit ez váltott fel.
- A `@vue/test-utils`'s `trigger()` metódusa mindig `isTrusted: false` eseményt küld (ez böngésző-specifikáció, nem tesztkörnyezeti hiba — pont ezt a jelet ellenőrzi az anti-cheat rendszer 2. rétege). Egy valódi kattintást szimuláló teszthez használd a `frontend/src/__tests__/testEvents.ts`'s `dispatchTrusted()` segédfüggvényét; egy `isTrusted: false` esemény viselkedését ellenőrző teszthez a sima `trigger()` pont megfelelő (alapból is bizalmatlan eseményt küld).
```
