export default {
  app: { title: "Zuti Clicker", titleCompact: "Zuti" },
  common: { close: "Close" },
  status: {
    title: "Progress",
    tokens: "Tokens",
    perSecond: "Per Second",
    perClick: "Per Click",
    totalEarned: "Total Earned",
    totalClicks: "Total Clicks",
    timePlayed: "Time Played",
    phdCount: "PhDs Held",
    phdInvested: "PhDs Invested",
    thisRun: "This Run",
    runEarned: "Run Earned",
    runClicks: "Run Clicks",
    runTime: "Run Time"
  },
  clicker: {
    hint: "Click to earn tokens!",
    ariaLabel: "Click Dr. Zuti Pál's portrait to earn tokens",
    cps: "clicks/s"
  },
  nav: {
    title: "Panels",
    stats: "Stats",
    shop: "Shop"
  },
  units: {
    title: "Units",
    owned: "owned",
    noAfford: "Need more tokens",
    multipliers: { max: "Max" },
    tooltipCost: "Cost",
    tooltipGain: "Income gain",
    tooltipEach: "Each unit",
    moreInfo: "More info",
    pricesDiscounted: "-{pct}% unit prices",
    names: {
      alpha: "Alpha",
      beta: "Beta",
      gamma: "Gamma",
      delta: "Delta",
      epsilon: "Epsilon",
      zeta: "Zeta",
      eta: "Eta",
      theta: "Theta"
    },
    descriptions: {
      alpha: "A basic token generator.",
      beta: "An improved generation unit.",
      gamma: "Advanced token harvester.",
      delta: "Industrial token factory.",
      epsilon: "Hyper-efficient token engine.",
      zeta: "Quantum token accelerator.",
      eta: "Cosmic token synthesizer.",
      theta: "Dimensional token extractor."
    }
  },
  upgrades: {
    title: "Upgrades",
    ownedCount: "{owned} / {total} owned",
    ownedTitle: "Owned",
    emptyHint: "Keep earning tokens — your first upgrade will appear here soon.",
    tooltipCost: "Cost",
    tooltipEffect: "Effect",
    clickOnlyNote: "Upgrades only affect your click — none of them touch tokens/sec.",
    familyClickValue: "Click Value",
    familySynergy: "Income Synergy",
    familyCrit: "Critical Hits",
    familyBooster: "Boosters",
    groupDescClickValue: "Flat tokens added to every click, then multiplied.",
    groupDescSynergy: "Adds a share of your tokens/sec to every click.",
    groupDescCrit: "Chance for a click to pay several times over.",
    groupDescBooster: "Longer buffs, more often.",
    superseded: "Superseded",
    aggregateSynergy: "+{pct}% of income",
    aggregateCrit: "{pct}% ×{mult}",
    aggregateBoosterDuration: "+{pct}% duration",
    aggregateBoosterSpawn: "+{pct}% frequency",
    names: {
      chalk: "Chalk",
      redPen: "Red Pen",
      laserPointer: "Laser Pointer",
      overheadProjector: "Overhead Projector",
      firmHandshake: "Firm Handshake",
      morningCoffee: "Morning Coffee",
      officeHours: "Office Hours",
      tenure: "Tenure",
      honoraryDegree: "Honorary Degree",
      lectureNotes: "Lecture Notes",
      seminarRoom: "Seminar Room",
      researchGrant: "Research Grant",
      facultyBoard: "Faculty Board",
      luckyGuess: "Lucky Guess",
      openBookExam: "Open-Book Exam",
      peerReview: "Peer Review",
      conferenceBadge: "Conference Badge",
      departmentNewsletter: "Department Newsletter"
    },
    descriptions: {
      chalk: "A trusty stick of chalk sharpens every point you make.",
      redPen: "Marks every click with a little more emphasis.",
      laserPointer: "Draws the class's — and the counter's — attention.",
      overheadProjector: "Projects your clicking onto a much bigger screen.",
      firmHandshake: "A confident greeting doubles the impression you make.",
      morningCoffee: "Sharpens focus before the first lecture.",
      officeHours: "Extra time dedicated to getting things done right.",
      tenure: "A permanent position, permanently better clicks.",
      honoraryDegree: "An honor that speaks for itself.",
      lectureNotes: "Well-organized notes turn passive income into active insight.",
      seminarRoom: "Small-group discussion sharpens every click.",
      researchGrant: "Funding that turns production into inspiration.",
      facultyBoard: "A seat at the table where the big decisions get made.",
      luckyGuess: "Sometimes you just know the answer.",
      openBookExam: "Having the material at hand raises the odds of a perfect answer.",
      peerReview: "Rigorous scrutiny occasionally turns up something brilliant.",
      conferenceBadge: "Once you're checked in, the good stuff lasts longer.",
      departmentNewsletter: "Word travels faster when everyone's on the mailing list."
    }
  },
  boosters: {
    pickupAriaLabel: "Claim a mystery booster",
    claimedToast: "{name} activated!",
    claimedToastWithEffect: "{name} activated — {effect}",
    claimFailed: "Couldn't claim the booster — try again later.",
    names: {
      frenzy: "Grading Frenzy",
      clickStorm: "Pop Quiz",
      clearance: "Equipment Clearance",
      windfall: "Research Windfall",
      critStorm: "Eureka Moment"
    },
    effect: {
      production: "×{mult} production",
      click: "×{mult} per click",
      costReduction: "-{pct}% prices",
      instant: "an instant token grant",
      instantAmount: "+{amount} tokens",
      crit: "+{pct}% crit chance"
    }
  },
  career: {
    title: "Academic Career",
    openBtn: "Academic Career",
    progress: "{owned} of {total} nodes",
    statsHeld: "PhDs held",
    statsInvested: "Invested",
    statsBonus: "Held PhD bonus",
    statsBonusValue: "×{mult} production",
    windowIntro:
      "Your prestige opened your career. Invest PhDs in permanent upgrades — or keep them, since every PhD you hold boosts production. The new run starts when you're done.",
    windowIntroShort: "Invest PhDs now, or keep them — the run starts when you're done.",
    viewIntro: "Your career is permanent. New nodes can be bought right after each prestige.",
    skip: "Keep my PhDs",
    done: "Done",
    footerNote: "The new run starts when you're done.",
    buy: "Buy for {cost} PhD",
    refundOne: "Undo · +{phd} PhD",
    refundCascade: "Undo {count} nodes · +{phd} PhD",
    refundNote:
      "Bought since this prestige — you can still undo it, together with everything bought on top of it.",
    owned: "Yours for good.",
    locked: "Unlocks after {name}.",
    needPhd: "Needs {cost} PhD — you hold {held}.",
    viewOnly: "You can buy this right after your next prestige.",
    nextPrestige: "Takes effect from your next prestige.",
    tradeoff: "Held PhD bonus: ×{before} → ×{after}",
    netProduction: "Production overall: ×{mult}",
    legendBtn: "Legend",
    cost: "Cost",
    selectHint: "Tap or click a node to see what it does.",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fit: "Show the whole tree",
    legendOwned: "Owned",
    legendRefundable: "Bought now",
    legendBuyable: "Can buy",
    legendLocked: "Locked",
    stateOwned: "owned",
    stateRefundable: "bought now, can be undone",
    stateBuyable: "can buy",
    stateAvailable: "available",
    stateLocked: "locked",
    nodeAria: "{name}, {state}",
    canvasLabel:
      "Academic Career tree. Drag or pinch to move and zoom; arrow keys move between nodes.",
    bought: "Bought {name}.",
    refunded: "Undone: {count} node(s), +{phd} PhD.",
    autoBuy: "Auto",
    autoBuyUnits: "Buy units automatically",
    autoBuyUpgrades: "Buy upgrades automatically",
    momentum: "Momentum +{pct}%",
    keepsUnits: "keeps {pct}% of every unit",
    keepsFamilies: "keeps your {families} upgrades",
    startsWith: "starts the run with {amount} tokens",
    prestigeKeeps: "Academic Career: {list}.",
    busy: "Working…",
    branches: {
      root: "Habilitation",
      research: "Research",
      lecturing: "Lecturing",
      administration: "Administration",
      conferences: "Conferences",
      thesis: "Thesis",
      lab: "Lab Assistants"
    },
    nodes: {
      habilitation: { name: "Habilitation", desc: "Every career starts with one more thesis." },
      labAccess: { name: "Lab Access", desc: "A key card to the good equipment." },
      researchGroup: { name: "Research Group", desc: "Many hands, many experiments." },
      institute: { name: "Institute", desc: "Your own building, your own budget line." },
      nationalLab: { name: "National Laboratory", desc: "Research at a national scale." },
      nobelNomination: {
        name: "Nobel Nomination",
        desc: "Nobody wins on the first try. Being nominated already counts."
      },
      lecturer: { name: "Lecturer", desc: "Your own course, your own lecture hall." },
      lectureMomentum: {
        name: "Lecture Momentum",
        desc: "Keep clicking and the room warms up: momentum builds a click bonus that fades when you pause."
      },
      seminarLeader: {
        name: "Seminar Leader",
        desc: "Every discussion draws on the whole department's output."
      },
      examiner: { name: "Examiner", desc: "You know exactly when an answer is brilliant." },
      standingOvation: {
        name: "Standing Ovation",
        desc: "The rare lecture that brings the hall to its feet."
      },
      departmentBudget: { name: "Department Budget", desc: "A line item for equipment, at last." },
      seedFunding: {
        name: "Seed Funding",
        desc: "Every project starts with something in the account."
      },
      tenureTrack: {
        name: "Tenure Track",
        desc: "Some of what you built stays when the semester ends."
      },
      endowment: { name: "Endowment", desc: "Lasting funds keep certain tools on hand." },
      bulkPurchasing: {
        name: "Bulk Purchasing",
        desc: "The procurement office finally negotiates."
      },
      conferenceSeason: {
        name: "Conference Season",
        desc: "Good ideas last longer when they're shared."
      },
      callForPapers: { name: "Call for Papers", desc: "Opportunities come around more often." },
      posterSession: { name: "Poster Session", desc: "Your findings stay on the board longer." },
      keynoteSpeaker: {
        name: "Keynote Speaker",
        desc: "Sometimes a talk comes with funding attached."
      },
      symposium: { name: "Symposium", desc: "A room full of experts sparks sudden insight." },
      doctoralSchool: { name: "Doctoral School", desc: "More candidates, more theses defended." },
      academicPrestige: {
        name: "Academic Prestige",
        desc: "Every degree you hold carries more weight."
      },
      fundingCommittee: { name: "Funding Committee", desc: "Your degrees open deeper discounts." },
      habilitationCommittee: {
        name: "Habilitation Committee",
        desc: "Now you sit on the other side of the table."
      },
      professorEmeritus: {
        name: "Professor Emeritus",
        desc: "A lifetime of work, still paying dividends."
      },
      teachingAssistant: {
        name: "Teaching Assistant",
        desc: "Someone else clicks a little while you think."
      },
      purchasingOfficer: {
        name: "Purchasing Officer",
        desc: "Buys the best-value unit whenever you can afford one."
      },
      upgradeClerk: { name: "Upgrade Clerk", desc: "Buys the cheapest upgrade you can afford." },
      secondAssistant: { name: "Second Assistant", desc: "Two pairs of hands are better than one." }
    },
    tracks: {
      grantWriting: "Grant Writing",
      unitStudies: "{unit} Studies",
      peerReviewedPapers: "Peer-Reviewed Papers",
      citationIndex: "Citation Index",
      fieldWork: "Field Work",
      rhetoric: "Rhetoric",
      momentum: "Momentum",
      appliedTheory: "Applied Theory",
      popQuizInstinct: "Pop Quiz Instinct",
      eureka: "Eureka",
      officeHours: "Office Hours",
      procurement: "Procurement",
      startupFund: "Startup Fund",
      tenure: "Tenure",
      archives: "Archives",
      bursary: "Bursary",
      accounting: "Accounting",
      networking: "Networking",
      mailingList: "Mailing List",
      posterBoard: "Poster Board",
      speakerFee: "Speaker Fee",
      frenzyPotency: "Frenzy Potency",
      popQuizPotency: "Pop Quiz Potency",
      clearancePotency: "Clearance Potency",
      citations: "Citations",
      reputation: "Reputation",
      scholarships: "Scholarships",
      legacy: "Legacy",
      dissertations: "Dissertations",
      taTraining: "TA Training",
      taHours: "TA Hours"
    },
    effects: {
      productionPct: "+{pct}% production",
      productionMult: "×{mult} production",
      unitProductionMult: "×{mult} {unit} production",
      clickMult: "×{mult} click value",
      clickSynergyAdd: "+{pct}% of your income added to every click",
      critChanceAdd: "+{pct}% critical hit chance",
      critMultAdd: "+{mult}× critical hit multiplier",
      momentumMax: "+{pct}% Lecture momentum cap",
      unitCostDiscount: "-{pct}% unit prices",
      upgradeCostDiscount: "-{pct}% upgrade prices",
      startingTokens: "Every run starts with +{amount} tokens",
      keepUnitsPct: "Keep {pct}% of every unit through a prestige",
      keepUpgradeFamily: "{family} upgrades survive a prestige",
      boosterDurationPct: "+{pct}% booster duration",
      boosterSpawnPct: "+{pct}% booster frequency",
      boosterWindowPct: "Booster pickups stay +{pct}% longer",
      boosterPotencyPct: "{booster}: +{pct}% strength",
      unlockBooster: "New booster: {booster}",
      windfallSecs: "{booster}: +{secs}s of production",
      phdGainPct: "+{pct}% PhDs per prestige",
      phdProductionBonusAdd: "+{pct}% production per PhD held",
      phdCostCapAdd: "+{pct}% maximum PhD price discount",
      autoClickRate: "+{rate} automatic clicks per second",
      autoBuyUnits: "Buys units for you",
      autoBuyUpgrades: "Buys upgrades for you"
    },
    families: {
      flat: "Flat click",
      multiplier: "Click multiplier",
      synergy: "Income synergy",
      crit: "Critical hit",
      booster: "Booster"
    },
    guestTreeDropped:
      "Your guest Academic Career doesn't carry over to an account — its PhDs were refunded, minus any extra PhDs the tree itself earned you. Re-invest them after your next prestige.",
    errors: {
      syncFailed: "Couldn't save your progress first — try again in a moment.",
      windowClosed: "The Academic Career can only be changed right after a prestige.",
      insufficient: "Not enough PhDs for that node.",
      changed: "Your Academic Career changed elsewhere — it has been updated.",
      generic: "That didn't work — try again.",
      loginRequired: "Log in or register to buy from the Academic Career.",
      unconfirmed: "Couldn't confirm that change — your progress has been reloaded.",
      newWindow: "A newer prestige opened a new window — keep investing or finish there.",
      closeFailed: "Couldn't close the Academic Career — try again."
    }
  },
  settings: {
    toggleTheme: "Toggle theme",
    language: "Language",
    open: "Settings",
    title: "Settings",
    appearance: "Appearance",
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    game: "Game",
    ceremonyLabel: "Prestige ceremony",
    ceremonyFull: "Full ceremony",
    ceremonyBrief: "Brief",
    saving: "Saving",
    autosave: "Autosave",
    autosaveInterval: "Interval",
    privacy: "Privacy",
    hideFromLeaderboards: "Hide me from leaderboards",
    intervals: {
      "15": "15s",
      "30": "30s",
      "60": "1m",
      "300": "5m"
    },
    cancelBtn: "Cancel",
    closeBtn: "Done",
    saved: "Settings saved",
    savedLocal: "Settings saved on this device",
    saveFailed: "Couldn't save settings — they're saved on this device",
    versions: "Frontend v{frontend} · API v{api}"
  },
  auth: {
    modalAriaLabel: "Log in or create an account",
    loginTab: "Log in",
    registerTab: "Register",
    emailLabel: "Email",
    usernameLabel: "Username",
    passwordLabel: "Password",
    loginBtn: "Log in",
    registerBtn: "Create account",
    switchToRegister: "Don't have an account? Register",
    switchToLogin: "Already have an account? Log in"
  },
  save: {
    sync: "Sync",
    syncing: "Syncing…",
    neverSynced: "Not synced",
    deleteSave: "Delete save",
    logout: "Log out",
    loginToSave: "Login to save",
    staleReloaded: "Your progress changed elsewhere (another tab?), so the latest save was loaded.",
    firstSaveRejected: {
      title: "Your guest progress couldn't move to this account",
      body:
        "The progress you made before creating this account couldn't be verified, so it wasn't saved to it. Nothing counts against you or the account.",
      keepBtn: "Keep playing as a guest",
      keepNote: "Logs you out. Your progress stays in this tab until you close it.",
      freshBtn: "Start this account fresh",
      freshNote: "Your guest progress is discarded and the account starts from zero."
    },
    logoutUnsaved: {
      title: "Log out without saving?",
      body:
        "Your latest progress couldn't be saved. If you log out now, everything since your last sync is lost.",
      confirmBtn: "Log out anyway"
    }
  },
  guest: {
    warningTitle: "Progress won't be saved",
    warningBody:
      "You're playing as a guest. Log in or register to back up your game to the cloud and to prestige — this run comes with you.",
    loginBtn: "Log in / Register",
    continueBtn: "Continue without saving",
    reminderPhd:
      "Your thesis is ready: +{n} PhD. Log in or register to defend it — this run comes with you."
  },
  confirm: {
    deleteSaveTitle: "Delete save file?",
    deleteSaveBody: "This will permanently erase your saved game. This cannot be undone.",
    deleteBtn: "Delete",
    cancelBtn: "Cancel",
    prestigeTitle: "Defend your thesis?",
    prestigeGain: "You will earn {gain} PhD.",
    prestigeLose: "Your tokens, units, and this run's progress will reset.",
    prestigeConfirmBtn: "Defend Thesis"
  },
  upgrader: {
    title: "Upgrader",
    openBtn: "Upgrader",
    owned: "You have {phd} PhD",
    wheelAria: "Wheel: {pct}% chance to win",
    stake: "Stake",
    stakeChipAria: "Stake {pct}% of your PhDs",
    stakeAllAria: "Stake all your PhDs",
    stakeMax: "Max",
    multiplier: "Multiplier",
    multiplierSlider: "Custom multiplier",
    win: "Win",
    lose: "Lose",
    chanceCentre: "to win",
    frenzyOnLoss: "{name} for {seconds}s",
    noFrenzyOnLoss: "Stake too small for a {name}",
    spin: "Spin",
    spinAgain: "Spin again",
    spinning: "Spinning…",
    resultWin: "You won {gain} PhD.",
    resultWinTotal: "You now have {total}.",
    resultLose: "You lost {stake} PhD.",
    resultFrenzy: "{name} is active for {seconds}s.",
    problems: {
      noPhd: "You need at least 1 PhD to spin.",
      enterStake: "Enter how many PhDs to stake.",
      tooMany: "You can stake at most {owned} PhD.",
      tooSmall:
        "At ×{mult} the stake must be at least {min} PhD, or the win pays no more than you put in.",
      restricted: "This account is temporarily restricted."
    },
    finePrint:
      "Over many spins you get back about {rtp}% of what you stake. The win chance never goes above {cap}%.",
    guestNote: "You're a guest — PhDs won or lost here are not saved.",
    guestSpinsDropped: "PhDs won or lost on the wheel as a guest don't carry over to your account.",
    errors: {
      unconfirmed: "We couldn't confirm that spin, so your progress was reloaded from the server.",
      syncFailed: "Couldn't save your progress before spinning, so the spin didn't happen.",
      insufficient: "You don't have that many PhDs to stake.",
      limit: "That spin could push your PhD total past its limit.",
      invalid: "That stake or multiplier isn't valid.",
      generic: "The spin failed. Try again."
    }
  },
  prestige: {
    title: "Prestige",
    lockedProgress: "Progress to next PhD",
    tokensToNext: "{amount} to go",
    progressToNextGain: "Progress to +{next} PhD",
    phdOwned: "PhDs owned",
    production: "Production",
    costDiscount: "Unit cost",
    button: "Defend Thesis",
    loginToPrestige: "Log in to defend",
    guestNote: "Prestige needs an account. Register or log in — this run comes with you.",
    ceremonyGained: "PhD earned",
    ceremonySubtext: "Your research permanently strengthens every future run.",
    continueBtn: "Begin Anew"
  },
  leaderboard: {
    open: "Leaderboards",
    title: "Leaderboards",
    metricTokens: "Tokens",
    metricClicks: "Clicks",
    metricPhd: "PhDs",
    metricPlaytime: "Playtime",
    rank: "Rank",
    player: "Player",
    value: "Value",
    yourRank: "Your rank",
    hiddenNote: "You're hidden from other players' leaderboards.",
    empty: "No players on this leaderboard yet.",
    loadError: "Couldn't load the leaderboard."
  },
  anticheat: {
    title: "Progress paused",
    body: "Automated or unusually fast input was detected on this account. Clicking, purchases, and prestige are paused until the timer below runs out.",
    timeRemaining: "Time remaining",
    strikeNote:
      "This has happened {count} times on this account. Restrictions get longer each time.",
    dismissBtn: "Got it"
  }
};
