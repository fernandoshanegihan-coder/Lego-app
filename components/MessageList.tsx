"use client";

import type { Idea } from "@/lib/sse";
import IdeaCard from "@/components/IdeaCard";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** A streaming assistant message — shows the caret while deltas arrive. */
  streaming?: boolean;
  ideas?: Idea[];
  error?: boolean;
}

export function MessageList({
  messages,
  onIdeaClick,
}: {
  messages: ChatMessage[];
  onIdeaClick: (title: string) => void;
}) {
  return (
    <div>
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            m.role === "user"
              ? "flex justify-end py-1"
              : "py-1"
          }
          data-role={m.role}
          data-error={m.error || undefined}
        >
          {m.role === "user" ? (
            <p
              className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[14px] leading-relaxed text-white"
              style={{ background: "var(--accent)" }}
            >
              {m.text}
            </p>
          ) : (
            <div className="max-w-full">
              {m.error ? (
                <p
                  className="rounded-2xl rounded-bl-md border px-3 py-2 text-[14px] leading-relaxed"
                  style={{ borderColor: "var(--edge)", background: "var(--bench)", color: "var(--ink)" }}
                  role="alert"
                >
                  {m.text}
                </p>
              ) : (
                m.text && (
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--ink)" }}>
                    {m.text}
                    {m.streaming && <span className="ml-0.5 inline-block w-2 animate-pulse" style={{ color: "var(--accent)" }}>▍</span>}
                  </p>
                )
              )}
              {m.ideas && (
                <ul className="mt-2 space-y-2">
                  {m.ideas.map((idea, i) => (
                    <li key={i}>
                      <IdeaCard
                        index={i + 1}
                        title={idea.title}
                        description={idea.description}
                        onClick={() => onIdeaClick(idea.title)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
