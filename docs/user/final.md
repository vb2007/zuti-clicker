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

Vendégként mindent játszhatsz, **kivéve a fokozatszerzést** (és így a Tudományos pályát) — ehhez fiók kell. Amikor a függő PhD-nyereséged először eléri az 1, 5, 25, 125, … PhD-t, egy értesítés szól, egy **„Bejelentkezés / Regisztráció"** gombbal. Ha regisztrálsz vagy bejelentkezel, a vendégként játszott menet **veled jön** a fiókba (legfeljebb 24 óra játékidőig).

Ha a fiók létrehozása előtti haladásodat a szerver valamiért nem tudja ellenőrizni (például egy több mint egy napja futó vendég-lapnál), a mentés nem kerül a fiókba — ez **nem számít ellened**. Egy ablak két lehetőséget kínál: **„Játék folytatása vendégként"** (kijelentkezel, a haladásod a lap bezárásáig megmarad) vagy **„Új kezdés ezzel a fiókkal"** (a vendéghaladás elvész, a fiók nulláról indul). Ezt az ablakot nem lehet véletlenül bezárni, és amíg nem választasz, a játék nem ment.

---

## Fiók létrehozása és bejelentkezés

A fejléc jobb oldalán, a „💾 Login to save" gombra kattintva megnyílik a hitelesítési ablak.

### Regisztráció
1. Válaszd a **„Register"** / **„Regisztráció"** fület.
2. Add meg a felhasználónevedet, e-mail címedet és jelszavadat.
3. Kattints a **„Create account"** / **„Fiók létrehozása"** gombra.
4. Sikeres regisztráció után az alkalmazás automatikusan bejelentkeztet. Egy új fiók a vendégként addig játszott menetet viszi tovább; egy meglévő fiók a saját mentését tölti be.

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
bezárható a jobb felső sarkában lévő **✕** gombbal, a saját fülére való újbóli
koppintással, a panel fölötti elsötétített sáv megérintésével, a telefon
**Vissza** gombjával, vagy az Esc billentyűvel. A tokenegyenleg és a
másodpercenkénti termelés ilyenkor a fejlécben, kompakt formában marad látható.

Nagyon keskeny telefonon (kb. 400px szélesség alatt) a fejlécből eltűnik a
nyelv- és a témaváltó gomb, hogy minden más elférjen — mindkettő továbbra is
elérhető a Beállítások ablakban. Fekvő telefonon a fejléc egy sorba tömörül, és
a Kattintó kisebb, hogy a felirata és a számláló is a képernyőn maradjon. A
Kattintó körének mérete egyébként a rendelkezésre álló helyhez igazodik: nagy
monitoron (kb. 1200px szélesség fölött) nagyobb, mint korábban, telefonon és
tipikus ablakméretnél az eredeti méretű.

### Ablakok bezárása

A felugró ablakokat (Ranglisták, Beállítások, Bejelentkezés, Upgrader) a jobb
felső sarkukban lévő **✕** gombbal, az Esc billentyűvel, a telefon **Vissza**
gombjával, vagy — a Beállítások kivételével — az ablakon kívülre koppintva
zárhatod be. A Beállításokban a ✕ a „Mégse" gombbal egyenértékű (a módosítások
visszaállnak). Ha több ablak van egymás fölött, a Vissza gomb és az Esc mindig
a legfelsőt zárja be, egyszerre egyet — a játékból a Vissza gomb nem lép ki,
amíg van nyitott ablak vagy panel. A kérdést feltevő ablakoknak (törlés
megerősítése, fokozatszerzés megerősítése, vendégfigyelmeztetés, anti-cheat
figyelmeztetés) saját gombjaik vannak, azokon kell választanod.

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
| **PhDs Held** | A jelenleg birtokolt PhD-k száma (lásd „Fokozat (Prestige)" lentebb) — ha már fektettél be a Tudományos pályába, alatta egy **PhDs Invested** sor is mutatja, mennyit |

A token/s érték a játék elején 0.00-ként jelenik meg, amíg az első egységeket meg nem veszed.

A „Total Earned", „Total Clicks", „Time Played" és „PhDs Held" statisztikák **egész játékodra** vonatkoznak, és fokozatszerzés (prestige) után sem állnak vissza. Ezek alatt egy „This Run" (Ez a menet) blokk mutatja ugyanezt **csak a jelenlegi menetre**: **Run Earned**, **Run Clicks**, **Run Time** — ezek nullázódnak minden fokozatszerzéskor.

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
értesítés (toast) jelzi, melyiket kaptad, a pontos hatással együtt (pl.
„×7 production" vagy „-25% prices"), nem csak a fantázianévvel. Amíg egy
booster aktív, egy buborék jelenik meg a Kattintó tetején, amely a nevet, a
konkrét hatást és a hátralévő időt is mutatja. Emellett az érintett
statisztika — a Státuszoszlop „Per Second" vagy „Per Click" sora — is
kiemelt színt kap egy „×N" jelvénnyel, a kedvezmény-booster pedig az
Egységek panel fejlécén egy „-N% unit prices" jelvényt és az érintett
egységek árának színét is megváltoztatja. Ha lekésed a boostert, semmi nem
veszik el — csak várnod kell a következőre.

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

Ha az egérkurzort egy egységkártya fölé viszed (érintőképernyőn: ha rákoppintasz
a név melletti **ⓘ** gombra; egy újabb koppintás, vagy egy máshová koppintás
bezárja), egy kis ablak jelenik meg. Ha lent nem fér el, fölötte nyílik meg:
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
egységeknél). **Fontos**: egyik fejlesztés sem érinti a másodpercenkénti
termelésedet („Per Second") — csak a kattintást. Négy csoportba tartoznak,
mindegyik egy rövid magyarázattal a fejlesztések listája fölött:

- **Kattintás Értéke**: fix mennyiséget ad hozzá minden kattintásodhoz,
  majd megszorozza azt.
- **Bevétel-szinergia**: a másodpercenkénti termelésed egy kis százalékát is
  hozzáadja minden kattintáshoz — minél nagyobb a gazdaságod, annál többet
  ér egy kattintás.
- **Kritikus Találatok**: esélyt adnak arra, hogy egy kattintás sokszorosát
  érje a szokásosnak (lásd a Kattintó szekciót a feltűnő, arany számért).
  Ha több szintet is megveszel ebből a csoportból, csak a legerősebb
  (legdrágább) számít, nem adódnak össze — a gyengébb, felülírt szinteket a
  megszerzett fejlesztések listája „Felülírva" jelöléssel, elhalványítva
  mutatja, hogy lásd, mi hat ténylegesen.
- **Boosterek**: a boosterek időtartamát hosszabbítják meg, illetve
  gyakoribbá teszik a megjelenésüket.

**Érintőképernyőn** egy csempére koppintás azonnal megveszi a fejlesztést — hogy
megvásárlás előtt el tudd olvasni, mit csinál, **nyomd hosszan** a csempét (kb.
fél másodpercig): megjelenik a leírása, és ez a nyomás **nem vásárol**. A
gyors, egymás utáni koppintások sosem számítanak hosszú nyomásnak, így
gyorsan is vásárolhatsz. Az előnézet addig marad, amíg máshová nem
koppintasz. Egérrel és billentyűzettel a tooltip a csempe fölé állva (vagy
fókuszra) jelenik meg, és — mivel a még nem megfizethető fejlesztéseknek is
megvan a leírásuk — az is olvasható, amit még nem tudsz megvenni.

Egy fejlesztés ugyanúgy fokozatosan tárul fel, mint az egységek — minél
többet szereztél összesen, annál több fejlesztés jelenik meg a boltban. A
megvásárolt fejlesztések egy elkülönített sávba kerülnek a lista alján,
ugyanazokba a csoportokba rendezve, mindegyik csoport élén a jelenlegi
összesített hatással (pl. „+0.5% of income", „15% ×7") — így nemcsak az
látszik, mit vettél meg, hanem az is, mennyit ér ténylegesen összesen.
**Fontos**: a fejlesztések, akárcsak az egységek, elvesznek
fokozatszerzéskor (lásd lent) — minden új menet a kattintás-erejét is
nulláról építi fel újra.

---

## Fokozat (Prestige)

Amint összesen (élete során, nem csak az aktuális menetben) legalább 100 000 tokent szereztél, a bal oldali oszlop alján megjelenik a **„Fokozat"** panel — ugyanaz a fokozatos feltárási logika, mint az egységeknél: a panel egyszer megjelenve mindig látható marad, akkor is, ha egy új menetet éppen csak elkezdtél. A tényleges fokozatszerzéshez (a „Defend Thesis" gomb aktiválódásához) az **aktuális menetben** kell legalább 1 000 000 tokent szerezned:

- **PHDS OWNED**: A jelenleg birtokolt PhD-k száma (a Tudományos pályába befektetettek nélkül).
- **Progress to next PhD**: Egy folyamatjelző, ami mutatja, mennyire vagy közel a következő PhD-hoz, alatta pedig egy sor mutatja, pontosan mennyi token hiányzik még hozzá.
- **„Defend Thesis" (Disszertáció megvédése) gomb**: Aktívvá válik, amint legalább 1 PhD-t érsz el az aktuális menetben.

Amint legalább 1 PhD-t elértél az aktuális menetben, a panel megváltozik: a
gomb felirata kiegészül a pontos megszerezhető PhD-számmal (pl. „Defend
Thesis ×2"), a folyamatjelző pedig átvált „Progress to +3 PhD"-ra — vagyis
onnantól már a *következő* PhD-hoz méri a haladást, nem az aktuálisan már
megszerezhetőhöz (ezért nulláz vissza 0%-ra, amint elérsz egy új PhD-t —
ez nem veszteség, hanem egy új sáv eleje).

A PhD-id állandó bónuszait (+2% termelés / -0,5% egységár PhD-nként, a
kedvezmény legfeljebb -50%-ig) és a fokozatszerzés utáni pontos „előtte →
utána" hatást a panel már nem mutatja — ezek kizárólag a gombra kattintva
megnyíló megerősítő ablakban jelennek meg, hogy a bal oldali oszlop ne
duplikálja ugyanazt a két számot. A megerősítő ablak azt is megmutatja,
pontosan hány PhD-t kapnál. **Fontos**: a fokozatszerzés véglegesen
**visszaállítja a jelenlegi tokenjeidet, az összes megvásárolt egységet és
fejlesztést, valamint a menet statisztikáit (Run Earned/Clicks/Time)** — kivéve
azt, amit a Tudományos pályád megtart (egységek egy része, fejlesztéscsaládok,
kezdőtőke; a megerősítő ablak felsorolja) —, cserébe a PhD-id és az ebből adódó bónuszok **véglegesen megmaradnak**, és
minden jövőbeli menetedben érvényesülnek. Egy éppen aktív booster viszont
túléli a fokozatszerzést — az egy időzített esemény, nem a menethez kötött
haladás.

A fokozatszerzéshez **fiók kell**. Vendégként a gomb felirata „Védéshez jelentkezz be" (a megszerezhető PhD-k számával), és a bejelentkezési ablakot nyitja meg; a menetedet a fiók átveszi, így bejelentkezés után ott folytathatod, ahol tartottál.

Sikeres fokozatszerzés után egy teljes képernyős „ünneplés" jelenik meg: a megszerzett PhD-k száma animálva számol fel, majd egy „Begin Anew" (Új kezdet) gombbal térhetsz vissza a (már visszaállított) játékhoz. Utána megnyílik a **Tudományos pálya** vásárlási ablaka (lásd lent): itt befektetheted a PhD-ket, vagy megtarthatod őket — az új menet akkor indul, amikor végeztél. Ez az ünneplés a Beállítások panelben „Brief"-re (Rövidre) kapcsolható, ekkor csak a megerősítő ablak jelenik meg, teljes képernyős animáció nélkül.

---

## Upgrader (PhD-kerék)

Az első fokozatszerzésed után a „Fokozat" panelen, a „Defend Thesis" gomb alatt megjelenik egy **„Upgrader"** gomb (és onnantól mindig látható marad, akkor is, ha elfogytak a PhD-id). Rákattintva egy felugró ablak nyílik a játék fölött: itt feltehetsz egy általad választott mennyiségű PhD-t egy kerékre, és **esélyed van többet nyerni — vagy elveszíteni a feltett PhD-ket.**

**A kerék az igazi esélyt mutatja.** A kerék borostyánsárga íve pontosan akkora, amekkora az esélyed a nyerésre; közepén a százalékos érték áll. A kerék alatt két mező mutatja, mi történik, ha nyersz, illetve ha veszítesz (és mekkora eséllyel). A pörgetés eredményét a szerver sorsolja ki, a kerék pedig pontosan arra a helyre áll meg — nincs „megrendezett" majdnem-nyerés.

**Mit állíthatsz be:**

- **Tét (Stake)**: hány PhD-t teszel fel (bármennyit, amid van). A 10% / 25% / 50% / Max gombokkal gyorsan beállíthatod a készleted egy részét.
- **Szorzó (Multiplier)**: ×1,5 / ×2 / ×3 / ×5 / ×10 gombok, vagy a csúszka ×1,2 és ×100 között (két tizedesig). Minél nagyobb a szorzó, annál kisebb az esélyed. Példák (100 PhD tétnél): ×1,5 → 60%, ×2 → 45%, ×3 → 30%, ×5 → 18%, ×10 → 9%, ×100 → 0,9%.

**Nyerés**: a feltett PhD-id helyett `tét × szorzó` PhD-t kapsz (lefelé kerekítve). **Vesztés**: a feltett PhD-id elvesznek, de vigaszdíjként egy **Értékelési Roham** (×7 termelés) boostert kapsz, amelynek hossza arányos azzal, a készleted hányadát tetted fel (a teljes készleted feltétele 60 másodperc; ha már fut egy roham, az meghosszabbodik, legfeljebb 120 másodpercig). Egészen kis tétért (a készleted töredékéért) nem jár vigaszdíj — a kerék ilyenkor kiírja.

**Nem lehet túl jól járni vele**: sok pörgetés alatt a tét átlagosan kb. **90%-át** nyered vissza, és a nyerési esély **sosem haladja meg a 80%-ot**, akármilyen kicsi a szorzó. A kerék tehát kockázat, nem PhD-farm. Egy fogadás csak akkor érvényes, ha a nyeremény több a tétnél (pl. 1 PhD ×1,5-tel csak 1-et érne, ezért nem lehet) — ilyenkor az ablak kiírja a legkisebb érvényes tétet.

**Fekvő telefonon** az ablak két oszlopra bomlik — balra a kerék és a két kimenet, jobbra a tét, a szorzó és a „Spin" gomb —, így az egész fogadás egyszerre látszik; függőlegesen tartva, vagy keskenyebb fekvő képernyőn egy oszlop marad, a ✕ gomb pedig görgetés közben is a helyén marad.

**Pörgetés közben** a vezérlők zárolva vannak, és a vásárlás/fokozatszerzés is szünetel. A bal oldali PhD-számláló a kerék megállásáig a régi értéket mutatja, hogy ne áruljon el semmit előre. Az eredmény (nyertél/vesztettél, az új PhD-készleted) a kerék megállása után jelenik meg, a „Spin again" gombbal pedig újra pörgethetsz.

**Bejelentkezve** a pörgetés előtt a játék automatikusan elmenti az állapotodat, és az eredmény a szerveren is rögzül. Ha ugyanazt a fiókot egy másik lapon is használod, és ott pörgettél, ezen a lapon a következő mentés „a haladásod máshol megváltozott" értesítést kap, és a legfrissebb mentést tölti be. Mivel PhD-t csak fokozatszerzéssel lehet szerezni, a fokozatszerzés pedig fiókhoz kötött, a kerék a gyakorlatban **bejelentkezve** használható.

A PhD-ranglista a birtokolt és a Tudományos pályába befektetett PhD-id összegét mutatja, ezért az Upgrader nyeresége és vesztesége közvetlenül befolyásolja a helyezésedet (a befektetés viszont nem). Egy pörgetés tétje legfeljebb 2 147 483 647 PhD lehet.

## Tudományos pálya (Academic Career)

A PhD-k másik, **végleges** felhasználási módja. Az első fokozatszerzésed után a „Fokozat" panelen megjelenik a **„Tudományos pálya"** gomb (mellette, hogy a fa hány csomópontja a tiéd már, pl. „12/253"). Egy teljes képernyős fát nyit meg: alul a gyökér (**Habilitáció**), fölötte hat ág ágazik szét felfelé — **Kutatás** (termelés), **Oktatás** (kattintás, kritikus találat, előadói lendület), **Adminisztráció** (árak, és ami megmarad fokozatszerzéskor), **Konferenciák** (boosterek), **Disszertáció** (maguk a PhD-k) és **Labor** (automatizálás). Összesen ~250 csomópont; mindegyik **egyetlen** dolgot javít. A megvett csomópontok **örökre a tiéid** — a fokozatszerzés sem veszi el őket.

**Mikor lehet vásárolni?** Csak közvetlenül egy fokozatszerzés után. A fokozatszerzés (és az ünneplés) után a fa magától megnyílik: ez a **vásárlási ablak**. Az ablak alatt a játék **szünetel** — az új menet akkor indul, amikor végeztél. Az ablakot véletlenül nem lehet bezárni (az Esc, a Vissza gomb és a fára kattintás sem zárja be); csak a lap alján lévő gombbal: **„Megtartom a PhD-ket"** (ha semmit nem vettél), vagy **„Kész"**. Ha közben bezárod a lapot, bejelentkezve a következő megnyitáskor (akár másik eszközön is) a fa ugyanott vár. Máskor a Fokozat panel gombjával bármikor megnézheted a fát, de akkor csak olvasható.

**Megtartani vagy befektetni?** Amit befektetsz, az a PhD már nem „birtokolt": **elveszíti a +2% termelés / −0,5% egységár bónuszát.** A részletpanel ezért vásárlás előtt kiírja, mennyi lesz utána a PhD-bónuszod (pl. „×7,80 → ×7,56"), és a vásárlás teljes hatását a termelésedre („Termelés összesen: ×0,98"). Ha egy vásárlás a termelésed nagy részét elvinné, ez a sor sárgán, feltűnően jelenik meg. A legtöbbször megéri a PhD-k egy részét megtartani — a fa egésze **jó néhány száz óra játék**, a leggyorsabb stratégiával is legalább ~100.

**A fa olvasása:**

- **Teli kék** kör: már a tiéd.
- **Teli kék, szaggatott sárga gyűrűvel**: ebben az ablakban vetted — még **visszavonhatod**.
- **Kék gyűrű**: most megvehető (megvan az előfeltétele, és van rá elég PhD-d).
- **Sima gyűrű**: elérhető, de még nincs rá elég PhD-d (vagy nincs nyitva az ablak).
- **Szaggatott, halvány kör**: zárolt — előbb az alatta lévőt kell megvenned.
- A nagyobb, ikonos körök a **kulcscsomópontok** (egyedi névvel), a kisebb, római számos körök egy sáv fokozatai (pl. „Pályázatírás IV").

A „?" gomb (a nagyítás fölött) ugyanezt a jelmagyarázatot mutatja.

**Mozgatás:** húzd (egérrel vagy egy ujjal) a fát; **két ujjal** csippentve, egérgörgővel vagy a +/− gombokkal nagyíthatsz; a negyedik gomb az egész fát mutatja; dupla koppintás ott nagyít. Egy csomópontra koppintva (kattintva) megnyílik a részletpanel — ez **nem vásárol**, a vásárláshoz a panel gombja kell. Billentyűzettel a nyilak a fában lépkednek (fel: a ráépülő csomópont, le: az előfeltétel, oldalra: a szomszéd). Telefonon a részletpanel alulról csúszik be (fekvő telefonon jobbról), és a kiválasztott csomópont fölötte marad látható.

**Visszavonás:** amit az aktuális ablakban vettél, az ablak bezárásáig visszavonhatod — teljes áron, **a ráépülő, szintén most vett csomópontokkal együtt** (a gomb kiírja, mennyit és hány PhD-t kapsz vissza). A korábbi ablakokban vett csomópontok véglegesek. Ha az ablak nyitva van, és mégis elindul a menet (pl. egy másik lapon kattintasz), a vásárlásaid véglegessé válnak.

**Amit a fa adhat** — néhány a különlegesebbek közül:

- **Előadói lendület**: ha folyamatosan kattintasz, egy mérő töltődik (a kattintás/mp jelző mellett látszik), és a kattintásaid többet érnek; szünetben a mérő lassan elfogy.
- **Demonstrátorok**: automatikusan kattintanak helyetted (a bevételt adják, de nem számítanak a kattintás-statisztikádba).
- **Beszerzési előadó / Fejlesztési ügyintéző**: automatikusan megveszik a legjobb ár-érték arányú egységet, illetve a legolcsóbb fejlesztést, amint megengedheted. A boltban egy **„Auto"** kapcsolóval ki-be kapcsolhatod őket (a kapcsoló állását ez a böngésző jegyzi meg).
- **Véglegesítés, Alapítványi vagyon, Indulótámogatás**: fokozatszerzéskor minden egység egy része, bizonyos fejlesztéscsaládok és egy kezdőtőke **megmarad**. Ezek a **következő** fokozatszerzéstől hatnak (a panel kiírja), és a fokozatszerzés megerősítő ablaka is felsorolja, mi marad meg.
- **Új boosterek**: a **Kutatási Bónusz** azonnal jóváír néhány perc termelést, a **Heuréka-pillanat** egy ideig +50% kritikus esélyt ad.
- **Disszertáció ág**: több PhD fokozatszerzésenként, és erősebb bónusz minden birtokolt PhD után.

A Tudományos pálya — a fokozatszerzéshez hasonlóan — **fiókhoz kötött**: vendégként nem lehet vásárolni rajta.

A **PhD-ranglista** a birtokolt és a befektetett PhD-id **összegét** mutatja, így a fába fektetés nem ront a helyezéseden.

---

## Mentés és szinkronizálás

Ha be vagy jelentkezve, a fejlécben megjelennek a mentési vezérlők:

### „Sync" gomb
Azonnali mentés. A jelenlegi játékállapot (tokenek, egységek, statisztikák) elküldésre kerül a szerverre. Sikeres mentés esetén a gomb „✓"-re vált néhány másodpercre.

Az automatikus mentés be/ki kapcsolása és az időköz beállítása a **Beállítások** panelbe költözött (lásd lentebb) — a fejlécben csak a gyors „Sync" gomb és a felhasználói menü maradt.

### Felhasználói menü (`Felhasználónév`)
A felhasználónevedre kattintva legördülő menü jelenik meg:
- **„Delete save"** / **„Mentés törlése"**: Megerősítés után a mentési fájl véglegesen törlődik az adatbázisból. **Ez nem vonható vissza.**
- **„Log out"** / **„Kijelentkezés"**: Kijelentkezés a fiókból. Előbb a játék elmenti a legfrissebb állapotodat, aztán kijelentkezel, és a játék **friss vendégként** indul újra (a fiókod haladása a szerveren vár). Ha a mentés nem sikerül (pl. nincs internet), a játék megkérdezi, hogy mentés nélkül is kijelentkezel-e — ilyenkor az utolsó mentés óta elért haladás elvész.

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
- **PhDs**: A birtokolt és a Tudományos pályába befektetett PhD-k összege.
- **Playtime**: Az eltelt játékidő.

Az ablakot a jobb felső ✕ gombbal (vagy a Vissza gombbal) zárhatod be. Keskeny
telefonon a négy mérőszám-gomb 2×2-es rácsba rendeződik. A lista a legjobb játékosokat mutatja helyezés (Rank), felhasználónév (Player)
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

Az ablak alján, a gombok felett egy halvány sor mutatja, pontosan melyik
verzió fut éppen: „Frontend vX.Y.Z · API vX.Y.Z". A frontend verziója a
build-be van égetve, az API verziója pedig egy gyors lekérdezéssel érkezik,
amint az ablak először megnyílik — ha ez a lekérdezés bármiért nem sikerül, a
frontend verziója akkor is látszik, az API helyén egy „—" jelenik meg.

---

## Tisztességes játék

A játék a háttérben figyeli, hogy a kattintásaid és a vásárlásaid emberi
tempóban, valódi böngésző-interakcióval történnek-e — ez automatikus
kattintó-programok (auto-clicker), böngésző-automatizálás (pl. Tampermonkey-
szkript) és a mentési adatok közvetlen, a játékon kívüli meghamisítása ellen
véd. A rendszer szándékosan **nagyvonalú**: két kéz egyszerre használata
(egér + szóköz + enter), egy gyors kattintás-sorozat vagy egy szerencsés
menet önmagában sosem elég a beavatkozáshoz — csak egyértelmű,
automatizálásra utaló minta.

Ha a rendszer ilyen mintát észlel:

- Egy felugró ablak jelzi, hogy a fiókodon szokatlan aktivitást találtunk.
- A kattintás, a vásárlás és a fokozatszerzés az ablakban jelzett
  visszaszámlálás lejártáig szünetel — az idle (automatikus) termelés is,
  tehát a haladásod ezalatt nem nő.
- A visszaszámlálás rövid (néhány perc) első alkalommal, de minden
  ismétlődő esetben jelentősen hosszabb lesz.
- Öt egymást követő eset után a mentésed nullázódik — ez a rendszer
  legszigorúbb lépése, de a fiókod sosem kerül végleges kitiltásra, és a
  visszaszámlálás lejárta után a játék azonnal folytatható.

A visszaszámlálás közben a „Got it" / „Értem" gombbal bezárhatod az ablakot
anélkül, hogy ez feloldaná a korlátozást — a gombok addig tiltva maradnak,
amíg az idő le nem jár. Amíg egy fiók korlátozás alatt áll, ideiglenesen nem
jelenik meg mások ranglistáin (a saját nézeted továbbra is mutatja a
helyezésedet); a korlátozás lejárta után ez automatikusan visszaáll, nincs
tartós következmény.

Ha úgy gondolod, hogy a rendszer tévesen jelzett — pl. mert egy szokatlan
egér vagy kisegítő eszköz (assistive technology) használatával játszol —,
a visszaszámlálás lejárta után a játék normálisan folytatódik, és a
korlátozások idővel (hosszabb, tisztán eltöltött idő után) enyhülnek.

A telefonod lezárása, egy alkalmazásváltás, vagy a böngészőlap háttérbe
küldése közben eltöltött idő sosem okoz korlátozást — ha visszatérsz, a
játék egyszerűen ott folytatja a méréseit, ahol tartott. Ugyanígy a fokozat
(prestige) megszerzése és az azt követő mentés is biztonságos, még akkor is,
ha ugyanabban a pillanatban történik. Mobilon vagy érintőképernyőn játszva
az érintéseidet a rendszer külön kezeli az egérkattintásoktól, így egy
gyors, kétujjas koppintási ütem önmagában sosem vált ki figyelmeztetést.

---

## Bezárás előtt

Ha az oldalon van bármi haladásod (legalább egy kattintás történt, vagy az egységeid már termeltek valamennyi tokent, vagy van legalább egy PhD-d), a böngésző figyelmeztet, ha megpróbálod bezárni vagy frissíteni az oldalt:

> „Biztosan el akarsz navigálni? Elveszítheted a módosításokat."

Ha be vagy jelentkezve és az autosave be van kapcsolva, a rendszer általában már elmenti az állapotot a figyelmeztetés megjelenése előtt. Ha nem, kattints a „Sync" gombra mielőtt bezárod az oldalt.
```
