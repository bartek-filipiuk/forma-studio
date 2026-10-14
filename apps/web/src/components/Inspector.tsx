import { NumberField, TextField } from "./Fields";
import {
  Box,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Link2Off,
  ScanLine,
  Trash2,
} from "lucide-react";
import {
  catalog,
  colors,
  dimensions,
  labels,
  resolvedParams,
  signature,
} from "../domain";
import { useStudio } from "../store";
import type { Verified } from "./Scene";

export default function Inspector({
  verified,
  onVerify,
  busy,
  online,
}: {
  verified: Verified | null;
  onVerify: () => void;
  busy: boolean;
  online: boolean;
}) {
  const state = useStudio(),
    part = state.project.parts.find((p) => p.id === state.selectedId);
  if (!part)
    return (
      <aside className="inspector">
        <div className="panel-heading">
          <span>WŁAŚCIWOŚCI</span>
        </div>
        <div className="empty-inspector">
          <Box size={35} strokeWidth={1} />
          <h3>Wybierz coś do tworzenia</h3>
          <p>Kliknij część na scenie albo dodaj nowy element z biblioteki.</p>
        </div>
      </aside>
    );
  const params = resolvedParams(state.project, part),
    size = dimensions(part, params),
    entry = catalog.find((c) => c.id === part.template);
  const checked =
    verified?.partId === part.id &&
    verified.signature === signature(state.project, part);
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <span>WŁAŚCIWOŚCI</span>
        <span className="tiny-tag">
          {part.role === "reference" ? "REFERENCJA" : "CZĘŚĆ"}
        </span>
      </div>
      <div className="inspector-title">
        <i style={{ background: part.color }} />
        <TextField
          key={part.id}
          label="Nazwa części"
          value={part.name}
          onChange={(name) => state.update(part.id, { name })}
        />
        <div className="mini-actions">
          <button
            title="Duplikuj część"
            aria-label="Duplikuj część"
            onClick={state.duplicate}
          >
            <Copy size={15} />
          </button>
          <button
            title="Usuń część"
            aria-label="Usuń część"
            onClick={state.remove}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="inspector-scroll">
        <div className="part-description">
          {entry?.description ??
            "Importowana siatka. Plik źródłowy zachowujemy osobno od transformacji w projekcie."}
        </div>
        {part.template !== "mesh" && (
          <section>
            <div className="section-heading">
              <h3>Wymiary</h3>
              <span>milimetry</span>
            </div>
            <div className="dimension-summary">
              {size
                .map((n) => (n * part.transform.scale).toFixed(1))
                .join(" × ")}{" "}
              <small>mm</small>
            </div>
            {part.fit_to && (
              <div className="linked-note">
                <Link2 size={13} />
                <span>Dopasowana do części referencyjnej</span>
                <button
                  aria-label="Odłącz zależność"
                  title="Odłącz i zachowaj obecne wymiary"
                  onClick={() =>
                    state.update(part.id, { fit_to: null, params })
                  }
                >
                  <Link2Off size={14} />
                </button>
              </div>
            )}
            <div className="fields">
              {Object.entries(params).map(([key, value]) => (
                <NumberField
                  key={`${part.id}:${key}`}
                  label={labels[key] ?? key}
                  value={value}
                  disabled={
                    !!part.fit_to && ["width", "depth", "height"].includes(key)
                  }
                  onChange={(v) =>
                    state.update(part.id, { params: { [key]: v } })
                  }
                />
              ))}
            </div>
            {part.fit_to && (
              <NumberField
                label="Luz na stronę"
                value={part.clearance}
                onChange={(v) => state.update(part.id, { clearance: v })}
              />
            )}
            {part.role === "reference" && !part.fit_to && (
              <button className="secondary full" onClick={state.enclose}>
                <Box size={15} />
                Zbuduj obudowę wokół
              </button>
            )}
          </section>
        )}
        <section>
          <div className="section-heading">
            <h3>Położenie</h3>
            <span>XYZ · Z w górę</span>
          </div>
          <div className="triple-fields">
            {part.transform.position.map((v, i) => (
              <NumberField
                key={i}
                label={["X", "Y", "Z"][i]}
                value={v}
                onChange={(n) => {
                  const next = [...part.transform.position];
                  next[i] = n;
                  return state.update(part.id, {
                    transform: { position: next },
                  });
                }}
              />
            ))}
          </div>
          <div className="section-heading small">
            <h3>Obrót</h3>
          </div>
          <div className="triple-fields">
            {part.transform.rotation.map((v, i) => (
              <NumberField
                key={i}
                label={["RX", "RY", "RZ"][i]}
                value={v}
                unit="°"
                step={5}
                onChange={(n) => {
                  const next = [...part.transform.rotation];
                  next[i] = n;
                  return state.update(part.id, {
                    transform: { rotation: next },
                  });
                }}
              />
            ))}
          </div>
          {part.template === "mesh" && (
            <NumberField
              label="Skala"
              value={part.transform.scale}
              unit="×"
              step={0.01}
              onChange={(v) =>
                state.update(part.id, { transform: { scale: v } })
              }
            />
          )}
        </section>
        <section>
          <div className="section-heading">
            <h3>Kolor podglądu</h3>
            <span>bez mapowania AMS</span>
          </div>
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                aria-label={`Kolor ${c}`}
                className={part.color === c ? "active" : ""}
                style={{ background: c }}
                onClick={() => state.update(part.id, { color: c })}
              >
                {part.color === c && <Check size={15} />}
              </button>
            ))}
            <label className="custom-color" title="Własny kolor">
              <input
                type="color"
                aria-label="Własny kolor"
                value={part.color}
                onChange={(e) =>
                  state.update(part.id, { color: e.target.value })
                }
              />
            </label>
          </div>
        </section>
        {part.template !== "mesh" ? (
          <section className="cad-panel">
            <div className="section-heading">
              <h3>Geometria CAD</h3>
              <span className={checked ? "green-text" : ""}>
                {checked ? "sprawdzona" : "podgląd"}
              </span>
            </div>
            <p>
              {checked
                ? `Poprawna bryła · ${(verified!.mesh.volume_mm3 / 1000).toFixed(2)} cm³ materiału geometrycznego.`
                : "Przebuduj dokładną bryłę w Open CASCADE i sprawdź poprawność geometrii."}
            </p>
            <button
              disabled={busy || !online}
              className="secondary full"
              onClick={onVerify}
            >
              <ScanLine size={15} className={busy ? "spin" : ""} />
              {busy ? "Przebudowa…" : "Sprawdź i pokaż CAD"}
            </button>
            <small>
              Poprawna bryła nie potwierdza dopasowania mechanicznego.
            </small>
          </section>
        ) : (
          <section>
            <a
              className="secondary full"
              href={`/api/assets/${part.asset_id}/content?download=true`}
            >
              <ExternalLink size={15} />
              Pobierz plik źródłowy
            </a>
          </section>
        )}
        <details className="keyboard-tip">
          <summary>Skróty klawiaturowe</summary>
          <dl>
            <div><dt>Enter / Esc</dt><dd>Zatwierdź / anuluj pole</dd></div>
            <div><dt>Ctrl / ⌘ S</dt><dd>Zapisz projekt</dd></div>
            <div><dt>Ctrl / ⌘ Z</dt><dd>Cofnij</dd></div>
            <div><dt>Ctrl / ⌘ Shift Z</dt><dd>Ponów</dd></div>
            <div><dt>Ctrl / ⌘ D</dt><dd>Duplikuj część</dd></div>
            <div><dt>V / G / R</dt><dd>Zaznacz / przesuń / obróć</dd></div>
            <div><dt>F</dt><dd>Dopasuj widok</dd></div>
            <div><dt>Delete</dt><dd>Usuń część</dd></div>
          </dl>
          <p>Skróty sceny działają poza polami tekstowymi.</p>
        </details>
      </div>
    </aside>
  );
}
