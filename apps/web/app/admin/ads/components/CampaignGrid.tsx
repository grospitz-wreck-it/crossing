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
  onToggle?: (campaign: any) => void;
};

export default function CampaignGrid({
  campaigns,
  onEdit,
  onDelete,
  onToggle,
}: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fill,minmax(280px,1fr))",
        gap: 12,
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
            onToggle={onToggle}
          />
        )
      )}
    </div>
  );
}