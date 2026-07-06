"use client";
import CampaignDrawer from "./components/CampaignDrawer";
import CampaignGrid from "./components/CampaignGrid";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

export default function AdsPage() {
  const [campaigns, setCampaigns] =
    useState<any[]>([]);

  const [loading, setLoading] =
    useState(true);
const [showDrawer, setShowDrawer] =
  useState(false);

const [editingCampaign, setEditingCampaign] =
  useState<any | null>(null);

  const [file, setFile] =
  useState<File | null>(
    null
  );

const [targetUrl, setTargetUrl] =
  useState("");

const [uploading, setUploading] =
  useState(false);

const [customers, setCustomers] =
  useState<any[]>([]);

const [customerId, setCustomerId] =
  useState("");

const [name, setName] =
  useState("");

const [cpm, setCpm] =
  useState("39");

const [budget, setBudget] =
  useState("");

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

const [crossings, setCrossings] =
  useState<string[]>([
    "kirchlengern",
  ]);

const [showCustomerDialog, setShowCustomerDialog] =
  useState(false);

const [newCustomerName, setNewCustomerName] =
  useState("");

  async function load() {
  const campaignsRes =
    await fetch(
      "/api/admin/campaigns"
    );

  const customersRes =
    await fetch(
      "/api/admin/customers"
    );

  setCampaigns(
    await campaignsRes.json()
  );

  setCustomers(
    await customersRes.json()
  );
}

async function uploadFile() {
  if (!file) {
    return null;
  }

  setUploading(true);

  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );

  const res =
    await fetch(
      "/api/admin/upload",
      {
        method: "POST",
        body: formData,
      }
    );

  const data =
    await res.json();

  setUploading(false);

  return data.url;
}
function resetForm() {
  setEditingCampaign(null);

  setCustomerId("");

  setName("");

  setCpm("39");

  setBudget("");

  setTargetUrl("");

  setFile(null);

  setStartDate(
    new Date()
      .toISOString()
      .slice(0, 10)
  );

  setEndDate(
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
}
async function createCampaign() {
  const isEditing =
    editingCampaign !== null;

  if (isEditing) {
  const res =
    await fetch(
      `/api/admin/campaigns/${editingCampaign.id}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          customerId,

          name,

          billingModel:
            "CPM",

          cpm:
            Number(cpm),

          budget:
            Number(
              budget
            ),

          priority: 1,

          startDate,

          endDate,
        }),
      }
    );

  if (!res.ok) {
    console.error(
      await res.text()
    );

    return;
  }

  resetForm();

  setShowDrawer(false);

  await load();

  return;
}

  console.log("CREATE");

  const imageUrl =
    await uploadFile();

  const campaignRes =

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

          billingModel:
            "CPM",

          cpm:
            Number(cpm),

          budget:
            Number(
              budget
            ),

          priority: 1,

          startDate,

          endDate,

          crossings,
        }),
      }
    );
if (!campaignRes.ok) {
  console.error(
    await campaignRes.text()
  );

  return;
}
  const campaignData =
    await campaignRes.json();
console.log(
  campaignData
);
  if (imageUrl) {
    await fetch(
      "/api/admin/creatives",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          campaignId:
            campaignData.id,

          title: name,

          imageUrl,

          targetUrl,
        }),
      }
    );
  }


  
  resetForm();

setShowDrawer(false);
await load();
}

async function deleteCampaign(id: string) {
  const ok = window.confirm(
    "Kampagne wirklich löschen?"
  );

  if (!ok) {
    return;
  }

  const res = await fetch(
    `/api/admin/campaigns/${id}`,
    {
      method: "DELETE",
    }
  );

  if (!res.ok) {
    alert(
      "Kampagne konnte nicht gelöscht werden."
    );
    return;
  }

  if (
    editingCampaign?.id === id
  ) {
    resetForm();
    setShowDrawer(false);
  }

  await load();
}

async function createCustomer() {
  if (!newCustomerName.trim()) {
    return;
  }

  const res =
    await fetch(
      "/api/admin/customers",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          name: newCustomerName,
        }),
      }
    );

  if (!res.ok) {
    alert(
      "Kunde konnte nicht erstellt werden."
    );
    return;
  }

  const data =
    await res.json();

  const customersRes =
    await fetch(
      "/api/admin/customers"
    );

  const list =
    await customersRes.json();

  setCustomers(list);

  setCustomerId(data.id);

  setNewCustomerName("");

  setShowCustomerDialog(false);
}
  useEffect(() => {
  load().finally(() =>
    setLoading(false)
  );
}, []);

  const stats =
    useMemo(() => {
      return {
        campaigns:
          campaigns.length,

        active:
          campaigns.filter(
            (c) => c.active
          ).length,

        budget:
          campaigns.reduce(
            (
              sum,
              campaign
            ) =>
              sum +
              Number(
                campaign.budget ??
                  0
              ),
            0
          ),
      };
    }, [campaigns]);

  return (
    <main
      style={{
        maxWidth: 1400,
        margin: "0 auto",
        padding: 32,
      }}
    >
      <h1
        style={{
          marginBottom: 24,
        }}
      >
        Ads
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(220px,1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          title="Kampagnen"
          value={
            stats.campaigns
          }
        />

        <StatCard
          title="Aktiv"
          value={
            stats.active
          }
        />

        <StatCard
          title="Budget"
          value={`€ ${stats.budget}`}
        />

        <StatCard
          title="Crossings"
          value="1"
        />
      </div>

      <div
        style={{
          marginBottom: 28,
        }}
      >
        <button
  onClick={() => {
  resetForm();

  setShowDrawer(true);
}}
  style={{
    border: 0,
    borderRadius: 18,
    padding:
      "14px 20px",
    fontWeight: 600,
    cursor: "pointer",
    background:
      "#4f637b",
    color: "#fff",
  }}
>
  + Neue Kampagne
</button>
      </div>

      {loading && (
        <div>
          Lade...
        </div>
      )}

      <CampaignGrid
  campaigns={campaigns}

  onEdit={(campaign) => {
    setEditingCampaign(
      campaign
    );

    setCustomerId(
      campaign.customer_id ?? ""
    );

    setName(
      campaign.name ?? ""
    );

    setCpm(
      String(
        campaign.cpm ?? ""
      )
    );

    setBudget(
      String(
        campaign.budget ?? ""
      )
    );

    setStartDate(
      campaign.start_date ?? ""
    );

    setEndDate(
      campaign.end_date ?? ""
    );

    setTargetUrl(
      campaign.creative
        ?.target_url ?? ""
    );

    setShowDrawer(true);
  }}

  onDelete={(campaign) =>
    deleteCampaign(
      campaign.id
    )
  }
/>
      <CampaignDrawer
  editing={
    editingCampaign !==
    null
  }

  open={showDrawer}

  customers={customers}

  showCustomerDialog={
    showCustomerDialog
  }

  newCustomerName={
    newCustomerName
  }

  setNewCustomerName={
    setNewCustomerName
  }

  onNewCustomer={
    createCustomer
  }

  onOpenCustomerDialog={() =>
    setShowCustomerDialog(
      true
    )
  }

  onCloseCustomerDialog={() => {
    setShowCustomerDialog(
      false
    );

    setNewCustomerName("");
  }}

  customerId={customerId}
  setCustomerId={setCustomerId}

  name={name}
  setName={setName}

  cpm={cpm}
  setCpm={setCpm}

  budget={budget}
  setBudget={setBudget}

  startDate={startDate}
  setStartDate={setStartDate}

  endDate={endDate}
  setEndDate={setEndDate}

  targetUrl={targetUrl}
  setTargetUrl={setTargetUrl}

  setFile={setFile}

  fieldStyle={fieldStyle}

  onClose={() => {
    resetForm();

    setShowDrawer(false);
  }}

  onSave={createCampaign}
/>



    </main>
  );

  
}




function StatCard({
  title,
  value,
}: {
  title: string;
  value:
    | string
    | number;
}) {
  return (
    <div
      style={{
        background:
          "#fff",
        borderRadius: 24,
        padding: 24,
        boxShadow:
          "0 4px 24px rgba(0,0,0,.05)",
      }}
    >
      <div
        style={{
          opacity: 0.5,
          fontSize: 14,
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
    </div>
  );
}


function Chip({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <div
      style={{
        padding:
          "6px 10px",
        borderRadius:
          999,
        background:
          "#f3f5f8",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
const fieldStyle = {
  width: "100%",
  height: 52,
  borderRadius: 16,
  border: "1px solid #e7ebf0",
  padding: "0 16px",
  fontSize: 15,
  marginTop: 8,
  outline: "none",
} as const;
