"use client";

import CampaignCard from "./CampaignCard";

type Props = {
  campaigns: any[];

  onEdit?: (
    campaign: any
  ) => void;

  onDelete?: (
    campaign: any
  ) => void;
};

export default function CampaignGrid({
  campaigns,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fill,minmax(390px,1fr))",
        gap: 22,
      }}
    >
      {campaigns.map(
        (
          campaign
        ) => (
          <CampaignCard
            key={
              campaign.id
            }
            campaign={
              campaign
            }
            onEdit={
              onEdit
            }
            onDelete={
              onDelete
            }
          />
        )
      )}
    </div>
  );
}