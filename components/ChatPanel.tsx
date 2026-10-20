"use client";

/**
 * The chat panel — the conversation. `spec.md > Components > ChatPanel`.
 *
 * Posts { messages, inventory } to /api/chat and renders the five streamed
 * event types: text (streaming), ideas (clickable cards), build + kernel
 * (forwarded to the page for the canvas and strip), error (a plain line).
 *
 * The greeting on load and the "add a set first" state both come from the PRD
 * wordings; the chat lives in memory and is lost on reload, by design.
 */
import { useEffect, useRef, useState } from "react";
import type { StoredSet } from "@/lib/types";
import type { ChatEvent, Idea } from "@/lib/sse";
import { MessageList, type ChatMessage } from "@/components/MessageList";

export default function ChatPanel({
  sets,
  onEvent,
}: {
  sets: StoredSet[];
  /** build + kernel events are consumed by the canvas and the strip. */
  onEvent?: (event: ChatEvent) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentAssistant = useRef<number | null>(null);

  const buildable = sets.reduce((sum, s) => sum + s.buildableParts, 0);

  // Keep the newest message in view — the stream types into it.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function append(update: (msgs: ChatMessage[]) => ChatMessage[]) {
    setMessages(update);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    currentAssistant.current = null;

    const history = messages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.text && !m.error))
      .map((m) => ({ role: m.role, content: m.text }));
    history.push({ role: "user", content: text });

    append((msgs) => [
      ...msgs,
      { id: nextId.current++, role: "user", text },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, inventory: sets }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`The chat request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // One event per blank-line-terminated `data:` chunk.
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!chunk.startsWith("data: ")) continue;
          let event: ChatEvent;
          try {
            event = JSON.parse(chunk.slice(6)) as ChatEvent;
          } catch {
            continue; // a torn chunk is skipped, not fatal
          }
          handleEvent(event);
        }
      }
      // The upstream stream ended: close the open bubble so the caret stops.
      closeAssistant(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The chat request failed.";
      closeAssistant(false);
      const id = nextId.current++;
      append((msgs) => [...msgs, { id, role: "assistant", text: message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function assistant(text: string): void {
    if (currentAssistant.current === null) {
      const id = nextId.current++;
      currentAssistant.current = id;
      append((msgs) => [
        ...msgs,
        { id, role: "assistant", text, streaming: true },
      ]);
    } else {
      append((msgs) =>
        msgs.map((m) => (m.id === currentAssistant.current ? { ...m, text: m.text + text } : m)),
      );
    }
  }

  /** Close the open assistant message. */
  function closeAssistant(asError: boolean): void {
    const id = currentAssistant.current;
    if (id !== null) {
      append((msgs) =>
        msgs.map((m) => (m.id === id ? { ...m, streaming: false, error: asError } : m)),
      );
    }
    currentAssistant.current = null;
  }

  function handleEvent(event: ChatEvent): void {
    switch (event.type) {
      case "text":
        assistant(event.text);
        break;
      case "ideas": {
        closeAssistant(false);
        const id = nextId.current++;
        append((msgs) => [
          ...msgs,
          { id, role: "assistant", text: "", ideas: event.ideas },
        ]);
        break;
      }
      case "build":
      case "kernel":
        onEvent?.(event);
        break;
      case "error": {
        // An error is one plain line in the chat — the page never white-screens.
        closeAssistant(false);
        const id = nextId.current++;
        append((msgs) => [
          ...msgs,
          { id, role: "assistant", text: event.message, error: true },
        ]);
        break;
      }
    }
  }

  const empty = messages.length === 0;

  return (
    <aside
      className="flex h-full w-[360px] shrink-0 flex-col border-l"
      style={{ borderColor: "var(--edge)", background: "var(--panel)" }}
      id="chat-panel"
    >
      <div className="flex-1 space-y-1 overflow-y-auto p-4" id="chat-scroll" ref={scrollRef}>
        <div
          className="rounded-2xl border px-3 py-3 mb-2"
          style={{ borderColor: "var(--edge)", background: "var(--bench)" }}
        >
          <p className="text-[15px] leading-relaxed font-medium" style={{ color: "var(--ink)" }}>
            {buildable === 0 ? "Enter a set number to get started." : `${buildable.toLocaleString("en-US")} buildable parts in the bin.`}
          </p>
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--dim)" }}>
            {buildable === 0
              ? "Tell Brickbrain which sets you own, and it designs a build using only the bricks you actually have."
              : "Ask what you can build — every brick it uses is one you own. Click an idea below to start it."}
          </p>
        </div>

        {empty && (
          <p className="text-[13px] leading-relaxed px-1" style={{ color: "var(--dim)" }}>
            {buildable === 0
              ? "Nothing in the bin yet — the chat needs a set first."
              : "Try: “what can I build?”"}
          </p>
        )}

        <MessageList messages={messages} onIdeaClick={(title) => void send(title)} />
      </div>

      <form
        className="flex gap-2 border-t p-3"
        style={{ borderColor: "var(--edge)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          id="chat-input"
          value={input}
          disabled={busy}
          placeholder={busy ? "Brickbrain is thinking…" : "Ask what you can build…"}
          onChange={(e) => setInput(e.target.value)}
          className="font-mono-brick w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={{
            borderColor: "var(--edge)",
            background: "var(--bench)",
            color: "var(--ink)",
          }}
        />
        <button
          type="submit"
          disabled={busy || input.trim() === ""}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          Send
        </button>
      </form>
    </aside>
  );
}
