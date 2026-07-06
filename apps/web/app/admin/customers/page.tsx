"use client";

import {
  useEffect,
  useState,
} from "react";

export default function CustomersPage() {
  const [rows, setRows] =
    useState<any[]>([]);

  const [name, setName] =
    useState("");

  async function load() {
    const res =
      await fetch(
        "/api/admin/customers"
      );

    setRows(
      await res.json()
    );
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    await fetch(
      "/api/admin/customers",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          name,
        }),
      }
    );

    setName("");

    load();
  }

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 40,
      }}
    >
      <h1>Kunden</h1>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 20,
        }}
      >
        <input
          value={name}
          onChange={(e) =>
            setName(
              e.target.value
            )
          }
          placeholder="Kunde"
        />

        <button
          onClick={create}
        >
          Anlegen
        </button>
      </div>

      <table
        style={{
          width: "100%",
          marginTop: 24,
        }}
      >
        <tbody>
          {rows.map(
            (row) => (
              <tr
                key={row.id}
              >
                <td>
                  {row.name}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </main>
  );
}