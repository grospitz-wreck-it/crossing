import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";

import { authDb } from "./app/lib/auth-db";

import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "./lib/auth-schema";

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  adapter: DrizzleAdapter(authDb, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  session: {
    strategy: "database",
  },

  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.plan = user.plan;
        session.user.role = user.role;
        session.user.status = user.status;
      }

      return session;
    },
  },
});