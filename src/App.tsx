import { useEffect, useMemo, useRef, useState } from "react";
import { FileDrop } from "./components/FileDrop";
import { AdvancedOptions, DEFAULT_EXTRAS, type ExtrasOptions } from "./components/AdvancedOptions";
import { DEFAULT_OPTIONS, type DumpOptions } from "./lib/dumper";
import DumpWorker from "./workers/dumpWorker?worker&inline";

type Status = "idle" | "loading" | "parsing" | "generating" | "done" | "error";

interface Stats {
  metaVersion: number;
  types: number;
  methods: number;
  fields: number;
  images: number;
  resolvedPointers: number;
  is64: boolean;
  notes: string[];
  emittedTypes: number;
  emittedMethods: number;
  emittedFields: number;
}

interface Artifact {
  name: string;
  mime: string;
  url: string;
  preview: string;
  size: number;
  icon: React.ReactNode;
  color: string;
  kind: "code" | "json" | "bolt" | "py" | "sheet" | "zip";
}

export default function App() {
  const [metaFile, setMetaFile] = useState<File | null>(null);
  const [soFile, setSoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string>("");
  const [preview, setPreview] = useState<string>("");
  const [previewName, setPreviewName] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [options, setOptions] = useState<DumpOptions>(DEFAULT_OPTIONS);
  const [extras, setExtras] = useState<ExtrasOptions>(DEFAULT_EXTRAS);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const workerRef = useRef<Worker | null>(null);
  const artifactUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      revokeArtifactUrls();
    };
  }, []);

  const busy = status === "loading" || status === "parsing" || status === "generating";
  const canRun = !!(metaFile && soFile && !busy);

  const handleRun = async () => {
    if (!metaFile || !soFile) return;
    setError("");
    setLogs([]);
    revokeArtifactUrls();
    setArtifacts([]);
    setStats(null);
    setProgress(0);
    setStatus("loading");
    setProgressMsg("Reading files into memory...");
    try {
      const [metaBuf, soBuf] = await Promise.all([
        metaFile.arrayBuffer(),
        soFile.arrayBuffer(),
      ]);

      // Check magic numbers to prevent file selection mixups
      if (metaBuf.byteLength < 4 || new DataView(metaBuf).getUint32(0, true) !== 0xfab11baf) {
        throw new Error("Invalid 'global-metadata.dat' file (sanity check failed). Make sure you dropped the correct dat file.");
      }
      if (soBuf.byteLength < 4 || new DataView(soBuf).getUint32(0, true) !== 0x464c457f) {
        throw new Error("Invalid 'libil2cpp.so' file (ELF magic check failed). Make sure you dropped the correct .so binary.");
      }

      setStatus("parsing");
      setProgress(5);
      setProgressMsg("Starting background worker...");

      workerRef.current?.terminate();
      const worker = new DumpWorker();
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "progress") {
          setProgress(Math.min(100, Math.max(0, msg.pct ?? 0)));
          setProgressMsg(msg.message ?? "Working...");
          if ((msg.pct ?? 0) >= 55) setStatus("generating");
          return;
        }

        if (msg.type === "log") {
          setLogs((current) => [...current.slice(-80), msg.message]);
          return;
        }

        if (msg.type === "done") {
          const out: Artifact[] = msg.artifacts.map((artifact: {
            name: string;
            mime: string;
            blob: Blob;
            preview: string;
            size: number;
            color: string;
            kind: Artifact["kind"];
          }) => {
            const url = URL.createObjectURL(artifact.blob);
            artifactUrlsRef.current.push(url);
            return {
              name: artifact.name,
              mime: artifact.mime,
              url,
              preview: artifact.preview,
              size: artifact.size,
              color: artifact.color,
              kind: artifact.kind,
              icon: iconForKind(artifact.kind),
            };
          });
          setArtifacts(out);
          setPreview(out[0]?.preview ?? "");
          setPreviewName(out[0]?.name ?? "");
          setStats(msg.stats);
          setProgress(100);
          setProgressMsg("Done");
          setStatus("done");
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          return;
        }

        if (msg.type === "error") {
          setError(msg.error ?? "Unknown worker error");
          setStatus("error");
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        setError(event.message || "Background worker crashed");
        setStatus("error");
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };

      worker.postMessage({ metaBuf, soBuf, options, extras }, [metaBuf, soBuf]);
      setMetaFile(null);
      setSoFile(null);
      setLogs((current) => [...current, "Uploaded file references released from the browser UI."]);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? String(e));
      setStatus("error");
    }
  };

  const cancelRun = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setMetaFile(null);
    setSoFile(null);
    setStatus("idle");
    setProgress(0);
    setProgressMsg("Cancelled");
    setLogs((current) => [...current, "Cancelled. Input file references were cleared."]);
  };

  const revokeArtifactUrls = () => {
    artifactUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    artifactUrlsRef.current = [];
  };

  const deleteSessionData = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    revokeArtifactUrls();
    setMetaFile(null);
    setSoFile(null);
    setArtifacts([]);
    setStats(null);
    setPreview("");
    setPreviewName("");
    setError("");
    setProgress(0);
    setProgressMsg("Session data deleted");
    setLogs(["Session data deleted from this browser tab."]);
    setStatus("idle");
  };

  const download = (a: Artifact) => {
    const link = document.createElement("a");
    link.href = a.url;
    link.download = a.name;
    link.click();
  };

  const previewArtifact = (a: Artifact) => {
    setPreview(a.preview);
    setPreviewName(a.name);
  };

  const statCards = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "Metadata Ver.", value: `v${stats.metaVersion}` },
      { label: "Architecture", value: stats.is64 ? "64-bit" : "32-bit" },
      { label: "Types", value: stats.types.toLocaleString() },
      { label: "Methods", value: stats.methods.toLocaleString() },
      { label: "Fields", value: stats.fields.toLocaleString() },
      { label: "Assemblies", value: stats.images.toLocaleString() },
      { label: "Resolved RVAs", value: stats.resolvedPointers.toLocaleString() },
      { label: "Emitted Types", value: stats.emittedTypes.toLocaleString() },
    ];
  }, [stats]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Background gradient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-1/2 left-1/2 h-[800px] w-[1200px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[600px] w-[600px] rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="absolute top-1/3 left-0 h-[400px] w-[400px] rounded-full bg-fuchsia-600/10 blur-3xl" />
      </div>

      <div className="relative">
        {/* Header */}
        <header className="border-b border-slate-800/60 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/30">
                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 17l6-6-6-6" />
                  <path d="M12 19h8" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">IL2CPP Web Dumper</h1>
                <p className="text-xs text-slate-400">Generate <code className="text-violet-300">dump.cs</code> in your browser</p>
              </div>
            </div>
            <span className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-300 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-amber-400"}`} />
              {isOnline ? "online" : "offline"} ready
            </span>
          </div>
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-12 pb-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> 100% client-side, works online and offline
          </span>
          <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            Dump IL2CPP offsets <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">in seconds</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400">
            Drop your <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-slate-200">global-metadata.dat</code> and{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-slate-200">libil2cpp.so</code> to generate a complete{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-slate-200">dump.cs</code>, Frida hooks, IDA scripts, JSON or CSV.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-500">
            Privacy: input files are not stored. After processing starts, uploaded file references are cleared from the UI. Use Delete session data after downloading to revoke generated files from this browser tab.
          </p>
        </section>

        {/* Upload area */}
        <section className="mx-auto max-w-6xl px-6 py-8">
          <div className="grid gap-4 md:grid-cols-2">
            <FileDrop
              label="global-metadata.dat"
              hint="Drop or click. Found in /assets/bin/Data/Managed/Metadata/"
              accept=".dat"
              file={metaFile}
              onFile={setMetaFile}
              icon={
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h12l4 4v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" />
                  <path d="M14 4v6h6" />
                  <path d="M7 14h6M7 18h10" />
                </svg>
              }
            />
            <FileDrop
              label="libil2cpp.so"
              hint="Drop or click. Found in /lib/<arch>/ inside the APK"
              accept=".so"
              file={soFile}
              onFile={setSoFile}
              icon={
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7l9-4 9 4-9 4-9-4z" />
                  <path d="M3 12l9 4 9-4" />
                  <path d="M3 17l9 4 9-4" />
                </svg>
              }
            />
          </div>

          {/* Advanced options */}
          <div className="mt-4">
            <AdvancedOptions
              options={options}
              onChange={setOptions}
              extras={extras}
              onExtrasChange={setExtras}
            />
          </div>

          <div className="mt-6 flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleRun}
                disabled={!canRun}
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-3.5 font-semibold text-white shadow-lg shadow-violet-600/30 transition-all hover:shadow-xl hover:shadow-violet-600/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {busy ? (
                  <>
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M22 12a10 10 0 01-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Processing…
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                    Generate dump
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setOptions(DEFAULT_OPTIONS);
                  setExtras(DEFAULT_EXTRAS);
                }}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-5 py-3.5 text-sm font-medium text-slate-300 hover:border-slate-600 hover:text-slate-100 disabled:opacity-40"
              >
                Reset options
              </button>
            </div>

            {busy && (
              <div className="w-full max-w-2xl">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">{progressMsg}</p>
                <button
                  onClick={cancelRun}
                  className="mx-auto mt-3 block rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
                >
                  Cancel background job
                </button>
                {logs.length > 0 && (
                  <div className="mt-4 max-h-56 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-left font-mono text-xs leading-relaxed text-slate-300">
                    {logs.map((line, index) => (
                      <div key={`${line}-${index}`}>
                        <span className="text-emerald-400">{index === logs.length - 1 ? ">" : "✓"}</span> {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="w-full max-w-2xl rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                <div className="flex items-start gap-2">
                  <svg className="h-5 w-5 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <div>
                    <p className="font-semibold text-red-300">Failed to process files</p>
                    <p className="mt-1 break-words text-red-200/80">{error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Results */}
        {status === "done" && stats && (
          <section className="mx-auto max-w-6xl px-6 py-8">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold">Generated successfully</h3>
                    <p className="text-sm text-slate-400">{artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""} ready</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {artifacts.length > 0 && (
                    <button
                      onClick={() => download(artifacts.find((a) => a.kind === "zip") ?? artifacts[0])}
                      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-violet-600/30 hover:bg-violet-500"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                      </svg>
                      Download ZIP
                    </button>
                  )}
                  <button
                    onClick={deleteSessionData}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/20"
                  >
                    Delete session data
                  </button>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100/80">
                <p className="font-semibold text-emerald-300">Temporary processing policy</p>
                <p className="mt-1 text-xs text-emerald-100/70">
                  Your original files were released from the browser UI after processing started. Generated ZIP/object URLs remain only so you can download them. Click Delete session data after downloading to revoke them immediately.
                </p>
              </div>

              {/* Artifacts */}
              <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {artifacts.map((a) => (
                  <div
                    key={a.name}
                    className="group rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition-colors hover:border-slate-700"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${COLOR_CLASSES[a.color] ?? COLOR_CLASSES.violet}`}>
                        {a.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm font-semibold text-slate-100">{a.name}</p>
                        <p className="text-xs text-slate-500">{formatBytes(a.size)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => download(a)}
                        className="flex-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => previewArtifact(a)}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white"
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                {statCards.map((s) => (
                  <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                    <p className="text-xs uppercase tracking-wider text-slate-500">{s.label}</p>
                    <p className="mt-1 text-base font-bold text-slate-100">{s.value}</p>
                  </div>
                ))}
              </div>

              {stats.notes.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100/80">
                  <p className="mb-1 font-semibold text-amber-300">Analyzer notes</p>
                  <ul className="list-inside list-disc space-y-1 text-xs">
                    {stats.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview */}
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-300">
                    Preview: <span className="font-mono text-violet-300">{previewName}</span>
                  </h4>
                  <span className="text-xs text-slate-500">first 12 KB</span>
                </div>
                <pre className="max-h-96 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-300">
                  <code>{preview}</code>
                </pre>
              </div>
            </div>
          </section>
        )}

        {/* How-it-works */}
        <section className="mx-auto max-w-6xl px-6 py-12">
          <h3 className="mb-6 text-center text-2xl font-bold">How it works</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Extract files",
                body: "Unzip the APK. Grab global-metadata.dat from /assets/bin/Data/Managed/Metadata/ and libil2cpp.so from /lib/arm64-v8a/ (or your target arch).",
              },
              {
                step: "2",
                title: "Configure & parse",
                body: "Tweak advanced options — filter by namespace, change address format, pick output artifacts. Everything is parsed locally; nothing is uploaded.",
              },
              {
                step: "3",
                title: "Hook & mod",
                body: "Use generated dump.cs / hooks.js / ida_rename.py in your reverse-engineering workflow with Frida, IDA, Ghidra or your favorite hook framework.",
              },
            ].map((s) => (
              <div key={s.step} className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 font-bold text-violet-300">
                  {s.step}
                </div>
                <h4 className="font-semibold text-slate-100">{s.title}</h4>
                <p className="mt-2 text-sm text-slate-400">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-slate-800/60 py-8 text-center text-xs text-slate-500">
          <p>
            Educational tool. Only use on apps you own or have permission to analyze. Built with React + Vite.
          </p>
        </footer>
      </div>
    </div>
  );
}

const COLOR_CLASSES: Record<string, string> = {
  violet: "bg-violet-500/15 text-violet-300",
  amber: "bg-amber-500/15 text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  sky: "bg-sky-500/15 text-sky-300",
  rose: "bg-rose-500/15 text-rose-300",
};

function iconForKind(kind: Artifact["kind"]) {
  switch (kind) {
    case "zip": return <IconArchive />;
    case "json": return <IconJson />;
    case "bolt": return <IconBolt />;
    case "py": return <IconPy />;
    case "sheet": return <IconSheet />;
    case "code":
    default: return <IconCode />;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/* --- icons --- */
function IconCode() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16" />
    </svg>
  );
}
function IconJson() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H6a2 2 0 00-2 2v4a2 2 0 01-2 2 2 2 0 012 2v4a2 2 0 002 2h2" />
      <path d="M16 3h2a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2h-2" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function IconPy() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 8h5a3 3 0 013 3v0a3 3 0 01-3 3H8V8z" />
      <path d="M8 14v4" />
    </svg>
  );
}
function IconSheet() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v16H4z" />
      <path d="M10 4v4h4V4M10 12h4M10 16h4" />
    </svg>
  );
}
