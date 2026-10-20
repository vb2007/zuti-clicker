export class Responses {
  static readonly AUTH = {
    MISSING_REGISTER_FIELDS: {
      status: 400,
      body: { error: "The username, email, and password fields are required." }
    },
    MISSING_LOGIN_FIELDS: { status: 400, body: { error: "Email and password are required." } },
    EMAIL_EXISTS: { status: 409, body: { error: "A user with that email already exists." } },
    USERNAME_EXISTS: { status: 409, body: { error: "A user with that username already exists." } },
    INVALID_CREDENTIALS: { status: 401, body: { error: "Invalid credentials." } },
    UNAUTHORIZED: { status: 401, body: { error: "Unauthorized." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } },
    REGISTER_SUCCESS: { status: 201, body: { message: "User registered successfully." } },
    LOGIN_SUCCESS: { status: 200, body: { message: "Login successful." } }
  } as const;

  static readonly SAVE = {
    MISSING_FIELDS: {
      status: 400,
      body: {
        error: "tokens, totalTokensEarned, totalClicks, elapsedSeconds, and units are required."
      }
    },
    INVALID_UNITS: {
      status: 400,
      body: {
        error:
          "Each unit must have a known unitId and an integer owned count between 0 and 10000, with no duplicate unitId."
      }
    },
    // Present but out-of-range core fields (negative, non-finite, or a
    // fractional totalClicks) — distinct from MISSING_FIELDS, which covers a
    // field that is absent or the wrong type entirely.
    INVALID_CORE_FIELDS: {
      status: 400,
      body: {
        error:
          "tokens, totalTokensEarned, and elapsedSeconds must be finite numbers >= 0, and totalClicks must be a non-negative integer no greater than 2147483647."
      }
    },
    TOKENS_EXCEED_EARNED: {
      status: 400,
      body: { error: "tokens cannot exceed totalTokensEarned." }
    },
    // The save plausibility envelope's reject tier (services/saveValidator.ts)
    // — a monotonicity break, or a value more than twice what's achievable
    // since the last save. 409, not 400: the request is well-formed, it's
    // the claimed progress that couldn't be verified. Nothing is written;
    // the client's next GET /save returns the last verified state unchanged.
    IMPLAUSIBLE: {
      status: 409,
      body: {
        error:
          "This save could not be verified as achievable since your last sync and was rejected. Reload to continue from your last verified save."
      }
    },
    INVALID_PRESTIGE: {
      status: 400,
      body: {
        error:
          "phdCount, prestigeCount, runTokensEarned, runClicks, and runSeconds must be non-negative numbers when provided (whole numbers for the counts)."
      }
    },
    INVALID_UPGRADES: {
      status: 400,
      body: { error: "upgrades must be an array of known upgrade ids." }
    },
    INVALID_UPGRADER_SEQ: {
      status: 400,
      body: { error: "upgraderSeq must be a non-negative integer when provided." }
    },
    // 409, not a strike: the save is well-formed and honest, it was simply
    // made before a later wheel spin (another tab, or a save already in
    // flight) and so doesn't know the current PhD balance. Nothing is written.
    // `code` is what the client keys on (frontend/src/lib/api.ts's
    // SAVE_STALE_CODE — keep in sync), since this and IMPLAUSIBLE share a status
    // and only one of them is a rejection the player should be told about.
    STALE: {
      status: 409,
      body: {
        code: "save_stale",
        error:
          "Your progress changed since this save was made (a wheel spin or an Academic Career change elsewhere). Reload to continue from your current progress."
      }
    },
    // held + invested PhDs would pass 2^53 - 1, the largest whole number
    // GameSave.phdTotal (a DOUBLE) holds exactly. Only a forged phdCount gets
    // here — an honest one is bounded far below.
    PHD_LIMIT: {
      status: 400,
      body: {
        error: "phdCount plus the PhDs invested in the Academic Career exceeds 9007199254740991."
      }
    },
    NOT_FOUND: { status: 404, body: { save: null } },
    SAVE_SUCCESS: { status: 200, body: { message: "Save updated successfully." } },
    RESET_SUCCESS: { status: 200, body: { message: "Save reset successfully." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;

  static readonly BOOSTER = {
    NO_SAVE: { status: 404, body: { error: "No save exists yet — sync your progress first." } },
    ON_COOLDOWN: { status: 409, body: { error: "No booster is available to claim yet." } },
    CLAIM_SUCCESS: { status: 200, body: { message: "Booster claimed." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;

  static readonly UPGRADER = {
    INVALID_STAKE: {
      status: 400,
      body: { error: "stake must be a whole number of PhDs between 1 and 2147483647." }
    },
    INVALID_MULTIPLIER: {
      status: 400,
      body: { error: "multiplier must be a number from 1.2 to 100 with at most 2 decimals." }
    },
    // quoteSpin's payout <= stake case: e.g. 1 PhD x1.5 floors back to 1, so a
    // "win" would gain nothing.
    NO_GAIN: {
      status: 400,
      body: { error: "stake x multiplier must pay out more PhDs than the stake." }
    },
    NO_SAVE: { status: 404, body: { error: "No save exists yet — sync your progress first." } },
    // phdCount is appended dynamically by the caller: the balance the spin was
    // actually checked against, so the client can correct a stale display.
    INSUFFICIENT_PHD: { status: 409, body: { error: "You do not have that many PhDs to stake." } },
    LIMIT_REACHED: {
      status: 409,
      body: { error: "This spin would overflow the stored PhD totals." }
    },
    SPIN_SUCCESS: { status: 200, body: { message: "Spin settled." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;

  // POST /career/* (the Academic Career tree). Every 409 carries a `code` the
  // client keys on (keep in sync with frontend/src/lib/api.ts's CAREER_CODES);
  // the caller appends the account's real career state (and phdCount where it
  // helps), so a client that was out of date can resync without a reload.
  static readonly CAREER = {
    INVALID_NODE: {
      status: 400,
      body: { error: "nodeId must be a known Academic Career node id." }
    },
    INVALID_WINDOW_ID: {
      status: 400,
      body: { error: "windowId must be a non-negative integer when provided." }
    },
    NO_SAVE: { status: 404, body: { error: "No save exists yet — sync your progress first." } },
    WINDOW_CLOSED: {
      status: 409,
      body: {
        code: "career_window_closed",
        error: "The Academic Career can only be changed right after a prestige."
      }
    },
    // A delayed "Done" for an earlier window must not close a newer one that
    // another tab's prestige opened meanwhile.
    WINDOW_CHANGED: {
      status: 409,
      body: {
        code: "career_window_changed",
        error: "A newer Academic Career window has opened since this one."
      }
    },
    ALREADY_OWNED: {
      status: 409,
      body: { code: "career_already_owned", error: "That node is already yours." }
    },
    PREREQUISITE_MISSING: {
      status: 409,
      body: {
        code: "career_prerequisite_missing",
        error: "Buy the node this one branches from first."
      }
    },
    INSUFFICIENT_PHD: {
      status: 409,
      body: { code: "career_insufficient_phd", error: "You do not have enough PhDs for that node." }
    },
    NOT_OWNED: {
      status: 409,
      body: { code: "career_not_owned", error: "That node is not yours to refund." }
    },
    // Bought in an earlier window: permanent.
    NOT_REFUNDABLE: {
      status: 409,
      body: {
        code: "career_not_refundable",
        error: "Only nodes bought since your latest prestige can be refunded."
      }
    },
    BUY_SUCCESS: { status: 200, body: { message: "Node bought." } },
    REFUND_SUCCESS: { status: 200, body: { message: "Nodes refunded." } },
    CLOSE_SUCCESS: { status: 200, body: { message: "Academic Career window closed." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;

  static readonly SETTINGS = {
    // Keep the allowed-value lists here in sync with constants/settings.ts.
    INVALID_THEME: { status: 400, body: { error: "theme must be one of: dark, light." } },
    INVALID_LANGUAGE: { status: 400, body: { error: "language must be one of: en, hu." } },
    INVALID_CEREMONY: {
      status: 400,
      body: { error: "prestigeCeremony must be one of: full, brief." }
    },
    INVALID_AUTOSAVE_ENABLED: {
      status: 400,
      body: { error: "autosaveEnabled must be a boolean." }
    },
    INVALID_AUTOSAVE_INTERVAL: {
      status: 400,
      body: { error: "autosaveIntervalSecs must be one of: 15, 30, 60, 300." }
    },
    INVALID_HIDE_FROM_LEADERBOARDS: {
      status: 400,
      body: { error: "hideFromLeaderboards must be a boolean." }
    },
    UPDATE_SUCCESS: { status: 200, body: { message: "Settings updated successfully." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;

  static readonly LEADERBOARD = {
    // Keep the metric list here in sync with constants/leaderboard.ts.
    INVALID_METRIC: {
      status: 400,
      body: { error: "metric must be one of: tokens, clicks, phd, playtime." }
    },
    INVALID_LIMIT: { status: 400, body: { error: "limit must be an integer between 1 and 100." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;

  static readonly ANTICHEAT = {
    // 403, not 401: the session is valid, the account is simply barred from
    // this action for now. restrictedUntil/strikeCount are appended
    // dynamically by the caller (see middlewares/index.ts's
    // requireNotRestricted), never hardcoded here.
    RESTRICTED: {
      status: 403,
      body: {
        error:
          "This account is temporarily restricted due to suspected automation. Progress, purchases, and prestige are paused until the restriction expires."
      }
    },
    INVALID_DIGEST: {
      status: 400,
      body: { error: "Malformed anti-cheat report." }
    },
    REPORT_SUCCESS: { status: 200, body: { message: "Report received." } },
    INTERNAL_ERROR: { status: 500, body: { error: "Internal server error." } }
  } as const;
}
