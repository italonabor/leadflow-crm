import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Smile, Mic, Send, Trash2, Square, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  {
    label: "Frequentes",
    items: [
      "😀",
      "😁",
      "😂",
      "🤣",
      "😊",
      "😍",
      "😉",
      "👍",
      "👏",
      "🙏",
      "🔥",
      "🎉",
      "✅",
      "❤️",
      "💪",
      "🚀",
    ],
  },
  {
    label: "Rostos",
    items: [
      "😃",
      "😄",
      "🙂",
      "😇",
      "🤩",
      "😘",
      "😎",
      "🤔",
      "🤗",
      "😴",
      "😢",
      "😭",
      "😤",
      "😅",
      "🥰",
      "😬",
      "🙄",
      "😳",
      "🤝",
      "🫡",
    ],
  },
  {
    label: "Negócios",
    items: [
      "📞",
      "📱",
      "💬",
      "📧",
      "📅",
      "⏰",
      "📈",
      "📊",
      "💼",
      "💰",
      "🏆",
      "📌",
      "📝",
      "🔗",
      "⚡",
      "🎯",
    ],
  },
];

export function MessageComposer({
  value,
  onChange,
  onSend,
  onSendAudio,
  onOpenTemplates,
  sending = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onSendAudio?: (base64: string, mimeType: string) => Promise<void> | void;
  onOpenTemplates?: () => void;
  sending?: boolean;
  disabled?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // ---- gravação de áudio
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const cancelledRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function insertEmoji(e: string) {
    const el = taRef.current;
    if (!el) {
      onChange(value + e);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + e + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + e.length;
    });
  }

  async function startRecording() {
    if (!onSendAudio) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (cancelledRef.current) return;
        const raw = new Blob(chunksRef.current, { type: rec.mimeType || "audio/ogg" });
        if (raw.size < 1000) {
          toast.error("Áudio muito curto");
          return;
        }
        setUploading(true);
        try {
          // Nota de voz nativa do WhatsApp = OGG/Opus. Se o navegador já gravou em ogg,
          // envia direto; se gravou em webm/opus, remuxamos para ogg sem recodificar.
          // Só cai para MP3 se o áudio não for Opus (ex.: Safari em mp4).
          let out: Blob = raw;
          let mime = "audio/ogg";
          const recorded = (rec.mimeType || raw.type || "").toLowerCase();
          if (recorded.includes("ogg")) {
            out = new Blob([raw], { type: "audio/ogg" });
          } else if (recorded.includes("webm")) {
            const { webmOpusToOgg } = await import("@/lib/audio-ogg");
            try {
              out = await webmOpusToOgg(raw);
            } catch {
              const { blobToMp3 } = await import("@/lib/audio-mp3");
              out = await blobToMp3(raw);
              mime = "audio/mpeg";
            }
          } else {
            const { blobToMp3 } = await import("@/lib/audio-mp3");
            out = await blobToMp3(raw);
            mime = "audio/mpeg";
          }
          const base64 = await blobToBase64(out);
          await onSendAudio(base64, mime);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Falha ao enviar áudio");
        } finally {
          setUploading(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setSeconds(0);
      setRecording(true);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  }

  function stopRecording(cancel: boolean) {
    cancelledRef.current = cancel;
    recorderRef.current?.stop();
  }

  if (recording) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-surface px-3 py-2">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </span>
        <span className="font-mono text-sm tabular-nums">{formatTime(seconds)}</span>
        <span className="flex-1 text-xs text-muted-foreground">Gravando nota de voz…</span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => stopRecording(true)}
          aria-label="Cancelar gravação"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <Button
          size="icon"
          className="grad-brand text-primary-foreground"
          onClick={() => stopRecording(false)}
          aria-label="Enviar áudio"
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-end gap-2 rounded-2xl border border-border/60 bg-surface p-1.5">
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 rounded-full"
              aria-label="Emojis"
            >
              <Smile className="h-5 w-5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-72 p-2">
            <div className="grid max-h-64 gap-3 overflow-y-auto">
              {EMOJI_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {g.label}
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {g.items.map((e) => (
                      <button
                        key={e}
                        type="button"
                        className="rounded-md p-1 text-lg transition hover:bg-muted"
                        onClick={() => insertEmoji(e)}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {onOpenTemplates && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 rounded-full"
                onClick={onOpenTemplates}
                aria-label="Mensagem de modelo"
              >
                <FileText className="h-5 w-5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mensagem de modelo</TooltipContent>
          </Tooltip>
        )}

        <textarea
          ref={taRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder="Digite sua mensagem…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim() && !sending) onSend();
            }
          }}
          className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        {value.trim() ? (
          <Button
            size="icon"
            className="grad-brand shrink-0 rounded-full text-primary-foreground"
            disabled={sending || disabled}
            onClick={onSend}
            aria-label="Enviar"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        ) : onSendAudio ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                className="grad-brand shrink-0 rounded-full text-primary-foreground"
                disabled={disabled || uploading}
                onClick={startRecording}
                aria-label="Gravar áudio"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Gravar nota de voz</TooltipContent>
          </Tooltip>
        ) : (
          <Button size="icon" className="shrink-0 rounded-full" disabled aria-label="Enviar">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler áudio"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
