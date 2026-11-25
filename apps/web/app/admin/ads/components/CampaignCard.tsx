"use client";

import Card from "./ui/Card";
import Chip from "./ui/Chip";
import Button from "./ui/Button";

type Props = {
  campaign: any;
  onEdit?: (campaign: any) => void;
  onDelete?: (campaign: any) => void;
  onToggle?: (campaign: any) => void;
};

export default function CampaignCard({
  campaign,
  onEdit,
  onDelete,
  onToggle,
}: Props) {
  return (
    <Card>
      <div
        style={{
          aspectRatio: "16/8",
          overflow: "hidden",
          background: "#17263a",
        }}
      >
        {campaign.creative
          ?.image_url ? (
          <img
            src={
              campaign.creative
                .image_url
            }
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent:
                "center",
              color: "#91a1b7",
            }}
          >
            Kein Banner
          </div>
        )}
      </div>

      <div
        style={{
          padding: 15,
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: "#7a8796",
          }}
        >
          {campaign.customer_name}
        </div>

        <div
          style={{
            marginTop: 4,
            fontSize: 17,
            fontWeight: 700,
          }}
        >
          {campaign.name}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 14,
          }}
        >
          <Chip>
            {campaign.active
              ? "Aktiv"
              : "Pausiert"}
          </Chip>

          <Chip>
            {
              campaign.billing_model
            }
          </Chip>

          {campaign.cpm && (
            <Chip>
              €
              {campaign.cpm}
            </Chip>
          )}

          {campaign.budget && (
            <Chip>
              Budget €
              {
                campaign.budget
              }
            </Chip>
          )}
        </div>

        <div
          style={{
            marginTop: 18,
            color: "#7a8796",
            fontSize: 10,
          }}
        >
          {campaign.start_date}
          {" – "}
          {campaign.end_date}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 18,
          }}
        >
          {campaign.crossings?.map(
            (
              crossing: string
            ) => (
              <Chip
                key={
                  crossing
                }
              >
                📍 {crossing}
              </Chip>
            )
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 14,
          }}
        >
          <Button
            variant="secondary"
            style={{
              flex: 1,
            }}
            onClick={() =>
              onEdit?.(
                campaign
              )
            }
          >
            ✏ Bearbeiten
          </Button>

          <Button
            variant="secondary"
            style={{
              flex: 1,
            }}
          onClick={() => onToggle?.(campaign)}
          >
            {campaign.active
              ? "⏸ Pause"
              : "▶ Aktivieren"}
          </Button>

          <Button
            variant="secondary"
            onClick={() =>
              onDelete?.(
                campaign
              )
            }
          >
            🗑
          </Button>
        </div>
      </div>
    </Card>
  );
}