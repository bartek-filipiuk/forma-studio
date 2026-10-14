import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  Box,
  Check,
  ChevronRight,
  FileBox,
  ImagePlus,
  LoaderCircle,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { request, upload, waitJob, downloadURL } from "../api";
import type { Health } from "../api";
import type { Asset, Part, Project } from "../domain";
import { demo, validateProject } from "../domain";
import { useStudio } from "../store";

export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const nodes = [
            ...ref.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]',
            ),
          ].filter((el) => el.offsetParent !== null);
          const first = nodes[0],
            last = nodes.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === ref.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Zamknij"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const state = useStudio(),
    meshes = state.project.parts.filter((p) => p.role === "print" && p.template === "mesh"),
    parts = state.project.parts.filter(
      (p) => p.role === "print" && p.template !== "mesh",
    );
  const [format, setFormat] = useState<"3mf" | "stl" | "step">("3mf"),
    [ids, setIds] = useState<string[]>(
      parts.some((p) => p.id === state.selectedId)
        ? [state.selectedId!]
        : meshes.some((p) => p.id === state.selectedId)
          ? []
          : parts.map((p) => p.id),
    );
  const [layout, setLayout] = useState("plate"),
    [bed, setBed] = useState([250, 250, 250]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [asset, setAsset] = useState<Asset | null>(null);
  useEffect(() => setAsset(null), [format, ids, layout, bed]);
  async function run() {
    setBusy(true);
    setError("");
    setAsset(null);
    try {
      const job = await request<{ id: string }>("/jobs/export", {
        project: state.project,
        part_ids: ids,
        format,
        layout,
        bed,
      });
      const result = await waitJob<Asset>(job.id);
      setAsset(result);
      downloadURL(result.url + "?download=true");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Z warsztatu do rzeczywistości"
      subtitle="Eksport dokładnej geometrii z silnika CAD."
      onClose={onClose}
    >
      <div className="format-options">
        {(
          [
            { id: "3mf", title: "Bambu Studio", sub: "3MF · osobne części" },
            { id: "stl", title: "Uniwersalny", sub: "STL · siatka" },
            { id: "step", title: "Dalszy CAD", sub: "STEP · bryły" },
          ] as const
        ).map((f) => (
          <button
            disabled={busy}
            className={format === f.id ? "active" : ""}
            key={f.id}
            onClick={() => {
              setFormat(f.id);
              setAsset(null);
            }}
          >
            <FileBox size={24} />
            <strong>{f.title}</strong>
            <span>{f.sub}</span>
          </button>
        ))}
      </div>
      <div className="export-note">
        <strong>
          {format === "3mf"
            ? "3MF z geometrią, bez cięcia"
            : "Wymiary w milimetrach"}
        </strong>
        <p>
          {format === "3mf"
            ? "W Bambu Studio wybierz profil drukarki, dyszę i filamenty, sprawdź orientację oraz podpory i wykonaj cięcie. Kolory podglądu nie przypisują automatycznie slotów AMS."
            : format === "step"
              ? "Bryły pozostają dokładne. Historia parametrów zostaje w projekcie FORMA; standardowy STEP jej nie przenosi."
              : "Plik zawiera geometrię wybranych części. Ustawienia drukowania dobierzesz w slicerze."}
        </p>
      </div>
      {meshes.length > 0 && (
        <div className="export-note">
          <strong>Importowane siatki nie są objęte eksportem CAD</strong>
          <p>Pobierz ich oryginalne pliki osobno. Ten eksport zawiera tylko zaznaczone części parametryczne.</p>
          {meshes.map((part) => (
            <a key={part.id} className="secondary full" href={`/api/assets/${part.asset_id}/content?download=true`}>
              Pobierz źródło: {part.name}
            </a>
          ))}
        </div>
      )}
      <div className="section-heading">
        <h3>Części do eksportu</h3>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setIds(parts.map((p) => p.id))}
        >
          Wybierz wszystkie
        </button>
      </div>
      <div className="export-parts">
        {parts.map((p) => (
          <label key={p.id}>
            <input
              disabled={busy}
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={() =>
                setIds((v) =>
                  v.includes(p.id) ? v.filter((x) => x !== p.id) : [...v, p.id],
                )
              }
            />
            <i style={{ background: p.color }} />
            <span>{p.name}</span>
          </label>
        ))}
      </div>
      <div className="export-settings">
        <label>
          Ułożenie
          <select
            disabled={busy}
            value={layout}
            onChange={(e) => setLayout(e.target.value)}
          >
            <option value="plate">Rozłóż na płycie, dnem na Z=0</option>
            <option value="assembly">Zachowaj położenia zespołu</option>
          </select>
        </label>
        {layout === "plate" && (
          <label>
            Wymiary płyty / wysokość · mm
            <div className="bed-fields">
              {bed.map((n, i) => (
                <input
                  disabled={busy}
                  type="number"
                  min={20}
                  max={2000}
                  aria-label={
                    ["Szerokość płyty", "Głębokość płyty", "Wysokość robocza"][
                      i
                    ]
                  }
                  value={n}
                  key={i}
                  onChange={(e) =>
                    setBed((v) =>
                      v.map((x, j) => (j === i ? Number(e.target.value) : x)),
                    )
                  }
                />
              ))}
            </div>
            <small>
              Wpisz wartości dla swojego profilu drukarki. 250 mm to wartość
              robocza.
            </small>
          </label>
        )}
      </div>
      {error && (
        <div className="error-notice" role="alert">
          {error}
        </div>
      )}
      {asset && (
        <a className="success-notice" href={asset.url + "?download=true"}>
          <Check size={16} />
          Gotowe — pobierz {asset.name}
        </a>
      )}
      <div className="modal-footer">
        <span>{ids.length} części · elektronika pominięta</span>
        <button
          className="primary"
          disabled={busy || !ids.length}
          onClick={() => void run()}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <ArrowDownToLine size={16} />
          )}{" "}
          {busy ? "Przygotowuję plik…" : "Eksportuj projekt"}
        </button>
      </div>
    </Modal>
  );
}
export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<
      { id: string; name: string; version: number }[] | null
    >(null),
    [error, setError] = useState("");
  const state = useStudio();
  async function list() {
    try {
      setProjects(await request("/projects"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function open(id: string) {
    try {
      const data = await request<{ project: Project; version: number }>(
        `/projects/${id}`,
      );
      state.load(data.project, data.version);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const document = validateProject(JSON.parse(await file.text()));
      await request("/validate", document);
      state.load(document, null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title="Twoje projekty"
      subtitle="Pobierz bieżący JSON przed zastąpieniem niezapisanych zmian."
      onClose={onClose}
    >
      <div className="project-starts">
        <button
          onClick={() => {
            state.load({
              schema_version: 1,
              id: crypto.randomUUID(),
              name: "Nowy projekt",
              units: "mm",
              revision: 0,
              parts: [],
            });
            onClose();
          }}
        >
          <Plus size={22} />
          <strong>Pusta przestrzeń</strong>
          <span>Zacznij od własnego pomysłu</span>
        </button>
        <button
          onClick={() => {
            state.load({ ...structuredClone(demo), id: crypto.randomUUID() });
            onClose();
          }}
        >
          <Box size={22} />
          <strong>Nowy PICO</strong>
          <span>Edytowalny projekt przykładowy</span>
        </button>
      </div>
      <label className="file-button">
        <Upload size={17} />
        Wczytaj projekt .forma.json
        <input
          type="file"
          accept=".json"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </label>
      <button className="secondary full" onClick={() => void list()}>
        Pokaż projekty zapisane na backendzie
      </button>
      {projects && (
        <div className="project-list">
          {projects.length ? (
            projects.map((p) => (
              <button key={p.id} onClick={() => void open(p.id)}>
                <Box size={18} />
                <span>
                  {p.name}
                  <small>Wersja zapisu {p.version}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          ) : (
            <p>Jeszcze nie ma zapisanych projektów.</p>
          )}
        </div>
      )}
      {error && <div className="error-notice">{error}</div>}
    </Modal>
  );
}
export function SettingsDialog({
  health,
  onClose,
}: {
  health: Health | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Połączenia warsztatu"
      subtitle="Klucze API pozostają wyłącznie na backendzie."
      onClose={onClose}
    >
      <div className="connection-list">
        <div>
          <Box />
          <span>
            <strong>Dokładny CAD</strong>
            <small>CadQuery / Open CASCADE</small>
          </span>
          <b className={health ? "connected" : ""}>
            {health ? "Połączony" : "Offline"}
          </b>
        </div>
        <div>
          <Sparkles />
          <span>
            <strong>Asystent projektowania</strong>
            <small>
              {health?.chat === "openai"
                ? "OpenAI — konfiguracja serwera"
                : "Dostępne polecenia lokalne"}
            </small>
          </span>
          <b>{health?.chat === "openai" ? "OpenAI" : "Lokalny"}</b>
        </div>
        <div>
          <ImagePlus />
          <span>
            <strong>Obraz → model 3D</strong>
            <small>Meshy · płatna generacja</small>
          </span>
          <b className={health?.meshy ? "connected" : ""}>
            {health?.meshy ? "Połączony" : "Bez klucza"}
          </b>
        </div>
      </div>
      <div className="export-note">
        <strong>Konfiguracja lokalna</strong>
        <p>
          W pliku <code>.env</code> ustaw <code>FORMA_OPENAI_API_KEY</code> i{" "}
          <code>FORMA_OPENAI_MODEL</code>. Meshy używa{" "}
          <code>FORMA_MESHY_API_KEY</code>. Następnie odtwórz kontenery API i
          workera zgodnie z README.
        </p>
      </div>
      <p className="muted-copy">
        Ta wersja działa dla jednego użytkownika na localhost. Automatyczne
        cięcie i sterowanie drukarką nie są jeszcze podłączone.
      </p>
    </Modal>
  );
}
export function MeshyDialog({
  health,
  onClose,
  onAsset,
}: {
  health: Health | undefined;
  onClose: () => void;
  onAsset: (asset: Asset) => void;
}) {
  const [image, setImage] = useState<Asset | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  async function choose(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      setImage(await upload(file));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!image) return;
    const projectId = useStudio.getState().project.id;
    setBusy(true);
    setError("");
    try {
      const job = await request<{ id: string }>("/jobs/meshy", {
        asset_id: image.id,
      });
      setStatus(`Zadanie ${job.id}`);
      const asset = await waitJob<Asset>(job.id, (s) =>
        setStatus(
          s === "running" ? "Meshy generuje model…" : "Oczekiwanie w kolejce…",
        ),
      );
      if (useStudio.getState().project.id !== projectId) {
        downloadURL(asset.url + "?download=true");
        useStudio
          .getState()
          .notify(
            "Projekt został zmieniony. Gotowy model pobrano osobno; możesz go zaimportować.",
          );
        return;
      }
      onAsset(asset);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Nadaj obrazowi trzeci wymiar"
      subtitle="Generowanie przez wymienny silnik Meshy."
      onClose={onClose}
    >
      <label className="image-upload">
        {image ? (
          <img src={image.url} alt="Obraz referencyjny" />
        ) : (
          <>
            <ImagePlus size={34} />
            <strong>Wybierz obraz referencyjny</strong>
            <span>PNG, JPG lub WEBP · do 10 MB</span>
          </>
        )}
        <input
          disabled={busy}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      <div className="export-note">
        <strong>
          {health?.meshy
            ? "Generacja zużywa kredyty na Twoim koncie Meshy"
            : "Najpierw skonfiguruj klucz Meshy"}
        </strong>
        <p>
          Wynik zostanie zapisany u Ciebie jako GLB i dodany do projektu.
          Sprawdź skalę, grubość detali i geometrię przed drukiem. Ta operacja
          nie tworzy projektu CAD ani pociętego wydruku.
        </p>
      </div>
      {status && <p className="muted-copy">{status}</p>}
      {error && <div className="error-notice">{error}</div>}
      <div className="modal-footer">
        <span>Obraz → siatka z teksturą</span>
        <button
          className="primary"
          disabled={busy || !image || !health?.meshy}
          onClick={() => void generate()}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}
          Generuj w Meshy
        </button>
      </div>
    </Modal>
  );
}
export function assetPart(asset: Asset): Part {
  return {
    id: crypto.randomUUID(),
    name: asset.name,
    template: "mesh",
    role: "print",
    color: "#dddcd4",
    visible: true,
    params: {},
    transform: {
      position: [90, 0, 0],
      rotation: [0, 0, 0],
      scale: asset.metadata?.provider === "meshy" ? 0.1 : 1,
    },
    asset_id: asset.id,
    fit_to: null,
    clearance: 0.4,
    group: "free",
  };
}
