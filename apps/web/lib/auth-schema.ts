import { sql } from "drizzle-orm";

import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),

  email: text("email").unique(),
  displayName: text("display_name"),

  plan: text("plan").notNull().default("free"),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),

  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),

  name: text("name"),

  emailVerified: integer("email_verified", {
    mode: "timestamp",
  }),

  image: text("image"),
});

export const accounts = sqliteTable(
  "auth_accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    type: text("type").notNull(),

    provider: text("provider").notNull(),

    providerAccountId: text("provider_account_id").notNull(),

    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
  ],
);

export const sessions = sqliteTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),

  userId: text("user_id")
    .notNull()
    .references(() => users.id, {
      onDelete: "cascade",
    }),

  expires: integer("expires", {
    mode: "timestamp",
  }).notNull(),
});

export const verificationTokens = sqliteTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),

    token: text("token").notNull(),

    expires: integer("expires", {
      mode: "timestamp",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
    }),
  ],
);