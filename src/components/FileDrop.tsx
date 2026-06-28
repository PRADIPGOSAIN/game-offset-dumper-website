import { useRef, useState } from "react";
import { cn } from "../utils/cn";

interface Props {
  label: string;
  accept?: string;
  hint: string;
  icon: React.ReactNode;
  file: File | null;
  onFile: (f: File | null) => void;
}

export function FileDrop({ label, accept, hint, icon, file, onFile }: Props) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "group relative cursor-pointer rounded-2xl border-2 border-dashed p-6 transition-all",
        "border-slate-700 bg-slate-900/40 hover:border-violet-500 hover:bg-slate-900/70",
        drag && "border-violet-400 bg-violet-500/10 scale-[1.02]",
        file && "border-emerald-500/60 bg-emerald-500/5"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            file
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-violet-500/15 text-violet-300 group-hover:bg-violet-500/25"
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-100">{label}</h3>
            {file && (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
                Loaded
              </span>
            )}
          </div>
          {file ? (
            <p className="mt-1 truncate text-sm text-slate-300">
              {file.name}{" "}
              <span className="text-slate-500">
                · {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">{hint}</p>
          )}
        </div>
        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100"
            title="Remove"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
