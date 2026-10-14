import "./styles.css";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  Expand,
  FolderOpen,
  Layers3,
  LogOut,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Move3D,
  Redo2,
  Rotate3D,
  Ruler,
  Save,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import Scene from "./components/Scene";
import type { ExactMesh, Verified } from "./components/Scene";
import Inspector from "./components/Inspector";
import { TextField } from "./components/Fields";
import Library from "./components/Library";
import Chat from "./components/Chat";
import {
  ExportDialog,
  MeshyDialog,
  ProjectsDialog,
  SettingsDialog,
  assetPart,
} from "./components/Dialogs";
import { downloadJSON, request, saveProject, upload, waitJob } from "./api";
import type { Health } from "./api";
import { signature } from "./domain";
import type { Asset } from "./domain";
import { useStudio } from "./store";

function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const state = useStudio(),
    fileInput = useRef<HTMLInputElement>(null),
    [dialog, setDialog] = useState<
      "export" | "projects" | "settings" | "meshy" | null
    >(null);
  const [saving, setSaving] = useState(false),
    [importing, setImporting] = useState(false),
    [verifying, setVerifying] = useState(false),
    [verified, setVerified] = useState<Verified | null>(null),
    [poseOpen, setPoseOpen] = useState(false),
    [mobilePanel, setMobilePanel] = useState(false);
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => request<Health>("/health"),
    retry: false,
    refetchInterval: 15000,
  });
  useEffect(() => {
    const notice = (event: Event) => useStudio.getState().notify((event as CustomEvent<string>).detail);
    window.addEventListener("forma:notice", notice);
    return () => window.removeEventListener("forma:notice", notice);
  }, []);
  const dirty = state.savedRevision !== state.project.revision;
  async function save() {
    if (saving) return;
    // Commit the active editor before taking the keyboard-save snapshot.
    if (document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur();
    setSaving(true);
    const snapshot = useStudio.getState();
    try {
      const result = await saveProject(
        snapshot.project,
        snapshot.serverVersion,
      );
      const current = useStudio.getState();
      if (
        current.project.id === snapshot.project.id &&
        current.serverVersion === snapshot.serverVersion
      ) {
        current.markSaved(result.version, snapshot.project.revision);
        current.notify("Projekt zapisany na backendzie");
      }
    } catch (e) {
      useStudio.getState().notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function verify() {
    const snap = useStudio.getState(),
      part = snap.project.parts.find((p) => p.id === snap.selectedId);
    if (!part) return;
    setVerifying(true);
    try {
      const key = signature(snap.project, part);
      const job = await request<{ id: string }>("/jobs/preview", {
        project: snap.project,
        part_id: part.id,
      });
      const mesh = await waitJob<ExactMesh>(job.id);
      setVerified({ partId: part.id, signature: key, mesh });
      useStudio.getState().notify("Dokładna bryła CAD została przebudowana");
    } catch (e) {
      useStudio.getState().notify((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }
  function addAsset(asset: Asset) {
    const part = assetPart(asset);
    const s = useStudio.getState();
    if (s.commit([{ type: "add", part }])) {
      s.select(part.id);
      s.notify("Dodano siatkę. Sprawdź jej skalę i orientację.");
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      addAsset(await upload(file));
    } catch (e) {
      state.notify((e as Error).message);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDialog(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (
        dialog ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      const s = useStudio.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicate();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.remove();
      } else if (e.key.toLowerCase() === "v")
        useStudio.setState({ tool: "select" });
      else if (e.key.toLowerCase() === "g")
        useStudio.setState({ tool: "translate" });
      else if (e.key.toLowerCase() === "r")
        useStudio.setState({ tool: "rotate" });
      else if (e.key.toLowerCase() === "f")
        useStudio.setState({ frameTick: s.frameTick + 1 });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialog, saving]);
  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => useStudio.setState({ toast: null }), 6500);
    return () => clearTimeout(timer);
  }, [state.toast]);
  return (
    <div className={`app ${mobilePanel ? "mobile-inspector" : ""}`}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          aria-label="FORMA — warsztat 3D"
          onClick={(e) => e.preventDefault()}
        >
          <span className="brand-mark">
            <Box size={22} strokeWidth={1.6} />
          </span>
          FORMA<span className="brand-sub">STUDIO</span>
        </a>
        <div className="top-divider" />
        <button
          className="workspace-switch"
          onClick={() => setDialog("projects")}
        >
          Mój warsztat
          <ChevronDown size={12} />
        </button>
        <div className="top-spacer" />
        <span className="build-tag">
          EARLY BUILD <b>0.1</b>
        </span>
        <button
          className="icon-button mobile-panel-toggle"
          aria-label="Pokaż właściwości"
          onClick={() => setMobilePanel(!mobilePanel)}
        >
          <SlidersHorizontal size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Ustawienia połączeń"
          title="Połączenia"
          onClick={() => setDialog("settings")}
        >
          <Settings2 size={18} />
        </button>
        <button className="icon-button" aria-label="Wyloguj" title="Wyloguj" onClick={() => void onLogout()}>
          <LogOut size={18} />
        </button>
      </header>
      <div className="projectbar">
        <div className="project-breadcrumb">
          <button
            className="icon-button"
            title="Projekty"
            onClick={() => setDialog("projects")}
          >
            <FolderOpen size={16} />
          </button>
          <ChevronRight size={12} />
          <TextField
            label="Nazwa projektu"
            key={state.project.id}
            value={state.project.name}
            onChange={state.rename}
          />
          <span
            className={`save-dot ${dirty ? "dirty" : ""}`}
            title={
              dirty ? "Zmiany są zapisane lokalnie" : "Zapisano na backendzie"
            }
          />
        </div>
        <div className="project-actions">
          <button
            className="subtle"
            title="Pobierz przenośny dokument projektu"
            onClick={() => downloadJSON(state.project)}
          >
            <Download size={15} />
            <span>JSON</span>
          </button>
          <button
            className="subtle"
            onClick={() => fileInput.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Upload size={15} />
            )}
            <span>Importuj</span>
          </button>
          <button
            className="secondary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle size={15} className="spin" />
            ) : dirty ? (
              <Save size={15} />
            ) : (
              <Check size={15} />
            )}
            <span>Zapisz</span>
          </button>
          <button className="primary" onClick={() => setDialog("export")}>
            <ArrowDownToLine size={15} />
            <span>Eksportuj</span>
          </button>
        </div>
      </div>
      <main className="workspace">
        <Library onImport={() => fileInput.current?.click()} />
        <div className="viewport-column">
          <div className="canvas-area">
            <Scene verified={verified} />
            <div className="view-label">
              <span className="eyebrow">PRZESTRZEŃ TWORZENIA</span>
              <div>
                <i />
                Perspektywa <span>·</span> mm
              </div>
            </div>
            <div className="view-actions">
              <button
                className={state.xray ? "active" : ""}
                onClick={() => useStudio.setState({ xray: !state.xray })}
                title="Prześwietlenie obudów"
                aria-label="Prześwietlenie obudów"
              >
                <Layers3 size={17} />
              </button>
              <button
                className={state.showDimensions ? "active" : ""}
                onClick={() =>
                  useStudio.setState({ showDimensions: !state.showDimensions })
                }
                title="Pokaż wymiary"
                aria-label="Pokaż wymiary"
              >
                <Ruler size={17} />
              </button>
              <button
                onClick={() =>
                  useStudio.setState({ frameTick: state.frameTick + 1 })
                }
                title="Dopasuj widok · F"
                aria-label="Dopasuj widok"
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <div className="scene-toolbar">
              <button
                title="Zaznacz · V"
                aria-label="Zaznacz"
                className={state.tool === "select" ? "active" : ""}
                onClick={() => useStudio.setState({ tool: "select" })}
              >
                <MousePointer2 size={18} />
              </button>
              <button
                title="Przesuń · G"
                aria-label="Przesuń"
                className={state.tool === "translate" ? "active" : ""}
                onClick={() => useStudio.setState({ tool: "translate" })}
              >
                <Move3D size={20} />
              </button>
              <button
                title="Obróć · R"
                aria-label="Obróć"
                className={state.tool === "rotate" ? "active" : ""}
                onClick={() => useStudio.setState({ tool: "rotate" })}
              >
                <Rotate3D size={20} />
              </button>
              <i />
              <button
                title="Cofnij · Ctrl Z"
                aria-label="Cofnij"
                disabled={!state.past.length}
                onClick={state.undo}
              >
                <Undo2 size={18} />
              </button>
              <button
                title="Ponów · Ctrl Shift Z"
                aria-label="Ponów"
                disabled={!state.future.length}
                onClick={state.redo}
              >
                <Redo2 size={18} />
              </button>
            </div>
            <div className="scene-bottom">
              <div className="scene-hint">
                <span>Obrót</span> przeciągnij <i>·</i>
                <span>Zoom</span> scroll
              </div>
              <button
                className={poseOpen ? "pose-button active" : "pose-button"}
                onClick={() => setPoseOpen(!poseOpen)}
              >
                <Expand size={14} />
                Widok zespołu
                <ChevronDown size={12} />
              </button>
            </div>
            {poseOpen && (
              <div className="pose-popover">
                <strong>Podgląd zespołu</strong>
                <label>
                  Rozłożenie{" "}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={state.explode}
                    onChange={(e) =>
                      useStudio.setState({ explode: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Obrót głowy <span>{state.pan}°</span>
                  <input
                    type="range"
                    min={-30}
                    max={30}
                    step={1}
                    value={state.pan}
                    onChange={(e) =>
                      useStudio.setState({ pan: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Pochylenie <span>{state.tilt}°</span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={state.tilt}
                    onChange={(e) =>
                      useStudio.setState({ tilt: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={state.showRefs}
                    onChange={(e) =>
                      useStudio.setState({ showRefs: e.target.checked })
                    }
                  />
                  Pokaż elektronikę
                </label>
                <small>
                  Wizualizacja grup PICO. Bez obliczania kolizji; eksport
                  zachowuje pozycję konstrukcyjną.
                </small>
                <button
                  className="text-button"
                  onClick={() =>
                    useStudio.setState({ explode: 0, pan: 0, tilt: 0 })
                  }
                >
                  Zresetuj widok
                </button>
              </div>
            )}
            {!state.project.parts.length && (
              <div className="empty-scene">
                <span className="empty-scene-icon">
                  <Box size={38} />
                </span>
                <h1>Co dziś zbudujesz?</h1>
                <p>Dodaj pierwszą część i nadaj pomysłowi kształt.</p>
                <button
                  className="primary"
                  onClick={() => state.add("enclosure")}
                >
                  Dodaj obudowę
                </button>
              </div>
            )}
            <button
              className="generate-button"
              onClick={() => setDialog("meshy")}
            >
              <Sparkles size={15} />
              Obraz → 3D
            </button>
          </div>
          <Chat health={health} />
        </div>
        <Inspector
          verified={verified}
          onVerify={() => void verify()}
          busy={verifying}
          online={!!health}
        />
      </main>
      <footer className="statusbar">
        <span>
          <i className={health ? "dot" : "dot offline"} />
          {health ? "Warsztat połączony" : "Tryb lokalny · backend offline"}
        </span>
        <span>
          {state.project.parts.length} elementów <i>·</i> Rewizja{" "}
          {state.project.revision}
        </span>
        <span className="status-right">
          <Cloud size={12} /> {dirty ? "Zmiany lokalne" : "Zapisano"}
          <i>·</i> Z ↑ <i>·</i> 1 jednostka = 1 mm
        </span>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept=".stl,.glb"
        className="hidden"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {state.toast && (
        <div className="toast" role="status">
          <span>{state.toast}</span>
          <button
            aria-label="Zamknij powiadomienie"
            onClick={() => useStudio.setState({ toast: null })}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === "projects" && (
        <ProjectsDialog onClose={() => setDialog(null)} />
      )}
      {dialog === "settings" && (
        <SettingsDialog health={health} onClose={() => setDialog(null)} />
      )}
      {dialog === "meshy" && (
        <MeshyDialog
          health={health}
          onClose={() => setDialog(null)}
          onAsset={addAsset}
        />
      )}
    </div>
  );
}
export default App;
