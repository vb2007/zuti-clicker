import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "url";
import path from "path";
import { THEMES, LANGUAGES, PRESTIGE_CEREMONIES, AUTOSAVE_INTERVALS } from "../constants/settings";
import { LEADERBOARD_METRICS } from "../constants/leaderboard";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Called after dotenv.config() so that IP/PORT env vars are resolved at
 * invocation time rather than at module evaluation time.
 */
export const buildSwaggerSpec = (): object => {
  const options: swaggerJsdoc.Options = {
    definition: {
      openapi: "3.1.0",
      info: {
        title: "Zuti Clicker API",
        version: "1.0.0",
        description: "REST API for the Zuti Clicker game."
      },
      servers: [
        {
          url: `http://${process.env.IP ?? "localhost"}:${process.env.PORT ?? "3000"}`
        }
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "AUTH_TOKEN",
            description:
              "Session token issued on a successful `/login` call. " +
              "Set automatically via `Set-Cookie`; pass it manually when using the Try-it-out panel."
          }
        },
        schemas: {
          RegisterRequest: {
            type: "object",
            required: ["username", "email", "password"],
            properties: {
              username: { type: "string", example: "johndoe" },
              email: { type: "string", format: "email", example: "john@example.com" },
              password: { type: "string", format: "password", example: "s3cur3P@ssw0rd" }
            }
          },
          LoginRequest: {
            type: "object",
            required: ["email", "password"],
            properties: {
              email: { type: "string", format: "email", example: "john@example.com" },
              password: { type: "string", format: "password", example: "s3cur3P@ssw0rd" }
            }
          },
          ErrorResponse: {
            type: "object",
            properties: {
              error: { type: "string" }
            }
          },
          MessageResponse: {
            type: "object",
            properties: {
              message: { type: "string" }
            }
          },
          UnitSave: {
            type: "object",
            required: ["unitId", "owned"],
            properties: {
              unitId: { type: "string", description: "Must be a known unit id.", example: "alpha" },
              owned: { type: "integer", minimum: 0, maximum: 10000, example: 5 }
            }
          },
          ActiveBooster: {
            type: "object",
            description: "A live buff. Read-only — never accepted by PUT /save.",
            properties: {
              boosterId: { type: "string", example: "frenzy" },
              remainingMs: {
                type: "integer",
                minimum: 0,
                description: "Time left, in milliseconds, computed server-side at request time",
                example: 45000
              }
            }
          },
          StoreSaveRequest: {
            type: "object",
            // Only the original five are required — the prestige fields are
            // optional so a client that predates prestige keeps working.
            required: [
              "tokens",
              "totalTokensEarned",
              "totalClicks",
              "elapsedSeconds",
              "units"
            ],
            properties: {
              tokens: {
                type: "number",
                minimum: 0,
                description: "Current token balance. Must not exceed totalTokensEarned.",
                example: 1234.56
              },
              totalTokensEarned: {
                type: "number",
                minimum: 0,
                description: "All-time tokens earned",
                example: 9999.99
              },
              totalClicks: {
                type: "integer",
                minimum: 0,
                description: "Total manual clicks",
                example: 420
              },
              elapsedSeconds: {
                type: "number",
                minimum: 0,
                description: "Total time played in seconds",
                example: 3600.5
              },
              phdCount: {
                type: "integer",
                minimum: 0,
                description: "PhDs earned across all prestiges (omit to keep the stored value)",
                example: 3
              },
              prestigeCount: {
                type: "integer",
                minimum: 0,
                description: "Number of times the player has prestiged (omit to keep the stored value)",
                example: 2
              },
              runTokensEarned: {
                type: "number",
                minimum: 0,
                description: "Tokens earned in the current run (reset on prestige; omit to keep the stored value)",
                example: 4000000
              },
              runClicks: {
                type: "integer",
                minimum: 0,
                description: "Manual clicks in the current run (omit to keep the stored value)",
                example: 40
              },
              runSeconds: {
                type: "number",
                minimum: 0,
                description: "Time played in the current run, in seconds (omit to keep the stored value)",
                example: 1200
              },
              units: {
                type: "array",
                items: { $ref: "#/components/schemas/UnitSave" }
              },
              upgrades: {
                type: "array",
                description:
                  "Owned upgrade ids (omit to keep the stored value; each entry must be a known id)",
                items: { type: "string" },
                example: ["chalk", "firmHandshake"]
              }
            }
          },
          SaveData: {
            type: "object",
            properties: {
              tokens: { type: "number", example: 1234.56 },
              totalTokensEarned: { type: "number", example: 9999.99 },
              totalClicks: { type: "integer", example: 420 },
              elapsedSeconds: { type: "number", example: 3600.5 },
              phdCount: { type: "integer", example: 3 },
              prestigeCount: { type: "integer", example: 2 },
              runTokensEarned: { type: "number", example: 4000000 },
              runClicks: { type: "integer", example: 40 },
              runSeconds: { type: "number", example: 1200 },
              savedAt: { type: "string", format: "date-time" },
              units: {
                type: "array",
                items: { $ref: "#/components/schemas/UnitSave" }
              },
              upgrades: {
                type: "array",
                items: { type: "string" },
                example: ["chalk", "firmHandshake"]
              },
              activeBoosters: {
                type: "array",
                items: { $ref: "#/components/schemas/ActiveBooster" }
              }
            }
          },
          UserSettings: {
            type: "object",
            properties: {
              theme: { type: "string", enum: [...THEMES], example: "dark" },
              language: { type: "string", enum: [...LANGUAGES], example: "en" },
              autosaveEnabled: { type: "boolean", example: true },
              autosaveIntervalSecs: {
                type: "integer",
                enum: [...AUTOSAVE_INTERVALS],
                example: 30
              },
              prestigeCeremony: { type: "string", enum: [...PRESTIGE_CEREMONIES], example: "full" },
              hideFromLeaderboards: {
                type: "boolean",
                description: "When true, this player is excluded from other players' leaderboard views",
                example: false
              },
              updatedAt: {
                type: ["string", "null"],
                format: "date-time",
                description: "null when the user has never saved settings (defaults are in effect)"
              }
            }
          },
          UpdateSettingsRequest: {
            type: "object",
            description: "All fields optional — a partial update leaves omitted fields unchanged",
            properties: {
              theme: { type: "string", enum: [...THEMES] },
              language: { type: "string", enum: [...LANGUAGES] },
              autosaveEnabled: { type: "boolean" },
              autosaveIntervalSecs: { type: "integer", enum: [...AUTOSAVE_INTERVALS] },
              prestigeCeremony: { type: "string", enum: [...PRESTIGE_CEREMONIES] },
              hideFromLeaderboards: { type: "boolean" }
            }
          },
          SettingsResponse: {
            type: "object",
            properties: {
              settings: { $ref: "#/components/schemas/UserSettings" }
            }
          },
          LoadSaveResponse: {
            type: "object",
            properties: {
              save: {
                oneOf: [
                  { $ref: "#/components/schemas/SaveData" },
                  { type: "null" }
                ],
                description: "null when the user has no save yet"
              }
            }
          },
          StoreSaveResponse: {
            allOf: [
              { $ref: "#/components/schemas/MessageResponse" },
              {
                type: "object",
                properties: {
                  savedAt: { type: "string", format: "date-time" }
                }
              }
            ]
          },
          LeaderboardEntry: {
            type: "object",
            properties: {
              rank: { type: "integer", minimum: 1, example: 1 },
              username: { type: "string", example: "johndoe" },
              value: { type: "number", example: 9999.99 }
            }
          },
          LeaderboardViewer: {
            type: "object",
            description: "The requesting user's own standing, even when outside the returned entries",
            properties: {
              rank: { type: "integer", minimum: 1, example: 42 },
              value: { type: "number", example: 123.45 },
              hidden: {
                type: "boolean",
                description: "True when this user has opted out via hideFromLeaderboards",
                example: false
              }
            }
          },
          LeaderboardResponse: {
            type: "object",
            properties: {
              metric: { type: "string", enum: Object.keys(LEADERBOARD_METRICS), example: "tokens" },
              entries: {
                type: "array",
                items: { $ref: "#/components/schemas/LeaderboardEntry" }
              },
              viewer: {
                oneOf: [
                  { $ref: "#/components/schemas/LeaderboardViewer" },
                  { type: "null" }
                ],
                description: "null when the requesting user has no save yet"
              }
            }
          },
          ClaimBoosterResponse: {
            allOf: [
              { $ref: "#/components/schemas/MessageResponse" },
              {
                type: "object",
                properties: {
                  boosterId: { type: "string", example: "frenzy" },
                  remainingMs: {
                    type: "integer",
                    minimum: 0,
                    description: "Duration of the newly granted buff, in milliseconds",
                    example: 60000
                  },
                  nextAvailableInMs: {
                    type: "integer",
                    minimum: 0,
                    description: "Time until the next claim could succeed, in milliseconds",
                    example: 142000
                  }
                }
              }
            ]
          },
          BoosterCooldownResponse: {
            allOf: [
              { $ref: "#/components/schemas/ErrorResponse" },
              {
                type: "object",
                properties: {
                  nextAvailableInMs: {
                    type: "integer",
                    minimum: 0,
                    description: "Time until the next claim could succeed, in milliseconds",
                    example: 37000
                  }
                }
              }
            ]
          },
          AntiCheatRestrictedResponse: {
            allOf: [
              { $ref: "#/components/schemas/ErrorResponse" },
              {
                type: "object",
                properties: {
                  restrictedUntil: { type: "string", format: "date-time" },
                  strikeCount: { type: "integer", minimum: 1, example: 2 }
                }
              }
            ]
          },
          AntiCheatReportRequest: {
            type: "object",
            description: "A compact, anonymous digest of client-side click timing — no coordinates, timestamps, or device/browser identifiers.",
            required: ["windowMs", "clicks", "purchases", "buckets", "maxRunLength", "untrustedClicks", "hiddenClicks", "droppedClicks", "integrityFlags", "weakSignals"],
            properties: {
              windowMs: { type: "integer", minimum: 1, example: 60000 },
              clicks: { type: "integer", minimum: 0, example: 341 },
              purchases: { type: "integer", minimum: 0, example: 4 },
              buckets: {
                type: "array",
                items: { type: "integer", minimum: 0 },
                description: "Fixed-length (24) log-spaced inter-click-interval histogram.",
                example: [0, 0, 0, 3, 41, 118, 96, 40, 20, 12, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
              },
              maxRunLength: {
                type: "integer",
                minimum: 0,
                description: "Longest run of consecutive intervals within ~5% of the running median."
              },
              untrustedClicks: { type: "integer", minimum: 0 },
              hiddenClicks: { type: "integer", minimum: 0 },
              droppedClicks: { type: "integer", minimum: 0 },
              integrityFlags: {
                type: "array",
                items: { type: "string" },
                description: "Zero-false-positive: script tampering or honeypot triggers. Decisive on the first report."
              },
              weakSignals: {
                type: "array",
                items: { type: "string" },
                description: "Pointer-physics consistency flags — corroborating only, never decisive alone."
              }
            }
          },
          AntiCheatReportResponse: {
            allOf: [
              { $ref: "#/components/schemas/MessageResponse" },
              {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["clean", "restricted"] },
                  restrictedUntil: {
                    oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
                  },
                  strikeCount: { type: "integer", minimum: 0 }
                }
              }
            ]
          },
          AntiCheatStatusResponse: {
            type: "object",
            properties: {
              isRestricted: { type: "boolean" },
              restrictedUntil: {
                oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
              },
              strikeCount: { type: "integer", minimum: 0 }
            }
          }
        },
        responses: {
          Unauthorized: {
            description: "Missing or invalid session token",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                example: { error: "Unauthorized." }
              }
            }
          },
          Restricted: {
            description: "The account is under an active anti-cheat restriction",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AntiCheatRestrictedResponse" }
              }
            }
          },
          InternalError: {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                example: { error: "Internal server error." }
              }
            }
          }
        }
      }
    },
    // Scans these files for @openapi JSDoc blocks at startup
    apis: [path.join(__dirname, "../controllers/*.ts")]
  };

  return swaggerJsdoc(options);
};
