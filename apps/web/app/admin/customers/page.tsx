"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

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
    <main className={styles.page}>
      <h1>Kunden</h1>

      <div className={styles.create}>
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

      <table className={styles.table}>
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