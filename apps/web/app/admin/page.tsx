"use client";

import {
  useEffect,
  useMemo,
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
      timeStyle: "short",
    }
  );
}

function avg(
  values: number[]
) {
  if (!values.length) {
    return null;
  }

  return Math.round(
    values.reduce(
      (a, b) => a + b,
      0
    ) / values.length
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
      .then(setRows)
      .finally(() =>
        setLoading(false)
      );
  }, []);

  const stats =
    useMemo(() => {
      const closeValues =
        rows
          .map(
            (r) =>
              r.closeDeltaSeconds
          )
          .filter(
            (
              v
            ): v is number =>
              v !== null
          );

      const openValues =
        rows
          .map(
            (r) =>
              r.openDeltaSeconds
          )
          .filter(
            (
              v
            ): v is number =>
              v !== null
          );

      const durations =
        rows
          .map(
            (r) =>
              r.measuredDurationSeconds
          )
          .filter(
            (
              v
            ): v is number =>
              v !== null
          );

      const trainStats =
        new Map();

      rows.forEach(
        (row) => {
          row.trains?.forEach(
            (
              train: any
            ) => {
              const key =
                train.line ??
                "Unknown";

              if (
                !trainStats.has(
                  key
                )
              ) {
                trainStats.set(
                  key,
                  []
                );
              }

              if (
                row.closeDeltaSeconds !==
                null
              ) {
                trainStats
                  .get(
                    key
                  )
                  .push(
                    row.closeDeltaSeconds
                  );
              }
            }
          );
        }
      );

      return {
        avgClose:
          avg(
            closeValues
          ),

        avgOpen:
          avg(
            openValues
          ),

        avgDuration:
          avg(
            durations
          ),

        trainStats:
          Array.from(
            trainStats.entries()
          )
            .map(
              (
                [
                  line,
                  values,
                ]
              ) => ({
                line,

                count:
                  values.length,

                avgError:
                  avg(
                    values
                  ),
              })
            )
            .sort(
              (
                a,
                b
              ) =>
                b.count -
                a.count
            ),
      };
    }, [rows]);

  return (
    <main
      style={{
        maxWidth: 1600,
        margin:
          "0 auto",
        padding: 40,
      }}
    >
      <h1>
        Kirchlengern
        Analytics
      </h1>

      {loading && (
        <div>
          Lade Daten...
        </div>
      )}

      {!loading && (
        <>
          <div
            style={{
              display:
                "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(220px,1fr))",
              gap: 16,
              marginTop: 24,
              marginBottom:
                32,
            }}
          >
            <Card
              title="Messungen"
              value={
                rows.length
              }
            />

            <Card
              title="Ø Close Fehler"
              value={`${stats.avgClose ?? "-"} s`}
            />

            <Card
              title="Ø Open Fehler"
              value={`${stats.avgOpen ?? "-"} s`}
            />

            <Card
              title="Ø Dauer"
              value={`${stats.avgDuration ?? "-"} s`}
            />
          </div>

          <h2>
            Linienanalyse
          </h2>

          <table
            style={{
              width: "100%",
              marginBottom:
                40,
            }}
          >
            <thead>
              <tr>
                <th>
                  Linie
                </th>
                <th>
                  Messungen
                </th>
                <th>
                  Ø Fehler
                </th>
              </tr>
            </thead>

            <tbody>
              {stats.trainStats.map(
                (
                  row
                ) => (
                  <tr
                    key={
                      row.line
                    }
                  >
                    <td>
                      {
                        row.line
                      }
                    </td>

                    <td>
                      {
                        row.count
                      }
                    </td>

                    <td>
                      {
                        row.avgError
                      }
                      s
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          <h2>
            Einzelmessungen
          </h2>

          <div
            style={{
              overflowX:
                "auto",
            }}
          >
            <table
              style={{
                width:
                  "100%",
              }}
            >
              <thead>
                <tr>
                  <th>
                    Prognose
                  </th>

                  <th>
                    Ist
                  </th>

                  <th>
                    Δ Close
                  </th>

                  <th>
                    Δ Open
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
                    row
                  ) => (
                    <tr
                      key={
                        row.predictionId
                      }
                    >
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
                        {row.closeDeltaSeconds}
                        s
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
                              `${t.line ?? ""} ${t.trainNumber}`
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
        </>
      )}
    </main>
  );
}

function Card({
  title,
  value,
}: {
  title: string;
  value:
    | string
    | number
    | null;
}) {
  return (
    <div
      style={{
        padding: 24,
        borderRadius: 20,
        background:
          "#f6f7f9",
      }}
    >
      <div
        style={{
          fontSize:
            14,
          opacity: 0.6,
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize:
            32,
          fontWeight: 700,
          marginTop: 8,
        }}
      >
        {value}
      </div>
    </div>
  );
}