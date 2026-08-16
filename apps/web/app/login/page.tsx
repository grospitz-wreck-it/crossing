"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  async function handleGoogleLogin() {
    await signIn("google", {
      callbackUrl: "/app",
    });
  }

  return (
    <main className="loginPage">
      <div className="loginCard">
        <div className="loginLogo">
          MeineSchranke
        </div>

        <h1>
          Deine Schranken.
          <br />
          Dein Überblick.
        </h1>

        <p>
          Melde dich an, um deine persönlichen
          Bahnübergänge zu speichern und
          MeineSchranke zu nutzen.
        </p>

        <button
          type="button"
          className="loginButton"
          onClick={handleGoogleLogin}
        >
          Mit Google anmelden
        </button>

        <div className="loginHint">
          Weitere Anmeldeoptionen folgen.
        </div>

        <a
          href="/"
          className="loginBack"
        >
          ← Zur Startseite
        </a>
      </div>
    </main>
  );
}