"use client";

import Button from "./ui/Button";
import Field from "./ui/Field";
import Section from "./ui/Section";

type Props = {
  editing: boolean;

  open: boolean;

  customers: any[];
showCustomerDialog: boolean;

newCustomerName: string;
setNewCustomerName: (
  value: string
) => void;

onNewCustomer: () => void;

onOpenCustomerDialog: () => void;

onCloseCustomerDialog: () => void;
  customerId: string;
  setCustomerId: (value: string) => void;

  name: string;
  setName: (value: string) => void;

  cpm: string;
  setCpm: (value: string) => void;

  budget: string;
  setBudget: (value: string) => void;

  startDate: string;
  setStartDate: (value: string) => void;

  endDate: string;
  setEndDate: (value: string) => void;

  targetUrl: string;
  setTargetUrl: (value: string) => void;

  setFile: (
    file: File | null
  ) => void;

  onClose: () => void;

  onSave: () => void;

  fieldStyle: React.CSSProperties;
};

export default function CampaignDrawer({
  editing,

  open,

  customers,
showCustomerDialog,

newCustomerName,
setNewCustomerName,

onNewCustomer,

onOpenCustomerDialog,
onCloseCustomerDialog,

  customerId,
  setCustomerId,

  name,
  setName,

  cpm,
  setCpm,

  budget,
  setBudget,

  startDate,
  setStartDate,

  endDate,
  setEndDate,

  targetUrl,
  setTargetUrl,

  setFile,

  onClose,

  onSave,

  fieldStyle,
}: Props) {
  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "rgba(15,23,42,.25)",
        backdropFilter:
          "blur(6px)",
        display: "flex",
        justifyContent:
          "flex-end",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 560,
          background: "#fff",
          padding: 36,
          overflowY: "auto",
          borderTopLeftRadius: 32,
          borderBottomLeftRadius: 32,
          boxShadow:
            "0 24px 80px rgba(15,23,42,.18)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          {editing
            ? "Kampagne bearbeiten"
            : "Neue Kampagne"}
        </h2>

        <Section title="Kunde">
          <select
            value={customerId}
            onChange={(e) =>
              setCustomerId(
                e.target.value
              )
            }
            style={fieldStyle}
          >
            <option value="">
              Kunde wählen
            </option>

            {customers.map(
              (customer) => (
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
          <Button
  variant="secondary"
  style={{
    marginTop: 12,
    width: "100%",
  }}
  onClick={
    onOpenCustomerDialog
  }
>
  + Neuer Kunde
</Button>
        </Section>

        <Section title="Kampagne">
          <Field
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
            }
            placeholder="Sommerferien 2026"
          />
        </Section>

        <Section title="Abrechnung">
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "1fr 1fr",
              gap: 12,
            }}
          >
            <Field
              value={cpm}
              onChange={(e) =>
                setCpm(
                  e.target.value
                )
              }
              placeholder="CPM"
            />

            <Field
              value={budget}
              onChange={(e) =>
                setBudget(
                  e.target.value
                )
              }
              placeholder="Budget"
            />
          </div>
        </Section>

        <Section title="Banner">
          <input
            type="file"
            accept="image/*"
            onChange={(e) =>
              setFile(
                e.target
                  .files?.[0] ??
                  null
              )
            }
          />
        </Section>

        <Section title="Ziel URL">
          <Field
            value={targetUrl}
            onChange={(e) =>
              setTargetUrl(
                e.target.value
              )
            }
            placeholder="https://meineseite.de"
          />
        </Section>

        <Section title="Laufzeit">
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "1fr 1fr",
              gap: 12,
            }}
          >
            <input
              type="date"
              value={startDate}
              onChange={(e) =>
                setStartDate(
                  e.target.value
                )
              }
              style={fieldStyle}
            />

            <input
              type="date"
              value={endDate}
              onChange={(e) =>
                setEndDate(
                  e.target.value
                )
              }
              style={fieldStyle}
            />
          </div>
        </Section>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 36,
          }}
        >
          <Button
            variant="secondary"
            style={{
              flex: 1,
            }}
            onClick={onClose}
          >
            Abbrechen
          </Button>

          <Button
            style={{
              flex: 1,
            }}
            onClick={onSave}
          >
            {editing
              ? "Speichern"
              : "Kampagne anlegen"}
          </Button>
        </div>
      </div>

      {showCustomerDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(15,23,42,.35)",
            display: "flex",
            alignItems: "center",
            justifyContent:
              "center",
            zIndex: 3000,
          }}
        >
          <div
            style={{
              width: 420,
              background: "#fff",
              borderRadius: 24,
              padding: 28,
              boxShadow:
                "0 24px 80px rgba(15,23,42,.18)",
            }}
          >
            <h3
              style={{
                margin: 0,
                marginBottom: 20,
                fontSize: 24,
              }}
            >
              Neuer Kunde
            </h3>

            <Field
              value={
                newCustomerName
              }
              onChange={(e) =>
                setNewCustomerName(
                  e.target.value
                )
              }
              placeholder="Kundenname"
            />

            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 24,
              }}
            >
              <Button
                variant="secondary"
                style={{
                  flex: 1,
                }}
                onClick={
                  onCloseCustomerDialog
                }
              >
                Abbrechen
              </Button>

              <Button
                style={{
                  flex: 1,
                }}
                onClick={
                  onNewCustomer
                }
              >
                Kunde anlegen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}