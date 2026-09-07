"use client";

import { useState, useRef, useEffect } from "react";
import { signOut } from "next-auth/react";
import { useCrossings } from "../context/CrossingsContext";
import MyCrossingsMap from "./MyCrossingsMap";

export default function Header() {
  const {
    saved,
    available,
    activeId,
    favoriteId,
    setActiveId,
    setFavorite,
    addCrossing,
    removeCrossing,
  } = useCrossings();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeCrossing =
    saved.find((c) => c.id === activeId) ?? saved[0];

  const addableCrossings = available.filter(
    (c) => !saved.some((s) => s.id === c.id)
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () =>
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
  }, []);

  return (
    <header className="appHeader">
      <div className="appHeaderTitle">
        {activeCrossing?.name ?? "Bahnübergang"}
      </div>

      <div className="appHeaderMenu" ref={menuRef}>
        <button
          className="appHeaderMenuButton"
          onClick={() => setOpen((o) => !o)}
          aria-label="Schranken wählen"
        >
          ☰
        </button>

        {open && (
          <div className="appHeaderDropdown">
            <div className="appHeaderDropdownLabel">
              Meine Schranken
            </div>

            {saved.length > 0 && (
              <div className="appHeaderMapWrap">
                <MyCrossingsMap
                  crossings={saved}
                  activeId={activeId}
                  favoriteId={favoriteId}
                  onSelect={(id) => {
                    setActiveId(id);
                  }}
                />
              </div>
            )}

            {saved.map((crossing) => (
              <div
                key={crossing.id}
                className="appHeaderDropdownRow"
              >
                <button
                  className={`appHeaderDropdownItem ${
                    crossing.id === activeId
                      ? "appHeaderDropdownItemActive"
                      : ""
                  }`}
                  onClick={() => {
                    setActiveId(crossing.id);
                    setOpen(false);
                  }}
                >
                  <span className="appHeaderDropdownItemMain">
                    {favoriteId === crossing.id && (
                      <span
                        className="appHeaderFavorite"
                        aria-label="Favorit"
                      >
                        ★
                      </span>
                    )}
                    <span>{crossing.name}</span>
                  </span>
                </button>

                {saved.length > 0 && (
                  <button
                    type="button"
                    className={`appHeaderDropdownFavorite ${
                      favoriteId === crossing.id
                        ? "appHeaderDropdownFavoriteActive"
                        : ""
                    }`}
                    aria-label={
                      favoriteId === crossing.id
                        ? `${crossing.name} ist Favorit`
                        : `${crossing.name} als Favorit setzen`
                    }
                    onClick={() => setFavorite(crossing.id)}
                  >
                    ★
                  </button>
                )}

                {saved.length > 1 && (
                  <button
                    className="appHeaderDropdownRemove"
                    aria-label={`${crossing.name} entfernen`}
                    onClick={() =>
                      removeCrossing(crossing.id)
                    }
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            {addableCrossings.length > 0 && (
              <>
                <div className="appHeaderDropdownLabel">
                  Hinzufügen
                </div>

                {addableCrossings.map((crossing) => (
                  <button
                    key={crossing.id}
                    className="appHeaderDropdownItem appHeaderDropdownItemAdd"
                    onClick={() => {
                      addCrossing(crossing);
                      setOpen(false);
                    }}
                  >
                    + {crossing.name}
                  </button>
                ))}
              </>
            )}

            {addableCrossings.length === 0 &&
              saved.length === available.length && (
                <div className="appHeaderDropdownEmpty">
                  Alle Schranken hinzugefügt
                </div>
              )}

            <div className="appHeaderDropdownDivider" />

            <button
              type="button"
              className="appHeaderDropdownLogout"
              onClick={() =>
                signOut({
                  callbackUrl: "/",
                })
              }
            >
              Abmelden
            </button>
          </div>
        )}
      </div>
    </header>
  );
}