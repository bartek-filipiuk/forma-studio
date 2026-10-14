import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  MoveUpRight,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authHeaders, setCSRF } from "./auth-client";

const Workshop = lazy(() => import("./App"));
type Session = {
  authenticated: boolean;
  configured?: boolean;
  username?: string;
  csrf_token?: string;
};
function navigate(path: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
function Brand() {
  return (
    <a
      className="public-brand"
      href="/"
      onClick={(e) => {
        e.preventDefault();
        navigate("/");
      }}
      aria-label="FORMA Studio — strona główna"
    >
      <Box size={25} strokeWidth={1.5} />
      <span>
        FORMA<small>STUDIO</small>
      </span>
    </a>
  );
}
function EnterLink({ children = "Wejdź do warsztatu" }: { children?: string }) {
  return (
    <a
      className="public-cta"
      href="/login"
      onClick={(e) => {
        e.preventDefault();
        navigate("/login");
      }}
    >
      {children}
      <ArrowUpRight size={19} />
    </a>
  );
}
function Landing() {
  return (
    <div className="public-page landing">
      <header className="public-nav">
        <Brand />
        <nav aria-label="Nawigacja główna">
          <a href="#warsztat">Poznaj warsztat</a>
          <EnterLink>Zaloguj się</EnterLink>
        </nav>
      </header>
      <main>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              Pomysł.
              <br />
              Kształt.
              <br />
              <em>Coś realnego.</em>
            </h1>
            <p>
              Twój warsztat 3D. Projektuj części, dopracuj wymiary i zabierz
              gotową geometrię do druku.
            </p>
            <EnterLink />
            <span className="private-note">
              <LockKeyhole size={13} /> Prywatna przestrzeń twórcza
            </span>
          </div>
          <figure className="hero-workshop">
            <div className="preview-bar">
              <span>
                <i /> PICO · projekt w toku
              </span>
              <span>mm · Z ↑</span>
            </div>
            <img
              src="/workshop.png"
              alt="PICO w warsztacie FORMA: edytowalna obudowa robota i widok części w przestrzeni 3D"
              width="926"
              height="595"
              fetchPriority="high"
            />
            <figcaption>
              <span>Od obudowy do całego zespołu.</span>
              <MoveUpRight size={21} />
            </figcaption>
          </figure>
        </section>
        <section
          className="workshop-story"
          id="warsztat"
          aria-labelledby="story-title"
        >
          <div className="story-title">
            <h2 id="story-title">
              Mniej klikania.
              <br />
              Więcej tworzenia.
            </h2>
            <p>
              Jeden projekt. Od pierwszej bryły po plik, który otworzysz w swoim
              slicerze.
            </p>
          </div>
          <div className="story-steps">
            <article>
              <h3>Nadaj pomysłowi kształt.</h3>
              <p>
                Zacznij od obudowy, prostej bryły albo importowanego STL czy
                GLB. Oglądaj projekt ze wszystkich stron.
              </p>
              <span>
                Biblioteka części <ArrowRight size={15} /> widok 3D
              </span>
            </article>
            <article>
              <h3>Dopasuj każdy milimetr.</h3>
              <p>
                Zmieniaj wymiary w panelu lub poleceniem na czacie. Cofnij
                zmianę, wypróbuj inną wersję, znajdź właściwą formę.
              </p>
              <span>
                Parametry <ArrowRight size={15} /> dokładna geometria CAD
              </span>
            </article>
            <article>
              <h3>Przenieś go poza ekran.</h3>
              <p>
                Eksportuj części CAD do 3MF, STL lub STEP. Dobierz ustawienia i
                przygotuj wydruk w slicerze.
              </p>
              <span>
                Projekt <ArrowRight size={15} /> plik do dalszej pracy
              </span>
            </article>
          </div>
        </section>
        <section className="landing-close">
          <h2>
            Tu zaczyna się
            <br />
            Twój następny projekt.
          </h2>
          <EnterLink />
        </section>
      </main>
      <footer className="public-footer">
        <Brand />
        <span>Warsztat w rozwoju. Dostęp tylko dla właściciela.</span>
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            navigate("/login");
          }}
        >
          Otwórz warsztat <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}

export default function AuthShell() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    const changed = () => {
      setSession(null);
      setCSRF();
      setLoading(window.location.pathname !== "/");
      setPath(window.location.pathname);
      setError("");
    };
    const unauthorized = () => {
      setSession(null);
      setCSRF();
      queryClient.clear();
      navigate("/login", true);
      setError(
        "Sesja wygasła. Zaloguj się ponownie; lokalne zmiany projektu zostały zachowane.",
      );
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("forma:unauthorized", unauthorized);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("forma:unauthorized", unauthorized);
    };
  }, [queryClient]);
  useEffect(() => {
    document.title =
      path === "/app"
        ? "Warsztat — FORMA Studio"
        : path === "/login"
          ? "Zaloguj się — FORMA Studio"
          : "FORMA Studio — od pomysłu do formy";
    window.scrollTo(0, 0);
    if (path === "/") return;
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/auth/session", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Nie można połączyć się z warsztatem. Spróbuj ponownie.",
          );
        const data: Session = await response.json();
        if (controller.signal.aborted) return;
        setSession(data);
        setCSRF(data.csrf_token);
        if (data.authenticated && path === "/login") navigate("/app", true);
        else if (!data.authenticated && path !== "/login")
          navigate("/login", true);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Brak połączenia z warsztatem.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Sprawdź login i hasło.",
        );
      setPassword("");
      setSession(data);
      setCSRF(data.csrf_token);
      queryClient.clear();
      navigate("/app", true);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Brak połączenia z warsztatem. Spróbuj ponownie."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: authHeaders(),
      });
      if (!response.ok && response.status !== 401)
        throw new Error("Nie udało się wylogować. Spróbuj ponownie.");
      setSession(null);
      setCSRF();
      setPassword("");
      queryClient.clear();
      // Retain the owner's local recovery document, but tear down all editor
      // state so history/back cannot display it without a fresh session check.
      window.location.replace("/login");
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent("forma:notice", { detail: (e as Error).message }),
      );
    }
  }
  if (path === "/") return <Landing />;
  if (path === "/app" && session?.authenticated && !loading)
    return (
      <Suspense
        fallback={
          <div className="public-loading" role="status">
            Otwieram warsztat…
          </div>
        }
      >
        <Workshop onLogout={logout} />
      </Suspense>
    );
  return (
    <div className="public-page login-page">
      <header className="public-nav">
        <Brand />
        <a
          className="back-home"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          Wróć na stronę główną <ArrowUpRight size={16} />
        </a>
      </header>
      <main className="login-layout">
        <div className="login-intro">
          <span className="login-mark" aria-hidden="true">
            <Box size={76} strokeWidth={0.8} />
          </span>
          <h1>
            Twoje pomysły.
            <br />
            Twój warsztat.
          </h1>
          <p>
            Wróć do projektu.
            <br />
            Reszta nabierze kształtu.
          </p>
          <span className="private-note">
            <LockKeyhole size={14} /> Dostęp tylko dla właściciela
          </span>
        </div>
        <section className="login-form-area" aria-labelledby="login-title">
          <h2 id="login-title">Dobrze Cię widzieć.</h2>
          <p>Zaloguj się do FORMA Studio.</p>
          <form onSubmit={(e) => void login(e)}>
            <label htmlFor="owner-login">Login</label>
            <input
              id="owner-login"
              name="username"
              autoComplete="username"
              required
              maxLength={100}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            <label htmlFor="owner-password">Hasło</label>
            <div className="password-field">
              <input
                id="owner-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}
            {session?.configured === false && (
              <p className="login-info" role="status">
                Konto właściciela nie zostało jeszcze skonfigurowane. Po jego
                utworzeniu możesz się tu zalogować.
              </p>
            )}
            <button
              className="public-cta login-submit"
              type="submit"
              disabled={busy || loading || session?.configured === false}
            >
              {busy
                ? "Loguję…"
                : loading
                  ? "Sprawdzam połączenie…"
                  : "Wejdź do warsztatu"}
              <ArrowRight size={19} />
            </button>
          </form>
          <div className="login-footnote">
            <Check size={15} />
            <span>To prywatny warsztat. Rejestracja jest zamknięta.</span>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>FORMA Studio</span>
        <span>Od pomysłu do formy.</span>
      </footer>
    </div>
  );
}
