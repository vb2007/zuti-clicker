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
| `POST` | `/boosters/claim` | kötelező | Egy véletlenszerű booster igénylése, ha a lehűlési idő már letelt — lásd lent, "Booster anti-cheat modell" |

A `PUT /save` öt prestige-mezője (`phdCount`, `prestigeCount`, `runTokensEarned`, `runClicks`, `runSeconds`) **opcionális**: egy régebbi kliens, amely nem ismeri ezeket, biztonságosan tud menteni — a hiányzó mezőket a szerver a már tárolt értéken hagyja (nem nullázza), első mentésnél pedig az életút-mezőkből tölti fel őket.

Egy hatodik, szintén opcionális mező, az `upgrades` (megszerzett fejlesztés-azonosítók tömbje) ugyanezt a mintát követi: hiányzása esetén a szerver a már tárolt fejlesztéseket változatlanul hagyja, jelenléte esetén viszont — az `units` mezőhöz hasonlóan — teljesen felülírja őket. Minden elemének egy ismert fejlesztés-azonosítónak kell lennie (`api/src/constants/upgrades.ts`'s `KNOWN_UPGRADE_IDS`), különben a végpont `400`-at ad vissza. A `GET /save` válasza az `upgrades` mellett egy csak-olvasható `activeBoosters` tömböt is tartalmaz (a jelenleg aktív boosterek, `remainingMs` hátralévő idővel) — ezt a `PUT /save` sosem fogadja el, kizárólag a `POST /boosters/claim` hozhatja létre vagy frissítheti.

### Frontend state management

```
App.vue
  ├── useGameLoop()          → gameStore.tick() 20x/s
  ├── usePrestige()          → gameStore.prestige() -> ceremónia/szinkron
  ├── useBoosters()          → booster pickup ütemezése (spawn/láthatósági ablak) + igénylés
  ├── useBreakpoint()        → isCompact (matchMedia, < 760px)
  ├── authStore              → session check, login/register/logout
  ├── settingsStore          → téma, nyelv, autosave, ceremónia — localStorage + szerver szinkron
  ├── saveStore               → load/sync/reset (autosave-időzítő a settingsStore-ból olvas)
  ├── uiStore                → modál állapotok, mobilePanel ("none" | "stats" | "units"), shopTab ("units" | "upgrades")
  ├── toastStore             → átmeneti értesítések (pl. beállítások mentése, booster begyűjtése)
  ├── leaderboardStore       → mérőszámonkénti rangsor lekérése (nincs localStorage-gyorsítótár, mindig a szerver a forrás)
  └── gameStore              → tokenek, egységek, fejlesztések (upgrades), aktív boosterek, statisztikák, prestige állapot
```

A `ClickerArea.vue` (középső oszlop) hívja meg a `useBoosters()` composable-t — ez tartja karban a véletlenszerű booster-pickup teljes életciklusát (mikor jelenik meg, meddig látható, mi történik kattintáskor); a `BoosterPickup.vue` és `ActiveBoostersBar.vue` komponensek ebből olvasnak. A tényleges booster-effektus (termelés-/kattintás-szorzó, egységár-kedvezmény) a `gameStore.activeBoosters` állapoton keresztül érvényesül — lásd lent, "Booster anti-cheat modell".

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
UPGRADE_REVEAL_FRACTION`), a megfelelő családi csoportban
(`UpgradesPanel.vue`).

---

## Új booster hozzáadása

A boosterek időzített, szerver által kiadott bónuszok — lásd "Booster
anti-cheat modell" lentebb a teljes életciklusért.

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
3. Adj hozzá fordítási kulcsot mindkét i18n fájlhoz,
   `boosters.names.<id>` alatt (a leírás/hatás szövege jelenleg nincs
   külön kulcsban, az `ActiveBoostersBar.vue` és a claimedToast csak a nevet
   jeleníti meg).

---

## Booster anti-cheat modell

A kattintás-gazdaság (tokenek, egységek, fejlesztések) továbbra is teljesen
kliens-oldali és kliens-hiteles — ennek szerver-oldalivá tétele egy jóval
nagyobb átalakítás lenne. A boosterek viszont közvetlenül a ranglistákat
torzíthatnák (aki gyakrabban tud "booster-farmolni", végérvényesen jobb
statisztikákat ér el), ezért **kizárólag ez a rész szerver-hiteles**:

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

Az `api-tests` és a `verify-migrations` job egyaránt egy futtatáshoz kötött, runner-lokális `.env` fájlt vár `/mnt/raid1/zuti-clicker-ci/.env.ci` alatt (sosem GitHub secret) — ez tartalmazza a `zutiClickerTest` / `zutiClickerTestShadow` adatbázisok elérését és egy eldobható `CRYPTO_SECRET_KEY`-t. A teszt lefutása után az `api-tests` job a `cleanup:test-users --apply` scriptet futtatja, hogy a `test_<random>@example.com` felhasználók ne halmozódjanak.

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
```
