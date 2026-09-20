# Felhasználói dokumentáció – Zuti Clicker

## Mi ez a játék?

A Zuti Clicker egy böngészőalapú inkrementális játék (más néven idle game vagy clicker game). A célod tokeneket szerezni – kattintással, vagy megvásárolt egységekkel, amelyek automatikusan termelnek neked. Minél több egységed van, annál gyorsabban gyűlik a token. Az egységek ára és hozama exponenciálisan növekszik, így a fejlődés sosem ér véget.

---

## A játék megnyitása

A játék a böngészőben fut, nincs telepítés. Nyisd meg a megadott URL-en (alapértelmezetten `http://localhost:5173`). Az oldal azonnal betöltődik és a játék elindul – bejelentkezés nélkül is játszható.

---

## Vendégfigyelmeztetés

Az oldal első megnyitásakor, ha nem vagy bejelentkezve, egy felugró ablak jelenik meg:

> **„A haladásod nem kerül mentésre"**

Ez azt jelenti, hogy ha bezárod vagy frissíted az oldalt, a játékod elvész. Két lehetőséged van:

- **„Bejelentkezés / Regisztráció"** – Megnyílik a bejelentkezési ablak, ahol fiókot hozhatsz létre vagy bejelentkezhetsz.
- **„Folytatás mentés nélkül"** – A figyelmeztetés eltűnik, de a játék nem kerül mentésre.

---

## Fiók létrehozása és bejelentkezés

A fejléc jobb oldalán, a „💾 Login to save" gombra kattintva megnyílik a hitelesítési ablak.

### Regisztráció
1. Válaszd a **„Register"** / **„Regisztráció"** fület.
2. Add meg a felhasználónevedet, e-mail címedet és jelszavadat.
3. Kattints a **„Create account"** / **„Fiók létrehozása"** gombra.
4. Sikeres regisztráció után az alkalmazás automatikusan bejelentkeztet, és betölti a korábbi mentésedet (ha van).

### Bejelentkezés
1. Válaszd a **„Log in"** / **„Bejelentkezés"** fület.
2. Add meg az e-mail címedet és jelszavadat.
3. Kattints a **„Log in"** / **„Bejelentkezés"** gombra.

Ha hibás adatokat adsz meg, piros hibaüzenet jelenik meg a mezők alatt.

---

## A felület felépítése

Az alkalmazás három részre osztja a képernyőt:

```
┌─────────────────┬───────────────────────────┬──────────────────┐
│  Státuszoszlop  │         Kattintó          │  Egységek panel  │
│   (bal oldal)   │        (középen)          │   (jobb oldal)   │
└─────────────────┴───────────────────────────┴──────────────────┘
```

Keskenyebb ablaknál (tablet méret alatt, kb. 1120px szélesség alatt) a két oldalpanel
csak egy kicsit keskenyedik, hogy a Kattintónak több hely maradjon. Telefonon
(kb. 760px szélesség alatt) a Kattintó tölti ki a teljes szélességet, a két
oldalpanel pedig alulról felcsúszó lapként jelenik meg: a képernyő alján egy
„Stats" / „Shop" fület tartalmazó sáv nyitja meg őket. Egy nyitott panel
bezárható a saját fülére való újbóli koppintással, a panelen kívüli terület
megérintésével, vagy az Esc billentyűvel. A tokenegyenleg és a másodpercenkénti
termelés ilyenkor a fejlécben, kompakt formában marad látható.

---

## Státuszoszlop (bal oldal)

A bal oldali panel valós időben mutatja a játékod aktuális állását:

| Statisztika | Leírás |
|---|---|
| **Tokens** | Jelenlegi token egyenleg |
| **Per Second** | Hány tokent termelnek az egységeid másodpercenként |
| **Per Click** | Hány tokent kapsz egy kattintásért |
| **Total Earned** | Az összes valaha szerzett token (nem csökken vásárlásnál) |
| **Total Clicks** | Az összes eddigi kattintásod száma |
| **Time Played** | Az eltelt játékidő |
| **PhDs Earned** | Az eddig megszerzett PhD-k száma (lásd „Fokozat (Prestige)" lentebb) |

A token/s érték a játék elején 0.00-ként jelenik meg, amíg az első egységeket meg nem veszed.

A „Total Earned", „Total Clicks", „Time Played" és „PhDs Earned" statisztikák **egész játékodra** vonatkoznak, és fokozatszerzés (prestige) után sem állnak vissza. Ezek alatt egy „This Run" (Ez a menet) blokk mutatja ugyanezt **csak a jelenlegi menetre**: **Run Earned**, **Run Clicks**, **Run Time** — ezek nullázódnak minden fokozatszerzéskor.

---

## Kattintó (középen)

A kép Dr. Zuti Pál portréját ábrázolja. Kattints rá a tokenek megszerzéséhez! Minden kattintásra:
- A kör rövid animációt játszik le, gyors, egymást követő kattintásoknál is minden egyes alkalommal.
- Egy lebegő „+1" (vagy nagyobb, ha fejlesztéseket vásároltál) szám jelenik meg a kattintás helyén, majd felfele úszik és eltűnik. Egy **kritikus találat** (lásd lentebb, „Fejlesztések") nagyobb, feltűnőbb, arany színű számmal jelenik meg.
- A token egyenleged azonnal növekszik.

A bal és jobb egérgomb is számít kattintásnak — jobb gombbal kattintva nem
nyílik meg a böngésző saját menüje, a kattintás ugyanúgy tokent ér. A kör
billentyűzettel is elérhető (Tab), és Enter/Szóköz megnyomásával
kattintható. A portré nem húzható ki a köréből.

A kör alatti szám a **kattintás/másodperc** (CPS) tempódat mutatja — az
utóbbi két másodperced kattintásaiból számolva, csak akkor jelenik meg, ha
éppen kattintgatsz. (A másodpercenkénti token-termelésed — a „Per Second" —
a bal oldali Státuszoszlopban látható folyamatosan, illetve telefonon a
fejlécben, kompakt formában.)

### Boosterek

Időnként (átlagosan 1–5 percenként) egy pulzáló, arany színű ikon jelenik
meg valahol a Kattintó területén — sosem közvetlenül a kör fölött. Ez egy
**booster**: kattints rá, mielőtt eltűnik (kb. 10–20 másodpercig látható), és
1–2 percre az egyik alábbi bónuszt kapod:

- **Termelés-boost**: a másodpercenkénti termelésed sokszorosára nő.
- **Kattintás-boost**: a kattintásaid sokszorosára nőnek.
- **Kedvezmény**: az egységárak jelentősen csökkennek.

A booster típusa csak a begyűjtés pillanatában derül ki — egy rövid
értesítés (toast) jelzi, melyiket kaptad. Amíg egy booster aktív, egy
számláló-buborék jelenik meg a Kattintó tetején, ami mutatja, mennyi idő van
hátra. Ha lekésed a boostert, semmi nem veszik el — csak várnod kell a
következőre.

Bejelentkezve a boosterek a szerveren dőlnek el (a pontos időzítést és
típust a szerver választja, hogy senki ne tudjon csalással gyakrabban vagy
jobb boostereket szerezni), és túlélnek egy oldal-újratöltést is. Vendégként
a boosterek csak a böngésződben, helyben futnak, és — a többi vendég-
haladásoddal együtt — elvesznek, ha bezárod vagy frissíted a lapot.

---

## Egységek panel (jobb oldal)

A panel tetején egy **„Units" / „Upgrades"** fül-váltó választja el a két
alpanelt: az „Units" a lent leírt egység-boltot mutatja, az „Upgrades" pedig
a fejlesztéseket (lásd „Fejlesztések" lentebb).

### Szorzóválasztó

Az egységlista tetején öt gomb van: **1×, 5×, 10×, 50×, Max**. Ez határozza meg, hogy egyszerre hány egységet veszel meg, ha a „Buy" gombra kattintasz.

- A **Max** gomb automatikusan kiszámítja, hogy jelenlegi egyenlegedből mennyi egységet tudsz megvásárolni, és annyit vesz.

### Egységkártya

Minden egységnek saját kártyája van:

- **Bal oldal**: Az egység neve, száma (hány darabot birtok) és az egységenkénti termelés (token/s).
- **Jobb oldal**: A **Buy** gomb, rajta a szorzónak megfelelő mennyiség és az ár.
- Ha nincs elég tokened, a gomb szürkén jelenik meg és le van tiltva; a felirat „Need more tokens" / „Nincs elég token" lesz.

### Tooltip

Ha az egérkurzort egy egységkártya fölé viszed, egy kis ablak jelenik meg:
- **Cost**: Az aktuális vásárlás ára (a kiválasztott szorzónak megfelelő mennyiségre)
- **Income gain**: Mennyivel növekszik a másodpercenkénti termelésed a vásárlással
- **Each unit**: Egy egység termelése másodpercenként

### Az egységek láthatósága

Egy egység addig rejtett, amíg az összes szerzett tokened nem éri el az alap ára 10%-át. Minél több tokent szerzel, annál több egység jelenik meg a shopban.

---

## Fejlesztések (Upgrades)

Az „Upgrades" fülön (lásd fent) egy másik fajta vásárlás érhető el: a
**fejlesztések** — ezek nem termelnek, hanem közvetlenül a **kattintásod
erejét** növelik, és egyszer vehetők meg (nincs darabszám, mint az
egységeknél). Öt csoportba tartoznak:

- **Kattintási Erő**: fix mennyiséget ad hozzá minden kattintásodhoz.
- **Szorzók**: megduplázzák a kattintásod értékét (egymással szorzódnak).
- **Szinergia**: a másodpercenkénti termelésed egy kis százalékát is
  hozzáadja minden kattintáshoz — minél nagyobb a gazdaságod, annál többet
  ér egy kattintás.
- **Kritikus Találatok**: esélyt adnak arra, hogy egy kattintás sokszorosát
  érje a szokásosnak (lásd a Kattintó szekciót a feltűnő, arany számért).
  Ha több szintet is megveszel ebből a csoportból, csak a legerősebb (legdrágább) számít, nem adódnak össze.
- **Booster Előnyök**: a boosterek időtartamát hosszabbítják meg, illetve
  gyakoribbá teszik a megjelenésüket.

Egy fejlesztés ugyanúgy fokozatosan tárul fel, mint az egységek — minél
többet szereztél összesen, annál több fejlesztés jelenik meg a boltban. A
megvásárolt fejlesztések egy elkülönített, halványabb sávba kerülnek a lista
alján. **Fontos**: a fejlesztések, akárcsak az egységek, elvesznek
fokozatszerzéskor (lásd lent) — minden új menet a kattintás-erejét is
nulláról építi fel újra.

---

## Fokozat (Prestige)

Amint összesen (élete során, nem csak az aktuális menetben) legalább 100 000 tokent szereztél, a bal oldali oszlop alján megjelenik a **„Fokozat"** panel — ugyanaz a fokozatos feltárási logika, mint az egységeknél: a panel egyszer megjelenve mindig látható marad, akkor is, ha egy új menetet éppen csak elkezdtél. A tényleges fokozatszerzéshez (a „Defend Thesis" gomb aktiválódásához) az **aktuális menetben** kell legalább 1 000 000 tokent szerezned:

- **PHDS OWNED**: Az eddig megszerzett PhD-k száma.
- **+X% Production / -X% Unit cost**: A PhD-id által adott állandó bónuszok — minden PhD +2% termelést és -0,5% egységárat ad, a kedvezmény legfeljebb -50%-ig.
- **Progress to next PhD**: Egy folyamatjelző, ami mutatja, mennyire vagy közel a következő PhD-hoz.
- **„Defend Thesis" (Disszertáció megvédése) gomb**: Aktívvá válik, amint legalább 1 PhD-t érsz el az aktuális menetben.

A gombra kattintva egy megerősítő ablak jelenik meg, amely megmutatja, pontosan hány PhD-t kapnál, és hogyan változna a termelésed/egységáraid. **Fontos**: a fokozatszerzés véglegesen **visszaállítja a jelenlegi tokenjeidet, az összes megvásárolt egységet és fejlesztést, valamint a menet statisztikáit (Run Earned/Clicks/Time)**, cserébe a PhD-id és az ebből adódó bónuszok **véglegesen megmaradnak**, és minden jövőbeli menetedben érvényesülnek. Egy éppen aktív booster viszont túléli a fokozatszerzést — az egy időzített esemény, nem a menethez kötött haladás.

Vendégként is fokozatot szerezhetsz — ilyenkor a megerősítő ablak egy külön figyelmeztetést mutat, hogy a PhD-id (a többi haladásoddal együtt) elvesznek, ha bezárod a lapot bejelentkezés nélkül.

Sikeres fokozatszerzés után egy teljes képernyős „ünneplés" jelenik meg: a megszerzett PhD-k száma animálva számol fel, majd egy „Begin Anew" (Új kezdet) gombbal térhetsz vissza a (már visszaállított) játékhoz. Ez az ünneplés a Beállítások panelben „Brief"-re (Rövidre) kapcsolható, ekkor csak a megerősítő ablak jelenik meg, teljes képernyős animáció nélkül.

---

## Mentés és szinkronizálás

Ha be vagy jelentkezve, a fejlécben megjelennek a mentési vezérlők:

### „Sync" gomb
Azonnali mentés. A jelenlegi játékállapot (tokenek, egységek, statisztikák) elküldésre kerül a szerverre. Sikeres mentés esetén a gomb „✓"-re vált néhány másodpercre.

Az automatikus mentés be/ki kapcsolása és az időköz beállítása a **Beállítások** panelbe költözött (lásd lentebb) — a fejlécben csak a gyors „Sync" gomb és a felhasználói menü maradt.

### Felhasználói menü (`Felhasználónév`)
A felhasználónevedre kattintva legördülő menü jelenik meg:
- **„Delete save"** / **„Mentés törlése"**: Megerősítés után a mentési fájl véglegesen törlődik az adatbázisból. **Ez nem vonható vissza.**
- **„Log out"** / **„Kijelentkezés"**: Kijelentkezés a fiókból. A munkamenet megszűnik, de a játék helyben fut tovább (vendég módban).

Néhány telepítésen (csak ha az üzemeltető kifejezetten bekapcsolta) az **Alt+X**
billentyűkombináció megerősítés nélkül azonnal végrehajtja a fenti két
műveletet egyszerre — mentés törlése és kijelentkezés. Alapból ez a
gyorsbillentyű ki van kapcsolva, és a hivatalos játékban sem érhető el.

---

## Téma és nyelv

A fejléc jobb szélén gyorsgombok találhatók:

- **Nyelv**: Angolra vagy magyarra váltás. Az összes szöveg azonnal megváltozik.
- **Téma**: Sötét és világos megjelenési mód közötti váltás.
- **🏆 (kupa)**: Megnyitja a Ranglisták ablakot (lásd lentebb) — csak bejelentkezve látható.
- **⚙️ (fogaskerék)**: Megnyitja a teljes Beállítások panelt (lásd lentebb).

Bejelentkezve ezek a beállítások (a téma, a nyelv, az autosave és a fokozat-ünneplés preferencia) a szerveren is elmentődnek, így egy másik böngészőben vagy eszközön bejelentkezve automatikusan visszaáll ugyanaz a beállítás. Vendégként ezek csak a böngésződ helyi tárolójában (`localStorage`) maradnak meg — egy másik eszközön nem lesznek jelen.

---

## Ranglisták

A fejléc 🏆 gombjára kattintva (csak bejelentkezve érhető el) megnyílik a
Ranglisták ablak. Négy mérőszám közül választhatsz a fül-váltóval:

- **Tokens**: Az összes valaha szerzett token (mint a Státuszoszlop „Total Earned" mezője).
- **Clicks**: Az összes eddigi kattintás.
- **PhDs**: Az eddig megszerzett PhD-k száma.
- **Playtime**: Az eltelt játékidő.

A lista a legjobb játékosokat mutatja helyezés (Rank), felhasználónév (Player)
és érték (Value) szerint. Ha a saját helyezésed nincs benne a megjelenített
listában, egy külön, kiemelt sor jelenik meg alatta „A te helyezésed" felirattal.

**Adatvédelem**: a Beállítások panel „Privacy" szekciójában a „Hide me from
leaderboards" / „Elrejtés a ranglistákról" kapcsolóval elrejtheted magad mások
ranglistáiról — a saját ranglista-nézeted ekkor is megmutatja a helyezésedet,
csak egy jelzéssel, hogy jelenleg rejtve vagy mások elől.

---

## Beállítások

A fejléc ⚙️ gombjára kattintva megnyílik a Beállítások ablak, négy szekcióval:

- **Megjelenés**: Téma (Sötét/Világos), Nyelv (EN/HU).
- **Játék**: Fokozatszerzés ünneplése — **Full ceremony** (teljes képernyős animáció) vagy **Brief** (csak a megerősítő ablak). Érdemes az első néhány fokozatszerzés után Brief-re váltani, ha az animáció helyett gyorsabban szeretnél tovább játszani.
- **Mentés**: Automatikus mentés be/ki kapcsolása, és — ha be van kapcsolva — az időköz (15s / 30s / 1p / 5p).
- **Privacy**: „Hide me from leaderboards" / „Elrejtés a ranglistákról" — lásd fent, „Ranglisták".

A téma és a nyelv módosítása azonnal látszik, amíg az ablak nyitva van, de csak
akkor kerül ténylegesen elmentésre, ha a **„Done" (Kész)** gombbal zárod be az
ablakot — ekkor egy rövid értesítés (toast) jelzi, hogy a mentés sikerült-e
(bejelentkezve a szerverre is, vendégként csak erre az eszközre). A **„Cancel"
(Mégse)** gombbal, vagy az Esc billentyűvel az ablak úgy zárható be, hogy
minden módosítás visszaáll arra, ami az ablak megnyitásakor érvényben volt — az
ablakon kívülre kattintás nem zárja be az ablakot, csak ez a két gomb.

---

## Bezárás előtt

Ha az oldalon van bármi haladásod (legalább egy kattintás történt, vagy az egységeid már termeltek valamennyi tokent, vagy van legalább egy PhD-d), a böngésző figyelmeztet, ha megpróbálod bezárni vagy frissíteni az oldalt:

> „Biztosan el akarsz navigálni? Elveszítheted a módosításokat."

Ha be vagy jelentkezve és az autosave be van kapcsolva, a rendszer általában már elmenti az állapotot a figyelmeztetés megjelenése előtt. Ha nem, kattints a „Sync" gombra mielőtt bezárod az oldalt.
```
