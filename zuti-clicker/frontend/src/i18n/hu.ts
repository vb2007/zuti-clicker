export default {
  app: { title: "Zuti Clicker", titleCompact: "Zuti" },
  common: { close: "Bezárás" },
  status: {
    title: "Haladás",
    tokens: "Tokenek",
    perSecond: "Másodpercenként",
    perClick: "Klikkenként",
    totalEarned: "Összes szerzett",
    totalClicks: "Összes kattintás",
    timePlayed: "Játékidő",
    phdCount: "Birtokolt PhD",
    phdInvested: "Befektetett PhD",
    thisRun: "Ez a menet",
    runEarned: "Menetben szerzett",
    runClicks: "Menetbeli kattintás",
    runTime: "Menetidő"
  },
  clicker: {
    hint: "Kattints a tokenekért!",
    ariaLabel: "Kattints Dr. Zuti Pál portréjára tokenekért",
    cps: "kattintás/mp"
  },
  nav: {
    title: "Panelek",
    stats: "Statisztika",
    shop: "Bolt"
  },
  units: {
    title: "Egységek",
    owned: "db",
    noAfford: "Nincs elég token",
    multipliers: { max: "Max" },
    tooltipCost: "Ár",
    tooltipGain: "Bevétel növekedés",
    tooltipEach: "Egységenként",
    moreInfo: "További információ",
    pricesDiscounted: "-{pct}% egységár",
    names: {
      alpha: "Alfa",
      beta: "Béta",
      gamma: "Gamma",
      delta: "Delta",
      epsilon: "Epszilon",
      zeta: "Zéta",
      eta: "Éta",
      theta: "Théta"
    },
    descriptions: {
      alpha: "Egyszerű token-generátor.",
      beta: "Fejlettebb generáló egység.",
      gamma: "Haladó token-aratógép.",
      delta: "Ipari token-üzem.",
      epsilon: "Szuper-hatékony token-motor.",
      zeta: "Kvantum token-gyorsító.",
      eta: "Kozmikus token-szintetizátor.",
      theta: "Dimenziós token-kinyerő."
    }
  },
  upgrades: {
    title: "Fejlesztések",
    ownedCount: "{owned} / {total} megszerezve",
    ownedTitle: "Megszerzett",
    emptyHint: "Gyűjts tovább tokeneket — hamarosan megjelenik itt az első fejlesztésed.",
    tooltipCost: "Ár",
    tooltipEffect: "Hatás",
    clickOnlyNote:
      "A fejlesztések csak a kattintásodat érintik — a másodpercenkénti termelést egyik sem.",
    familyClickValue: "Kattintás Értéke",
    familySynergy: "Bevétel-szinergia",
    familyCrit: "Kritikus Találatok",
    familyBooster: "Boosterek",
    groupDescClickValue: "Fix tokent ad minden kattintáshoz, majd megszorozza.",
    groupDescSynergy: "A másodpercenkénti termelésed egy részét minden kattintáshoz hozzáadja.",
    groupDescCrit: "Esély arra, hogy egy kattintás többszörösét érje.",
    groupDescBooster: "Hosszabb bónuszok, gyakrabban.",
    superseded: "Felülírva",
    aggregateSynergy: "+{pct}% a bevételből",
    aggregateCrit: "{pct}% ×{mult}",
    aggregateBoosterDuration: "+{pct}% időtartam",
    aggregateBoosterSpawn: "+{pct}% gyakoriság",
    names: {
      chalk: "Kréta",
      redPen: "Piros Toll",
      laserPointer: "Lézermutató",
      overheadProjector: "Írásvetítő",
      firmHandshake: "Határozott Kézfogás",
      morningCoffee: "Reggeli Kávé",
      officeHours: "Fogadóóra",
      tenure: "Véglegesítés",
      honoraryDegree: "Díszdoktori Cím",
      lectureNotes: "Előadásjegyzet",
      seminarRoom: "Szemináriumi Terem",
      researchGrant: "Kutatási Ösztöndíj",
      facultyBoard: "Kari Tanács",
      luckyGuess: "Szerencsés Tipp",
      openBookExam: "Nyílt Könyves Vizsga",
      peerReview: "Szakmai Lektorálás",
      conferenceBadge: "Konferencia Kitűző",
      departmentNewsletter: "Tanszéki Hírlevél"
    },
    descriptions: {
      chalk: "Egy megbízható darab kréta minden pontodat kiélezi.",
      redPen: "Minden kattintást egy kicsit hangsúlyosabbá tesz.",
      laserPointer: "Az osztály — és a számláló — figyelmét is felkelti.",
      overheadProjector: "A kattintásaidat egy sokkal nagyobb vászonra vetíti.",
      firmHandshake: "Egy magabiztos üdvözlés megduplázza a benyomást, amit keltesz.",
      morningCoffee: "Kiélesíti a fókuszt az első óra előtt.",
      officeHours: "Extra idő arra, hogy a dolgokat rendesen elvégezd.",
      tenure: "Egy állandó pozíció, állandóan jobb kattintásokkal.",
      honoraryDegree: "Egy elismerés, amely önmagáért beszél.",
      lectureNotes: "A jól rendszerezett jegyzet a passzív bevételt aktív meglátássá alakítja.",
      seminarRoom: "A kiscsoportos megbeszélés minden kattintást kiélez.",
      researchGrant: "A finanszírozás a termelést inspirációvá alakítja.",
      facultyBoard: "Egy hely az asztalnál, ahol a nagy döntések születnek.",
      luckyGuess: "Néha egyszerűen csak tudod a választ.",
      openBookExam: "Ha kéznél van az anyag, nagyobb az esélye a tökéletes válasznak.",
      peerReview: "Az alapos átvizsgálás időnként valami zseniálisra bukkan.",
      conferenceBadge: "Ha egyszer bejelentkeztél, a jó dolgok tovább tartanak.",
      departmentNewsletter: "A hír gyorsabban terjed, ha mindenki rajta van a listán."
    }
  },
  boosters: {
    pickupAriaLabel: "Rejtélyes booster begyűjtése",
    claimedToast: "{name} aktiválva!",
    claimedToastWithEffect: "{name} aktiválva — {effect}",
    claimFailed: "Nem sikerült begyűjteni a boostert — próbáld újra később.",
    names: {
      frenzy: "Értékelési Roham",
      clickStorm: "Röpdolgozat",
      clearance: "Eszközkiárusítás",
      windfall: "Kutatási Bónusz",
      critStorm: "Heuréka-pillanat"
    },
    effect: {
      production: "×{mult} termelés",
      click: "×{mult} kattintásonként",
      costReduction: "-{pct}% ár",
      instant: "azonnali tokenjóváírás",
      instantAmount: "+{amount} token",
      crit: "+{pct}% kritikus esély"
    }
  },
  career: {
    title: "Tudományos pálya",
    openBtn: "Tudományos pálya",
    progress: "{owned} / {total} csomópont",
    statsHeld: "Birtokolt PhD",
    statsInvested: "Befektetve",
    statsBonus: "PhD-bónusz",
    statsBonusValue: "×{mult} termelés",
    windowIntro:
      "A fokozatszerzés megnyitotta a pályádat. Fektesd be a PhD-ket végleges fejlesztésekbe — vagy tartsd meg őket, hiszen minden birtokolt PhD növeli a termelést. Az új menet akkor indul, amikor végeztél.",
    windowIntroShort: "Fektesd be a PhD-ket, vagy tartsd meg — a menet utána indul.",
    viewIntro: "A pályád végleges. Új csomópontokat minden fokozatszerzés után vásárolhatsz.",
    skip: "Megtartom a PhD-ket",
    done: "Kész",
    footerNote: "Az új menet akkor indul, amikor végeztél.",
    buy: "Megveszem: {cost} PhD",
    refundOne: "Visszavonás · +{phd} PhD",
    refundCascade: "{count} csomópont visszavonása · +{phd} PhD",
    refundNote:
      "Ezen fokozatszerzés óta vetted — még visszavonhatod, a ráépülő csomópontokkal együtt.",
    owned: "Végleg a tiéd.",
    locked: "Feltétel: {name}.",
    needPhd: "{cost} PhD kell hozzá — {held} van.",
    viewOnly: "A következő fokozatszerzésed után veheted meg.",
    nextPrestige: "A következő fokozatszerzéstől érvényes.",
    tradeoff: "PhD-bónusz: ×{before} → ×{after}",
    netProduction: "Termelés összesen: ×{mult}",
    legendBtn: "Jelmagyarázat",
    cost: "Ár",
    selectHint: "Koppints vagy kattints egy csomópontra a részletekért.",
    zoomIn: "Nagyítás",
    zoomOut: "Kicsinyítés",
    fit: "Az egész fa",
    legendOwned: "Megvan",
    legendRefundable: "Most vetted",
    legendBuyable: "Megvehető",
    legendLocked: "Zárolt",
    stateOwned: "megvan",
    stateRefundable: "most vetted, visszavonható",
    stateBuyable: "megvehető",
    stateAvailable: "elérhető",
    stateLocked: "zárolt",
    nodeAria: "{name}, {state}",
    canvasLabel:
      "Tudományos pálya fa. Húzással vagy csippentéssel mozgathatod és nagyíthatod; a nyilakkal léphetsz a csomópontok között.",
    bought: "Megvetted: {name}.",
    refunded: "Visszavonva: {count} csomópont, +{phd} PhD.",
    autoBuy: "Auto",
    autoBuyUnits: "Egységek automatikus vásárlása",
    autoBuyUpgrades: "Fejlesztések automatikus vásárlása",
    momentum: "Lendület +{pct}%",
    keepsUnits: "minden egység {pct}%-a megmarad",
    keepsFamilies: "megmaradnak ezek a fejlesztések: {families}",
    startsWith: "a menet {amount} tokennel indul",
    prestigeKeeps: "Tudományos pálya: {list}.",
    busy: "Folyamatban…",
    branches: {
      root: "Habilitáció",
      research: "Kutatás",
      lecturing: "Oktatás",
      administration: "Adminisztráció",
      conferences: "Konferenciák",
      thesis: "Disszertáció",
      lab: "Labor"
    },
    nodes: {
      habilitation: { name: "Habilitáció", desc: "Minden pálya egy újabb értekezéssel kezdődik." },
      labAccess: { name: "Laborbelépő", desc: "Belépőkártya a jó műszerekhez." },
      researchGroup: { name: "Kutatócsoport", desc: "Sok kéz, sok kísérlet." },
      institute: { name: "Intézet", desc: "Saját épület, saját költségvetési sor." },
      nationalLab: { name: "Nemzeti Laboratórium", desc: "Kutatás országos léptékben." },
      nobelNomination: {
        name: "Nobel-jelölés",
        desc: "Elsőre senki sem nyeri meg. Már a jelölés is sokat számít."
      },
      lecturer: { name: "Előadó", desc: "Saját kurzus, saját előadóterem." },
      lectureMomentum: {
        name: "Előadói lendület",
        desc: "Kattints folyamatosan, és a terem bemelegszik: a lendület kattintásbónuszt épít, ami szünetben elhalványul."
      },
      seminarLeader: {
        name: "Szemináriumvezető",
        desc: "Minden vita a teljes tanszék teljesítményéből merít."
      },
      examiner: { name: "Vizsgáztató", desc: "Pontosan tudod, mikor zseniális egy válasz." },
      standingOvation: { name: "Vastaps", desc: "A ritka előadás, amikor feláll a terem." },
      departmentBudget: { name: "Tanszéki költségvetés", desc: "Végre külön tétel a műszerekre." },
      seedFunding: {
        name: "Indulótámogatás",
        desc: "Minden projekt valamennyi pénzzel indul a számlán."
      },
      tenureTrack: {
        name: "Véglegesítési pálya",
        desc: "Amit felépítettél, annak egy része a félév végén is megmarad."
      },
      endowment: {
        name: "Alapítványi vagyon",
        desc: "Tartós alap tart kéznél bizonyos eszközöket."
      },
      bulkPurchasing: { name: "Tömeges beszerzés", desc: "A beszerzési iroda végre alkudni kezd." },
      conferenceSeason: {
        name: "Konferenciaszezon",
        desc: "A jó ötletek tovább tartanak, ha megosztod őket."
      },
      callForPapers: { name: "Felhívás előadásokra", desc: "A lehetőségek gyakrabban jönnek." },
      posterSession: { name: "Poszterszekció", desc: "Az eredményeid tovább maradnak a falon." },
      keynoteSpeaker: { name: "Plenáris előadó", desc: "Néha egy előadás mellé támogatás is jár." },
      symposium: { name: "Szimpózium", desc: "Egy teremnyi szakértő hirtelen felismerést szül." },
      doctoralSchool: { name: "Doktori iskola", desc: "Több jelölt, több megvédett értekezés." },
      academicPrestige: {
        name: "Tudományos presztízs",
        desc: "Minden birtokolt fokozat többet nyom a latban."
      },
      fundingCommittee: {
        name: "Pályázati bizottság",
        desc: "A fokozataid nagyobb kedvezményt nyitnak meg."
      },
      habilitationCommittee: {
        name: "Habilitációs bizottság",
        desc: "Most már az asztal másik oldalán ülsz."
      },
      professorEmeritus: {
        name: "Professor emeritus",
        desc: "Egy életmű, ami még mindig kamatozik."
      },
      teachingAssistant: {
        name: "Demonstrátor",
        desc: "Valaki más is kattint egy kicsit, amíg gondolkodsz."
      },
      purchasingOfficer: {
        name: "Beszerzési előadó",
        desc: "Megveszi a legjobb ár-érték arányú egységet, amint megengedheted."
      },
      upgradeClerk: {
        name: "Fejlesztési ügyintéző",
        desc: "Megveszi a legolcsóbb fejlesztést, amit megengedhetsz."
      },
      secondAssistant: { name: "Második demonstrátor", desc: "Két pár kéz többet ér egynél." }
    },
    tracks: {
      grantWriting: "Pályázatírás",
      unitStudies: "{unit}-kutatás",
      peerReviewedPapers: "Lektorált cikkek",
      citationIndex: "Idézettségi index",
      fieldWork: "Terepmunka",
      rhetoric: "Retorika",
      momentum: "Lendület",
      appliedTheory: "Alkalmazott elmélet",
      popQuizInstinct: "Röpdolgozat-ösztön",
      eureka: "Heuréka",
      officeHours: "Fogadóóra",
      procurement: "Beszerzés",
      startupFund: "Induló alap",
      tenure: "Véglegesítés",
      archives: "Archívum",
      bursary: "Ösztöndíjkeret",
      accounting: "Könyvelés",
      networking: "Kapcsolatépítés",
      mailingList: "Levelezőlista",
      posterBoard: "Poszterfal",
      speakerFee: "Előadói díj",
      frenzyPotency: "Roham-erősítés",
      popQuizPotency: "Röpdolgozat-erősítés",
      clearancePotency: "Kiárusítás-erősítés",
      citations: "Hivatkozások",
      reputation: "Hírnév",
      scholarships: "Ösztöndíjak",
      legacy: "Örökség",
      dissertations: "Disszertációk",
      taTraining: "Demonstrátorképzés",
      taHours: "Demonstrátori órák"
    },
    effects: {
      productionPct: "+{pct}% termelés",
      productionMult: "×{mult} termelés",
      unitProductionMult: "×{mult} {unit}-termelés",
      clickMult: "×{mult} kattintásérték",
      clickSynergyAdd: "A bevételed +{pct}%-a minden kattintáshoz",
      critChanceAdd: "+{pct}% kritikus esély",
      critMultAdd: "+{mult}× kritikus szorzó",
      momentumMax: "+{pct}% előadói lendület (maximum)",
      unitCostDiscount: "-{pct}% egységár",
      upgradeCostDiscount: "-{pct}% fejlesztésár",
      startingTokens: "Minden menet +{amount} tokennel indul",
      keepUnitsPct: "Minden egység {pct}%-a megmarad fokozatszerzéskor",
      keepUpgradeFamily: "{family}: a fejlesztések megmaradnak fokozatszerzéskor",
      boosterDurationPct: "+{pct}% booster-időtartam",
      boosterSpawnPct: "+{pct}% booster-gyakoriság",
      boosterWindowPct: "A boosterek +{pct}%-kal tovább gyűjthetők be",
      boosterPotencyPct: "{booster}: +{pct}% erősség",
      unlockBooster: "Új booster: {booster}",
      windfallSecs: "{booster}: +{secs} mp termelés",
      phdGainPct: "+{pct}% PhD fokozatszerzésenként",
      phdProductionBonusAdd: "+{pct}% termelés minden birtokolt PhD után",
      phdCostCapAdd: "+{pct}% maximális PhD-árkedvezmény",
      autoClickRate: "+{rate} automatikus kattintás másodpercenként",
      autoBuyUnits: "Egységeket vásárol helyetted",
      autoBuyUpgrades: "Fejlesztéseket vásárol helyetted"
    },
    families: {
      flat: "Fix kattintás",
      multiplier: "Kattintásszorzó",
      synergy: "Bevételi szinergia",
      crit: "Kritikus találat",
      booster: "Booster"
    },
    guestTreeDropped:
      "A vendégként felépített Tudományos pályád nem kerül át a fiókodba — a PhD-ket visszakaptad, kivéve azokat, amelyeket maga a fa hozott neked. A következő fokozatszerzés után újra befektetheted őket.",
    errors: {
      syncFailed: "Nem sikerült előbb elmenteni a haladásodat — próbáld újra egy pillanat múlva.",
      windowClosed: "A Tudományos pálya csak közvetlenül egy fokozatszerzés után módosítható.",
      insufficient: "Nincs elég PhD-d ehhez a csomóponthoz.",
      changed: "A Tudományos pályád máshol megváltozott — frissítettük.",
      generic: "Ez nem sikerült — próbáld újra.",
      loginRequired: "A Tudományos pályán vásárláshoz jelentkezz be vagy regisztrálj.",
      unconfirmed: "Nem sikerült megerősíteni a változtatást — a haladásodat újratöltöttük.",
      newWindow: "Egy újabb fokozatszerzés új ablakot nyitott — ott folytathatod a befektetést.",
      closeFailed: "Nem sikerült bezárni a Tudományos pályát — próbáld újra."
    }
  },
  settings: {
    toggleTheme: "Téma váltás",
    language: "Nyelv",
    open: "Beállítások",
    title: "Beállítások",
    appearance: "Megjelenés",
    theme: "Téma",
    themeDark: "Sötét",
    themeLight: "Világos",
    game: "Játék",
    ceremonyLabel: "Fokozatszerzés ünneplése",
    ceremonyFull: "Teljes ünneplés",
    ceremonyBrief: "Rövid",
    saving: "Mentés",
    autosave: "Automatikus mentés",
    autosaveInterval: "Gyakoriság",
    privacy: "Adatvédelem",
    hideFromLeaderboards: "Elrejtés a ranglistákról",
    intervals: {
      "15": "15s",
      "30": "30s",
      "60": "1p",
      "300": "5p"
    },
    cancelBtn: "Mégse",
    closeBtn: "Kész",
    saved: "Beállítások elmentve",
    savedLocal: "Beállítások elmentve ezen az eszközön",
    saveFailed: "Nem sikerült menteni a beállításokat — ezen az eszközön elmentve",
    versions: "Frontend v{frontend} · API v{api}"
  },
  auth: {
    modalAriaLabel: "Bejelentkezés vagy fiók létrehozása",
    loginTab: "Bejelentkezés",
    registerTab: "Regisztráció",
    emailLabel: "E-mail",
    usernameLabel: "Felhasználónév",
    passwordLabel: "Jelszó",
    loginBtn: "Bejelentkezés",
    registerBtn: "Fiók létrehozása",
    switchToRegister: "Még nincs fiókod? Regisztrálj",
    switchToLogin: "Már van fiókod? Jelentkezz be"
  },
  save: {
    sync: "Mentés",
    syncing: "Mentés…",
    neverSynced: "Nincs mentve",
    deleteSave: "Mentés törlése",
    logout: "Kijelentkezés",
    loginToSave: "Bejelentkezés a mentéshez",
    staleReloaded:
      "A haladásod máshol (pl. egy másik lapon) megváltozott, ezért a legfrissebb mentést töltöttük be.",
    implausibleReloaded:
      "A legutóbbi haladásodat nem tudtuk ellenőrizni, ezért a legutóbb ellenőrzött mentésedet töltöttük be.",
    implausibleReloadFailed: "A legutóbb ellenőrzött mentésedet még nem sikerült betölteni — újrapróbáljuk.",
    rateLimited: "Túl gyors mentés — a haladásod megmarad, és hamarosan elmentjük.",
    firstSaveRejected: {
      title: "A vendégként elért haladásod nem került át ebbe a fiókba",
      body:
        "A fiók létrehozása előtt elért haladásodat nem tudtuk ellenőrizni, ezért nem mentettük el a fiókba. Ez nem számít ellened, és a fiókod ellen sem.",
      keepBtn: "Játék folytatása vendégként",
      keepNote: "Kijelentkezel. A haladásod a lap bezárásáig megmarad.",
      freshBtn: "Új kezdés ezzel a fiókkal",
      freshNote: "A vendéghaladásod elvész, a fiók nulláról indul."
    },
    logoutUnsaved: {
      title: "Kijelentkezel mentés nélkül?",
      body:
        "A legfrissebb haladásodat nem sikerült menteni. Ha most kijelentkezel, az utolsó mentés óta elért haladásod elvész.",
      confirmBtn: "Kijelentkezés így is"
    }
  },
  guest: {
    warningTitle: "A haladásod nem kerül mentésre",
    warningBody:
      "Vendégként játszol. Jelentkezz be vagy regisztrálj, hogy felhőbe mentsd a játékod és fokozatot szerezhess — ez a menet veled jön.",
    loginBtn: "Bejelentkezés / Regisztráció",
    continueBtn: "Folytatás mentés nélkül",
    reminderPhd:
      "Kész a disszertációd: +{n} PhD. Jelentkezz be vagy regisztrálj a megvédéséhez — ez a menet veled jön."
  },
  confirm: {
    deleteSaveTitle: "Törlöd a mentést?",
    deleteSaveBody: "Ez véglegesen törli a mentett játékod. Ezt nem lehet visszavonni.",
    deleteBtn: "Törlés",
    cancelBtn: "Mégse",
    prestigeTitle: "Megvéded a disszertációdat?",
    prestigeGain: "{gain} PhD fokozatot szerzel.",
    prestigeLose: "A tokenjeid, egységeid és a menet eddigi haladása visszaáll.",
    prestigeConfirmBtn: "Disszertáció megvédése"
  },
  upgrader: {
    title: "Upgrader",
    openBtn: "Upgrader",
    owned: "{phd} PhD-d van",
    wheelAria: "Kerék: {pct}% esély a nyerésre",
    stake: "Tét",
    stakeChipAria: "A PhD-id {pct}%-ának feltétele",
    stakeAllAria: "Az összes PhD feltétele",
    stakeMax: "Max",
    multiplier: "Szorzó",
    multiplierSlider: "Egyéni szorzó",
    win: "Nyer",
    lose: "Veszít",
    chanceCentre: "a nyerésre",
    frenzyOnLoss: "{name} {seconds} mp-ig",
    noFrenzyOnLoss: "Túl kicsi tét ehhez: {name}",
    spin: "Pörgetés",
    spinAgain: "Újra",
    spinning: "Pörög…",
    resultWin: "Nyertél {gain} PhD-t.",
    resultWinTotal: "Most {total} PhD-d van.",
    resultLose: "Elvesztettél {stake} PhD-t.",
    resultFrenzy: "{name} {seconds} mp-ig aktív.",
    problems: {
      noPhd: "A pörgetéshez legalább 1 PhD kell.",
      enterStake: "Add meg, hány PhD-t teszel fel.",
      tooMany: "Legfeljebb {owned} PhD-t tehetsz fel.",
      tooSmall:
        "×{mult} szorzónál a tét legalább {min} PhD legyen, különben a nyeremény nem több a tétnél.",
      restricted: "A fiókod ideiglenesen korlátozott."
    },
    finePrint:
      "Sok pörgetés alatt a tét kb. {rtp}%-át nyered vissza. A nyerési esély sosem haladja meg a {cap}%-ot.",
    guestNote: "Vendég vagy — az itt nyert vagy elvesztett PhD-k nem mentődnek.",
    guestSpinsDropped:
      "Vendégként a keréken nyert vagy elvesztett PhD-k nem kerülnek át a fiókodba.",
    errors: {
      unconfirmed:
        "Nem tudtuk megerősíteni a pörgetést, ezért újratöltöttük a haladásod a szerverről.",
      syncFailed: "Nem sikerült elmenteni a haladásod pörgetés előtt, ezért a pörgetés elmaradt.",
      insufficient: "Nincs ennyi PhD-d, amit feltehetnél.",
      limit: "Ez a pörgetés a PhD-k felső korlátja fölé vinné az összeget.",
      invalid: "Ez a tét vagy szorzó nem érvényes.",
      generic: "A pörgetés nem sikerült. Próbáld újra."
    }
  },
  prestige: {
    title: "Fokozat",
    lockedProgress: "Haladás a következő PhD-ig",
    tokensToNext: "{amount} hiányzik",
    progressToNextGain: "Haladás +{next}. PhD felé",
    phdOwned: "Megszerzett PhD",
    production: "Termelés",
    costDiscount: "Egységár",
    button: "Disszertáció megvédése",
    loginToPrestige: "Védéshez jelentkezz be",
    guestNote:
      "A fokozatszerzéshez fiók kell. Regisztrálj vagy jelentkezz be — ez a menet veled jön.",
    ceremonyGained: "Megszerzett PhD",
    ceremonySubtext: "A kutatásod tartósan megerősíti minden jövőbeli menetet.",
    continueBtn: "Új kezdet"
  },
  leaderboard: {
    open: "Ranglisták",
    title: "Ranglisták",
    metricTokens: "Tokenek",
    metricClicks: "Kattintások",
    metricPhd: "PhD-k",
    metricPlaytime: "Játékidő",
    rank: "Hely.",
    player: "Játékos",
    value: "Érték",
    yourRank: "A te helyezésed",
    hiddenNote: "El vagy rejtve mások ranglistáiról.",
    empty: "Még nincs játékos ezen a ranglistán.",
    loadError: "Nem sikerült betölteni a ranglistát."
  },
  anticheat: {
    title: "Haladás szüneteltetve",
    body: "Ezen a fiókon automatizált vagy szokatlanul gyors bevitelt észleltünk. A kattintás, a vásárlás és a fokozat az alábbi visszaszámlálás lejártáig szünetel.",
    timeRemaining: "Hátralévő idő",
    strikeNote:
      "Ez már {count}. alkalommal történt meg ezen a fiókon. A korlátozás minden alkalommal hosszabb.",
    dismissBtn: "Értem"
  }
};
