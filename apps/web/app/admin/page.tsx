"use client";

import {
  useEffect,
  useState,
} from "react";

function formatTime(
  value?: string
) {
  if (!value) {
    return "-";
  }

  return new Date(
    value
  ).toLocaleString(
    "de-DE",
    {
      dateStyle: "short",
      timeStyle: "medium",
    }
  );
}

export default function Admin() {
  const [rows, setRows] =
    useState<any[]>([]);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    fetch(
      "/api/measurements/stats"
    )
      .then((res) =>
        res.json()
      )
      .then((data) => {
        setRows(data);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <main
      style={{
        maxWidth: 1400,
        margin:
          "0 auto",
        padding: 40,
      }}
    >
      <h1
        style={{
          marginBottom: 24,
        }}
      >
        Messungen
      </h1>

      {loading && (
        <div>
          Lade Daten...
        </div>
      )}

      {!loading && (
        <div
          style={{
            overflowX:
              "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse:
                "collapse",
            }}
          >
            <thead>
              <tr>
                <th>
                  Prediction
                </th>

                <th>
                  Prognose
                  Schließen
                </th>

                <th>
                  Ist
                  Schließen
                </th>

                <th>
                  Prognose
                  Öffnen
                </th>

                <th>
                  Ist
                  Öffnen
                </th>

                <th>
                  Close Δ
                </th>

                <th>
                  Open Δ
                </th>

                <th>
                  Dauer
                </th>

                <th>
                  Züge
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map(
                (
                  row: any
                ) => (
                  <tr
                    key={
                      row.predictionId
                    }
                  >
                    <td>
                      {row.predictionId.slice(
                        0,
                        10
                      )}
                    </td>

                    <td>
                      {formatTime(
                        row.predictedClose
                      )}
                    </td>

                    <td>
                      {formatTime(
                        row.actualClose
                      )}
                    </td>

                    <td>
                      {formatTime(
                        row.predictedOpen
                      )}
                    </td>

                    <td>
                      {formatTime(
                        row.actualOpen
                      )}
                    </td>

                    <td>
                      {row.closeDeltaSeconds ??
                        "-"}
                      {row.closeDeltaSeconds !==
                        null &&
                        " s"}
                    </td>

                    <td>
                      {row.openDeltaSeconds ??
                        "-"}
                      {row.openDeltaSeconds !==
                        null &&
                        " s"}
                    </td>

                    <td>
                      {row.measuredDurationSeconds ??
                        "-"}
                      {row.measuredDurationSeconds !==
                        null &&
                        " s"}
                    </td>

                    <td>
                      {row.trains
                        ?.map(
                          (
                            t: any
                          ) =>
                            `${t.line} ${t.trainNumber}`
                        )
                        .join(
                          ", "
                        )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}