declare global {
  namespace Express {
    interface Request {
      identity?: {
        id: number;
        username: string;
        email: string;
        createdAt: Date;
        updatedAt: Date;
        // When the account's save was last deleted (null: never) — anchors
        // the next first save's envelope, see controllers/save.ts.
        saveResetAt: Date | null;
      };
    }
  }
}

export {};
