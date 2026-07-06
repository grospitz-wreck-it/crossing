"use client";

import {
  useEffect,
  useState,
} from "react";

export default function CreativesPage() {
  const [campaigns, setCampaigns] =
    useState<any[]>([]);

  const [creatives, setCreatives] =
    useState<any[]>([]);

  const [campaignId, setCampaignId] =
    useState("");

  const [title, setTitle] =
    useState("");

  const [imageUrl, setImageUrl] =
  useState("");

const [file, setFile] =
  useState<File | null>(
    null
  );

const [uploading, setUploading] =
  useState(false);

  const [targetUrl, setTargetUrl] =
    useState("");

  async function load() {
    const campaignsRes =
      await fetch(
        "/api/admin/campaigns"
      );

    const creativesRes =
      await fetch(
        "/api/admin/creatives"
      );

    setCampaigns(
      await campaignsRes.json()
    );

    setCreatives(
      await creativesRes.json()
    );
  }

  useEffect(() => {
    load();
  }, []);

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

  async function create() {
  const uploadedUrl =
    await uploadFile();

  await fetch(
    "/api/admin/creatives",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        campaignId,

        title,

        imageUrl:
          uploadedUrl ??
          imageUrl,

        targetUrl,
      }),
    }
  );

  setTitle("");

  setImageUrl("");

  setTargetUrl("");

  setFile(null);

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
        Creatives
      </h1>

      <div
        style={{
          display: "grid",
          gap: 12,
          maxWidth: 600,
          marginTop: 24,
        }}
      >
        <select
          value={campaignId}
          onChange={(e) =>
            setCampaignId(
              e.target.value
            )
          }
        >
          <option value="">
            Kampagne wählen
          </option>

          {campaigns.map(
            (campaign) => (
              <option
                key={
                  campaign.id
                }
                value={
                  campaign.id
                }
              >
                {
                  campaign.name
                }
              </option>
            )
          )}
        </select>

        <input
          value={title}
          onChange={(e) =>
            setTitle(
              e.target.value
            )
          }
          placeholder="Titel"
        />

        <input
  type="file"
  accept="image/*"
  onChange={(e) =>
    setFile(
      e.target.files?.[0] ??
        null
    )
  }
/>

        <input
          value={targetUrl}
          onChange={(e) =>
            setTargetUrl(
              e.target.value
            )
          }
          placeholder="Ziel URL"
        />
{uploading && (
  <div>
    Upload läuft...
  </div>
)}
        <button
          onClick={create}
        >
          Creative anlegen
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
            <th>
              Kampagne
            </th>

            <th>
              Titel
            </th>

            <th>
              Ziel
            </th>
          </tr>
        </thead>

        <tbody>
          {creatives.map(
            (creative) => (
              <tr
                key={
                  creative.id
                }
              >
                <td>
                  {
                    creative.campaign_name
                  }
                </td>

                <td>
                  {
                    creative.title
                  }
                </td>

                <td>
                  {
                    creative.target_url
                  }
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </main>
  );
}