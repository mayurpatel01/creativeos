"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { RaniStreamEvent } from "../api/rani/chat/route";
import type { StatusSummary } from "@/lib/rani/status";

type Message = { role: "user" | "assistant"; content: string; note?: string };

const STARTERS = [
  "Where are we on HinduTees, and what's the bottleneck?",
  "What should Kajol work on next?",
  "Give me this week's top three priorities.",
];

function Avatar() {
  return (
    <div
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c9a84c] font-semibold text-[#0a0a0a]"
    >
      R
    </div>
  );
}

export function RaniChat({ summary }: { summary: StatusSummary | null }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Bumped by "New chat" so a request from the old chat can't write into the new one.
  const chatGeneration = useRef(0);

  // Voice state
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing" | "speaking">("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceSupported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);


  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;

    // Only completed text turns go back to the API; notes are UI-only.
    const history = [...messages, { role: "user" as const, content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = chatGeneration.current;
    const current = () => chatGeneration.current === generation;
    let received = "";

    const updateLast = (update: (m: Message) => Message) => {
      if (!current()) return;
      setMessages((prev) =>
        prev.length ? [...prev.slice(0, -1), update(prev[prev.length - 1])] : prev,
      );
    };

    // A failed turn is removed so the conversation stays user/assistant alternating.
    const rollback = (message: string) => {
      if (!current()) return;
      setMessages((prev) => prev.slice(0, -2));
      setInput(content);
      setError(message);
    };

    try {
      const res = await fetch("/api/rani/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        rollback(body?.error ?? `Request failed (${res.status}).`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;
      let stopReason: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as RaniStreamEvent;
          if (event.type === "text") {
            received += event.text;
            updateLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "error") {
            streamError = event.message;
          } else if (event.type === "done") {
            stopReason = event.stopReason;
          }
        }
      }

      if (streamError && !received) {
        rollback(streamError);
      } else if (streamError) {
        updateLast((m) => ({ ...m, note: `Response interrupted: ${streamError}` }));
      } else if (stopReason === "refusal" && !received) {
        rollback("Rani declined to answer that. Try rephrasing.");
      } else if (stopReason === "refusal") {
        updateLast((m) => ({ ...m, note: "Rani stopped partway and declined to continue." }));
      } else if (stopReason === "max_tokens") {
        updateLast((m) => ({ ...m, note: "Response hit the length limit." }));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped by the user: keep any partial answer, drop the turn if nothing arrived.
        if (!current()) {
          // "New chat" aborted this request; the old conversation is already gone.
        } else if (!received) {
          setMessages((prev) => prev.slice(0, -2));
          setInput(content);
        } else {
          updateLast((m) => ({ ...m, note: "Stopped." }));
        }
      } else {
        console.error("[Rani] chat failed", err);
        if (received) updateLast((m) => ({ ...m, note: "Connection lost mid-response." }));
        else rollback("Couldn't reach Rani. Check your connection and try again.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (current()) {
        setStreaming(false);
        inputRef.current?.focus();
      }
    }
  }

  // Plays Rani's reply through TTS after streaming completes.
  const speakText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setVoiceState("speaking");
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setVoiceState("idle");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setVoiceState("idle");
      };
      await audio.play().catch(() => setVoiceState("idle"));
    } catch {
      setVoiceState("idle");
    }
  }, []);

  // Sends text and optionally reads the response aloud.
  const sendWithVoice = useCallback(async (text: string, readAloud: boolean) => {
    const content = text.trim();
    if (!content || streaming) return;

    const history = [...messages, { role: "user" as const, content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = chatGeneration.current;
    const current = () => chatGeneration.current === generation;
    let received = "";

    const updateLast = (update: (m: Message) => Message) => {
      if (!current()) return;
      setMessages((prev) =>
        prev.length ? [...prev.slice(0, -1), update(prev[prev.length - 1])] : prev,
      );
    };

    const rollback = (message: string) => {
      if (!current()) return;
      setMessages((prev) => prev.slice(0, -2));
      setInput(content);
      setError(message);
    };

    try {
      const res = await fetch("/api/rani/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });

      if (res.status === 401) { router.push("/admin/login"); return; }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        rollback(body?.error ?? `Request failed (${res.status}).`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;
      let stopReason: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as RaniStreamEvent;
          if (event.type === "text") {
            received += event.text;
            updateLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "error") {
            streamError = event.message;
          } else if (event.type === "done") {
            stopReason = event.stopReason;
          }
        }
      }

      if (streamError && !received) rollback(streamError);
      else if (streamError) updateLast((m) => ({ ...m, note: `Response interrupted: ${streamError}` }));
      else if (stopReason === "refusal" && !received) rollback("Rani declined to answer that. Try rephrasing.");
      else if (stopReason === "refusal") updateLast((m) => ({ ...m, note: "Rani stopped partway and declined to continue." }));
      else if (stopReason === "max_tokens") updateLast((m) => ({ ...m, note: "Response hit the length limit." }));

      // Read aloud after full stream — only if voice-triggered and no error
      if (readAloud && received && !streamError && stopReason !== "refusal") {
        void speakText(received);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Stop audio if playing
        audioRef.current?.pause();
        audioRef.current = null;
        setVoiceState("idle");
        if (!current()) {
          // New chat aborted this
        } else if (!received) {
          setMessages((prev) => prev.slice(0, -2));
          setInput(content);
        } else {
          updateLast((m) => ({ ...m, note: "Stopped." }));
        }
      } else {
        console.error("[Rani] chat failed", err);
        if (received) updateLast((m) => ({ ...m, note: "Connection lost mid-response." }));
        else rollback("Couldn't reach Rani. Check your connection and try again.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (current()) {
        setStreaming(false);
        if (!readAloud) inputRef.current?.focus();
      }
    }
  }, [messages, streaming, router, speakText]);

  // Mic: press to start recording, release to transcribe + send
  const startRecording = useCallback(async () => {
    if (voiceState !== "idle" || streaming) return;
    // Stop any playing audio first
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setVoiceState("idle"); }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        if (blob.size < 1000) { setVoiceState("idle"); return; } // too short

        setVoiceState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
          if (!res.ok) throw new Error(`Transcribe failed: ${res.status}`);
          const { text } = await res.json() as { text: string };
          if (text?.trim()) {
            setVoiceState("idle");
            void sendWithVoice(text.trim(), true);
          } else {
            setVoiceState("idle");
          }
        } catch (err) {
          console.error("[voice] transcribe error", err);
          setVoiceState("idle");
        }
      };

      mr.start();
      setVoiceState("recording");
    } catch (err) {
      console.error("[voice] mic access denied", err);
      setVoiceState("idle");
    }
  }, [voiceState, streaming, sendWithVoice]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  function newChat() {
    chatGeneration.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <main className="flex h-dvh flex-1 flex-col bg-[#0a0a0a] text-neutral-200">
      <header className="border-b border-neutral-800 bg-[#0d0d0d]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Avatar />
            <div>
              <h1 className="text-lg leading-tight font-semibold text-white">Rani</h1>
              <p className="text-xs text-[#c9a84c]">AI CEO · The Internet Marketing Company</p>
            </div>
          </div>

          {summary && (
            <dl className="flex gap-5 text-xs">
              <div>
                <dt className="text-neutral-500">Assets</dt>
                <dd className="font-semibold tabular-nums text-white">{summary.totalAssets}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Approved</dt>
                <dd className="font-semibold tabular-nums text-white">{summary.totalApproved}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Active designers</dt>
                <dd className="font-semibold tabular-nums text-white">{summary.activeDesigners}</dd>
              </div>
            </dl>
          )}

          <div className="ml-auto flex items-center gap-2">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={newChat}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-[#c9a84c] hover:text-[#c9a84c]"
              >
                New chat
              </button>
            )}
            <Link
              href="/admin"
              className="rounded-md px-3 py-1.5 text-xs text-neutral-400 transition hover:text-[#c9a84c]"
            >
              ← Admin
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
          {messages.length === 0 && (
            <div className="py-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#c9a84c] text-2xl font-semibold text-[#0a0a0a]">
                R
              </div>
              <p className="mt-4 text-neutral-300">
                Rani has today&apos;s numbers. Ask about status, priorities, or the team.
              </p>
              {!summary && (
                <p className="mt-2 text-xs text-red-400">
                  The live status snapshot couldn&apos;t load, so answers about current numbers may be limited.
                </p>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-neutral-800 bg-[#111] px-4 py-2 text-sm text-neutral-300 transition hover:border-[#c9a84c]/70 hover:text-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#1a1a1a] px-4 py-2.5 whitespace-pre-wrap text-neutral-100">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <Avatar />
                <div className="min-w-0 flex-1 pt-1.5">
                  {m.content ? (
                    <div className="leading-relaxed whitespace-pre-wrap text-neutral-200">{m.content}</div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#c9a84c]" />
                      Rani is thinking…
                    </div>
                  )}
                  {m.note && <p className="mt-2 text-xs text-neutral-500 italic">{m.note}</p>}
                </div>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-neutral-800 bg-[#0d0d0d]">
        <form onSubmit={handleSubmit} className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={voiceState === "recording" ? "Listening…" : voiceState === "transcribing" ? "Transcribing…" : "Ask Rani…"}
              rows={1}
              autoFocus
              aria-label="Message Rani"
              className="max-h-48 min-h-[44px] flex-1 resize-y rounded-xl border border-neutral-700 bg-[#0a0a0a] px-4 py-2.5 text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c]"
            />

            {/* Mic button — only shown when voice is supported */}
            {voiceSupported && !streaming && (
              <button
                type="button"
                aria-label={voiceState === "recording" ? "Stop recording" : voiceState === "speaking" ? "Stop speaking" : "Record voice message"}
                onPointerDown={() => void startRecording()}
                onPointerUp={stopRecording}
                onPointerLeave={stopRecording}
                onClick={() => {
                  // Also handle as toggle for keyboard/click users
                  if (voiceState === "speaking") {
                    audioRef.current?.pause();
                    audioRef.current = null;
                    setVoiceState("idle");
                  }
                }}
                disabled={voiceState === "transcribing"}
                className={[
                  "h-11 w-11 flex-shrink-0 rounded-xl border transition flex items-center justify-center",
                  voiceState === "recording"
                    ? "border-red-500 bg-red-500/10 text-red-400 animate-pulse"
                    : voiceState === "speaking"
                    ? "border-[#c9a84c] bg-[#c9a84c]/10 text-[#c9a84c]"
                    : voiceState === "transcribing"
                    ? "border-neutral-700 text-neutral-600 cursor-wait"
                    : "border-neutral-700 text-neutral-400 hover:border-[#c9a84c] hover:text-[#c9a84c]",
                ].join(" ")}
              >
                {voiceState === "speaking" ? (
                  // Speaker icon
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                  </svg>
                ) : voiceState === "transcribing" ? (
                  // Spinner
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  // Mic icon
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="22"/>
                  </svg>
                )}
              </button>
            )}

            {streaming ? (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); audioRef.current?.pause(); audioRef.current = null; setVoiceState("idle"); }}
                className="h-11 rounded-xl border border-neutral-600 px-4 text-sm text-neutral-300 transition hover:border-red-800 hover:text-red-300"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="h-11 rounded-xl bg-[#c9a84c] px-5 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-neutral-600">Enter to send · Shift+Enter for new line · Hold mic to speak</p>
        </form>
      </div>
    </main>
  );
}
