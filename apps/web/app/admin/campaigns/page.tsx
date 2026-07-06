"use client";

import {
  useEffect,
  useState,
} from "react";

export default function CampaignsPage() {
  const [customers, setCustomers] =
    useState<any[]>([]);
const [crossings, setCrossings] =
  useState<any[]>([]);

const [selectedCrossings, setSelectedCrossings] =
  useState<string[]>([]);
  const [campaigns, setCampaigns] =
    useState<any[]>([]);

  const [customerId, setCustomerId] =
    useState("");

  const [name, setName] =
    useState("");

  const [cpm, setCpm] =
    useState("39");

  async function load() {
    const customersRes =
  await fetch(
    "/api/admin/customers"
  );

const campaignsRes =
  await fetch(
    "/api/admin/campaigns"
  );

const crossingsRes =
  await fetch(
    "/api/admin/crossings"
  );

    setCustomers(
      await customersRes.json()
    );

    setCampaigns(
      await campaignsRes.json()
    );
    setCrossings(
  await crossingsRes.json()
);
  }

  useEffect(() => {
    load();
  }, []);
const [billingModel, setBillingModel] =
  useState("CPM");

const [fixedPrice, setFixedPrice] =
  useState("");

const [budget, setBudget] =
  useState("");

const [targetImpressions, setTargetImpressions] =
  useState("");

const [priority, setPriority] =
  useState("1");

const [startDate, setStartDate] =
  useState(
    new Date()
      .toISOString()
      .slice(0, 10)
  );

const [endDate, setEndDate] =
  useState(
    new Date(
      Date.now() +
      30 *
        24 *
        60 *
        60 *
        1000
    )
      .toISOString()
      .slice(0, 10)
  );
  async function create() {
  await fetch(
    "/api/admin/campaigns",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        customerId,

        name,

        billingModel,

        cpm:
          billingModel ===
          "CPM"
            ? Number(cpm)
            : null,

        fixedPrice:
          billingModel ===
          "FIXED"
            ? Number(
                fixedPrice
              )
            : null,

        budget:
          budget
            ? Number(
                budget
              )
            : null,

        targetImpressions:
          targetImpressions
            ? Number(
                targetImpressions
              )
            : null,

        priority:
          Number(
            priority
          ),
        crossings:
  selectedCrossings,
        startDate,

        endDate,
      }),
    }
  );

  setName("");

  load();
}

  return (
    <main
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: 40,
      }}
    >
      <h1>
        Kampagnen
      </h1>

      <div
        style={{
          display: "grid",
          gap: 12,
          marginTop: 24,
          maxWidth: 500,
        }}
      >
        <select
          value={customerId}
          onChange={(e) =>
            setCustomerId(
              e.target.value
            )
          }
        >
          <option value="">
            Kunde wählen
          </option>

          {customers.map(
            (
              customer
            ) => (
              <option
                key={
                  customer.id
                }
                value={
                  customer.id
                }
              >
                {
                  customer.name
                }
              </option>
            )
          )}
        </select>

        <input
  value={name}
  onChange={(e) =>
    setName(
      e.target.value
    )
  }
  placeholder="Kampagnenname"
/>

<select
  value={billingModel}
  onChange={(e) =>
    setBillingModel(
      e.target.value
    )
  }
>
  <option value="CPM">
    CPM
  </option>

  <option value="FIXED">
    Festpreis
  </option>
</select>

<input
  type="date"
  value={startDate}
  onChange={(e) =>
    setStartDate(
      e.target.value
    )
  }
/>

<input
  type="date"
  value={endDate}
  onChange={(e) =>
    setEndDate(
      e.target.value
    )
  }
/>

{billingModel ===
  "CPM" && (
  <input
    value={cpm}
    onChange={(e) =>
      setCpm(
        e.target.value
      )
    }
    placeholder="CPM (€ pro 1.000)"
  />
)}

{billingModel ===
  "FIXED" && (
  <input
    value={fixedPrice}
    onChange={(e) =>
      setFixedPrice(
        e.target.value
      )
    }
    placeholder="Festpreis €"
  />
)}

<input
  value={budget}
  onChange={(e) =>
    setBudget(
      e.target.value
    )
  }
  placeholder="Budget €"
/>

<input
  value={
    targetImpressions
  }
  onChange={(e) =>
    setTargetImpressions(
      e.target.value
    )
  }
  placeholder="Ziel-Impressions"
/>

<input
  value={priority}
  onChange={(e) =>
    setPriority(
      e.target.value
    )
  }
  placeholder="Priorität"
/>
<div
  style={{
    border:
      "1px solid #eee",
    borderRadius: 12,
    padding: 12,
  }}
>
  <strong>
    Crossings
  </strong>

  <div
    style={{
      marginTop: 12,
      display: "grid",
      gap: 8,
    }}
  >
    {crossings.map(
      (crossing) => (
        <label
          key={
            crossing.id
          }
        >
          <input
            type="checkbox"
            checked={selectedCrossings.includes(
              crossing.id
            )}
            onChange={(e) => {
              if (
                e.target.checked
              ) {
                setSelectedCrossings(
                  [
                    ...selectedCrossings,
                    crossing.id,
                  ]
                );
              } else {
                setSelectedCrossings(
                  selectedCrossings.filter(
                    (id) =>
                      id !==
                      crossing.id
                  )
                );
              }
            }}
          />

          {" "}
          {
            crossing.name
          }
        </label>
      )
    )}
  </div>
</div>
<button
  onClick={create}
>
  Kampagne anlegen
</button>
      </div>

      <table
        style={{
          width: "100%",
          marginTop: 32,
        }}
      >
        <thead>
  <tr>
    <th>Kunde</th>

    <th>Kampagne</th>

    <th>Modell</th>

    <th>Budget</th>

    <th>Laufzeit</th>

    <th>Crossings</th>

    <th>Status</th>
  </tr>
</thead>

        <tbody>
  {campaigns.map(
    (campaign) => (
      <tr
        key={
          campaign.id
        }
      >
        <td>
          {
            campaign.customer_name
          }
        </td>

        <td>
          {
            campaign.name
          }
        </td>

        <td>
          {campaign.billing_model}

          {campaign.billing_model ===
            "CPM" &&
            campaign.cpm && (
              <>
                {" "}
                (€{
                  campaign.cpm
                })
              </>
            )}

          {campaign.billing_model ===
            "FIXED" &&
            campaign.fixed_price && (
              <>
                {" "}
                (€{
                  campaign.fixed_price
                })
              </>
            )}
        </td>

        <td>
          {campaign.budget
            ? `€ ${campaign.budget}`
            : "-"}
        </td>

        <td>
          {campaign.start_date}
          <br />
          {campaign.end_date}
        </td>

        <td>
          {campaign.crossings?.join(
            ", "
          ) || "-"}
        </td>

        <td>
          {campaign.active
            ? "🟢 Aktiv"
            : "⚪ Inaktiv"}
        </td>
      </tr>
    )
  )}
</tbody>
      </table>
    </main>
  );
}