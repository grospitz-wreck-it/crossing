import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "../../lib/auth-schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

export const authDb = drizzle({
  client,
  schema: {
    users,
    accounts,
    sessions,
    verificationTokens,
  },
});