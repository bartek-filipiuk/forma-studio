import { useState } from "react";
import { ArrowUp, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { request } from "../api";
import type { Health } from "../api";
import type { Operation } from "../domain";
import { useStudio } from "../store";

export default function Chat({ health }: { health: Health | undefined }) {
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(true),
    [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  async function send(text = input) {
    if (!text.trim() || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m.slice(-8), { role: "user", text }]);
    const state = useStudio.getState();
    try {
      const result = await request<{
        message: string;
        operations: Operation[];
        base_revision: number;
        provider: string;
      }>("/chat", {
        project: state.project,
        selected_id: state.selectedId,
        message: text,
      });
      const now = useStudio.getState();
      if (
        now.project.id !== state.project.id ||
        now.project.revision !== result.base_revision
      )
        throw new Error(
          "Projekt zmienił się podczas odpowiedzi. Wyślij polecenie ponownie dla aktualnej wersji.",
        );
      if (result.operations.length && !now.commit(result.operations))
        throw new Error(
          "Plan nie przeszedł walidacji. Projekt pozostał bez zmian.",
        );
      if (result.operations.some((o) => o.type === "add"))
        now.select(result.operations.find((o) => o.type === "add")!.part!.id);
      setMessages((m) => [...m, { role: "assistant", text: result.message }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: (e as Error).message }]);
      // Preserve a newer draft typed while the previous request was running.
      setInput((draft) => draft || text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`chat-dock ${expanded ? "expanded" : "collapsed"}`}>
      <button className="chat-heading" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <Sparkles size={16} />
        <strong>Twórz słowami</strong>
        <span>
          {health?.chat === "openai"
            ? "OpenAI"
            : health
              ? "Polecenia lokalne"
              : "Backend offline"}
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      {expanded && (
        <>
          {messages.length > 0 ? (
            <div className="chat-messages" aria-live="polite">
              {messages.slice(-2).map((m, i) => (
                <div key={i} className={`message ${m.role}`}>
                  <span>
                    {m.role === "user"
                      ? "TY"
                      : m.role === "error"
                        ? "INFO"
                        : "FORMA"}
                  </span>
                  <p>{m.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="chat-welcome">
              Zaznacz część i powiedz, co chcesz zmienić. Każdą zmianę możesz
              cofnąć.
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="chat-input"
          >
            <input
              aria-label="Polecenie projektowania"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                health?.chat === "openai"
                  ? "Jak zmieniamy Twój projekt?"
                  : "Np. ustaw ściankę na 3 mm…"
              }
              maxLength={2000}
            />
            <button
              aria-label="Wyślij polecenie"
              type="submit"
              disabled={busy || !input.trim()}
            >
              {busy ? <span className="loader" /> : <ArrowUp size={18} />}
            </button>
          </form>
          <div className="prompt-chips">
            {["Ścianka 3 mm", "Zmień kolor na zielony", "Dodaj serwo"].map(
              (text) => (
                <button
                  key={text}
                  disabled={busy}
                  onClick={() => void send(text)}
                >
                  {text}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
