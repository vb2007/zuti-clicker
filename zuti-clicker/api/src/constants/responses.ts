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
          "phdCount, prestigeCount, runTokensEarned, runClicks, and runSeconds must be non-negative numbers when provided."
      }
    },
    INVALID_UPGRADES: {
      status: 400,
      body: { error: "upgrades must be an array of known upgrade ids." }
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
}
