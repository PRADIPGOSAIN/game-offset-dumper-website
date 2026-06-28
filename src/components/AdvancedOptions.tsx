import { useState } from "react";
import type { DumpOptions, SortMode, AccessFilter } from "../lib/dumper";
import { cn } from "../utils/cn";

interface Props {
  options: DumpOptions;
  onChange: (next: DumpOptions) => void;
  extras: ExtrasOptions;
  onExtrasChange: (next: ExtrasOptions) => void;
}

export interface ExtrasOptions {
  generateScript: boolean;
  generateFrida: boolean;
  generateIda: boolean;
  generateCsv: boolean;
  compressZip: boolean;
  fridaLib: string;
  fridaMaxHooks: number;
  fridaTypeFilter: string;
  fridaMethodFilter: string;
}

export const DEFAULT_EXTRAS: ExtrasOptions = {
  generateScript: false,
  generateFrida: false,
  generateIda: false,
  generateCsv: false,
  compressZip: false, // Default to STORE (no compression) for memory safety on large games
  fridaLib: "libil2cpp.so",
  fridaMaxHooks: 100,
  fridaTypeFilter: "",
  fridaMethodFilter: "",
};

export function AdvancedOptions({ options, onChange, extras, onExtrasChange }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"project" | "scope" | "offsets" | "outputs">("scope");

  const set = <K extends keyof DumpOptions>(k: K, v: DumpOptions[K]) =>
    onChange({ ...options, [k]: v });
  const setX = <K extends keyof ExtrasOptions>(k: K, v: ExtrasOptions[K]) =>
    onExtrasChange({ ...extras, [k]: v });

  const applyPreset = (preset: "full" | "game" | "resolved" | "public") => {
    if (preset === "full") {
      onChange({ ...options, namespaceFilter: "", typeFilter: "", methodFilter: "", excludeSystem: false, includeUnresolvedMethods: true, accessFilter: "all" });
    }
    if (preset === "game") {
      onChange({ ...options, excludeSystem: true, includeUnresolvedMethods: true, accessFilter: "all" });
    }
    if (preset === "resolved") {
      onChange({ ...options, excludeSystem: true, includeUnresolvedMethods: false, accessFilter: "all", sortMode: "by-rva" });
    }
    if (preset === "public") {
      onChange({ ...options, excludeSystem: true, includeUnresolvedMethods: false, accessFilter: "public-only" });
    }
  };

  const activeFilters = [
    options.namespaceFilter && "namespace",
    options.typeFilter && "type",
    options.methodFilter && "method",
    options.excludeSystem && "game-only",
    options.accessFilter !== "all" && options.accessFilter,
    !options.includeUnresolvedMethods && "resolved-only",
    (options.manualCodeRegistrationVA || options.manualMetadataRegistrationVA) && "manual-offsets",
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M7 12h10M10 17h4" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-slate-100">Useful options</p>
            <p className="text-xs text-slate-400">
              {activeFilters.length > 0
                ? `${activeFilters.length} active filter${activeFilters.length > 1 ? "s" : ""} | ${options.sortMode}`
                : `${options.sortMode} | no filters`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeFilters.slice(0, 3).map((f) => (
            <span key={f} className="hidden rounded-md bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-300 sm:inline">
              {f}
            </span>
          ))}
          <svg
            className={cn("h-5 w-5 text-slate-400 transition-transform", open && "rotate-180")}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800">
          <div className="flex flex-wrap gap-1 border-b border-slate-800 px-3 pt-3">
            {([
              ["scope", "Scope & Filters"],
              ["offsets", "Manual Offsets"],
              ["project", "Project Notes"],
              ["outputs", "Outputs"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                  tab === k ? "bg-slate-950 text-violet-300" : "text-slate-400 hover:text-slate-200"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-6 p-5">
            {tab === "scope" && (
              <>
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-200">Quick presets</p>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <PresetButton label="Full dump" desc="Everything" onClick={() => applyPreset("full")} />
                    <PresetButton label="Game only" desc="Skip Unity/System" onClick={() => applyPreset("game")} />
                    <PresetButton label="Resolved hooks" desc="Only methods with RVA" onClick={() => applyPreset("resolved")} />
                    <PresetButton label="Public API" desc="Public resolved only" onClick={() => applyPreset("public")} />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Namespace contains / regex" hint="Example: ^Game|Combat|Player">
                    <Input value={options.namespaceFilter} onChange={(v) => set("namespaceFilter", v)} placeholder="Game|Player|Weapon" />
                  </Field>
                  <Field label="Type name contains / regex" hint="Example: Player|Weapon|Enemy">
                    <Input value={options.typeFilter} onChange={(v) => set("typeFilter", v)} placeholder="Player|Weapon" />
                  </Field>
                  <Field label="Method name contains / regex" hint="Example: Update|Damage|Health">
                    <Input value={options.methodFilter} onChange={(v) => set("methodFilter", v)} placeholder="Update|Damage|Health" />
                  </Field>
                  <Field label="Sort dump by" hint="RVA sorting is useful when pasting offsets into hook code">
                    <Select
                      value={options.sortMode}
                      onChange={(v) => set("sortMode", v as SortMode)}
                      options={[
                        ["metadata-order", "Metadata order"],
                        ["alphabetical", "Alphabetical"],
                        ["by-rva", "RVA order"],
                        ["by-size", "Largest classes first"],
                      ]}
                    />
                  </Field>
                  <Field label="Access level" hint="Use public-only for cleaner API-style dumps">
                    <Select
                      value={options.accessFilter}
                      onChange={(v) => set("accessFilter", v as AccessFilter)}
                      options={[
                        ["all", "All methods"],
                        ["non-private", "Hide private"],
                        ["public-only", "Public only"],
                      ]}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="Exclude engine/system namespaces" desc="Skip common System, Unity, Microsoft, Mono namespaces" value={options.excludeSystem} onChange={(v) => set("excludeSystem", v)} />
                  <Toggle label="Only resolved methods" desc="Hide methods where RVA could not be found" value={!options.includeUnresolvedMethods} onChange={(v) => set("includeUnresolvedMethods", !v)} />
                  <Toggle label="Include fields" desc="Keep class field declarations" value={options.includeFields} onChange={(v) => set("includeFields", v)} />
                  <Toggle label="Include methods" desc="Keep method declarations and RVA comments" value={options.includeMethods} onChange={(v) => set("includeMethods", v)} />
                  <Toggle label="Show file offset" desc="Include physical offset in libil2cpp.so beside each RVA" value={options.includeFileOffset} onChange={(v) => set("includeFileOffset", v)} />
                  <Toggle label="Show metadata tokens" desc="Useful for matching methods in other IL2CPP tools" value={options.includeTokens} onChange={(v) => set("includeTokens", v)} />
                  <Toggle label="Show vtable slot" desc="Useful for virtual method hooks" value={options.includeSlot} onChange={(v) => set("includeSlot", v)} />
                  <Toggle label="Show TypeDefIndex" desc="Useful for comparing multiple dumps" value={options.includeTypeDefIndex} onChange={(v) => set("includeTypeDefIndex", v)} />
                </div>
              </>
            )}

            {tab === "offsets" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm text-violet-200">
                  <p className="font-semibold text-violet-300">Stripped / Protected Games</p>
                  <p className="mt-1 text-xs text-slate-300">
                    If the game has stripped symbols and standard heuristics fail, you can manually supply the registration addresses below (as seen in IDA/Ghidra).
                    You can input them as hexadecimal strings (e.g. <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">0x7B12C0</code>) or decimal numbers.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="CodeRegistration VA or File Offset" hint="Value of g_CodeRegistration or s_Il2CppCodeRegistration">
                    <Input value={options.manualCodeRegistrationVA} onChange={(v) => set("manualCodeRegistrationVA", v)} placeholder="e.g. 0x7B12C0" />
                  </Field>
                  <Field label="MetadataRegistration VA or File Offset" hint="Value of g_MetadataRegistration or s_Il2CppMetadataRegistration">
                    <Input value={options.manualMetadataRegistrationVA} onChange={(v) => set("manualMetadataRegistrationVA", v)} placeholder="e.g. 0x7B5E20" />
                  </Field>
                </div>
              </div>
            )}

            {tab === "project" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Game / project name" hint="Printed in dump.cs header">
                  <Input value={options.projectName} onChange={(v) => set("projectName", v)} placeholder="My Unity Game" />
                </Field>
                <Field label="Package name" hint="Example: com.company.game">
                  <Input value={options.packageName} onChange={(v) => set("packageName", v)} placeholder="com.company.game" />
                </Field>
                <Field label="Game version" hint="Useful when keeping multiple dumps">
                  <Input value={options.gameVersion} onChange={(v) => set("gameVersion", v)} placeholder="1.2.3" />
                </Field>
                <Field label="Analyst notes" hint="Short note printed into generated files">
                  <Input value={options.analystNotes} onChange={(v) => set("analystNotes", v)} placeholder="arm64-v8a, clean APK" />
                </Field>
              </div>
            )}

            {tab === "outputs" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="script.json" desc="Method to RVA map for hook tooling" value={extras.generateScript} onChange={(v) => setX("generateScript", v)} />
                  <Toggle label="Frida hooks.js" desc="Interceptor.attach template for resolved methods" value={extras.generateFrida} onChange={(v) => setX("generateFrida", v)} />
                  <Toggle label="IDA rename script" desc="Python script to name functions in IDA" value={extras.generateIda} onChange={(v) => setX("generateIda", v)} />
                  <Toggle label="methods.csv" desc="Spreadsheet export for filtering offsets" value={extras.generateCsv} onChange={(v) => setX("generateCsv", v)} />
                  <Toggle label="Compress ZIP file" desc="Saves download size but consumes significant memory (disable for 100MB+ games)" value={extras.compressZip} onChange={(v) => setX("compressZip", v)} />
                </div>

                {extras.generateFrida && (
                  <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Frida settings</p>
                    <Field label="Library name" hint="Used by Module.findBaseAddress()">
                      <Input value={extras.fridaLib} onChange={(v) => setX("fridaLib", v)} />
                    </Field>
                    <Field label="Max hooks" hint="Keep this low if the game crashes on too many hooks">
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={extras.fridaMaxHooks}
                        onChange={(e) => setX("fridaMaxHooks", Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
                      />
                    </Field>
                    <Field label="Frida type filter" hint="Only hook classes matching this regex">
                      <Input value={extras.fridaTypeFilter} onChange={(v) => setX("fridaTypeFilter", v)} placeholder="Player|Weapon" />
                    </Field>
                    <Field label="Frida method filter" hint="Only hook methods matching this regex">
                      <Input value={extras.fridaMethodFilter} onChange={(v) => setX("fridaMethodFilter", v)} placeholder="Update|Damage" />
                    </Field>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-200">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
    />
  );
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function PresetButton({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-left transition-colors hover:border-violet-500/50 hover:bg-violet-500/5">
      <p className="text-sm font-semibold text-slate-100">{label}</p>
      <p className="text-xs text-slate-500">{desc}</p>
    </button>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", value ? "border-violet-500/40 bg-violet-500/5" : "border-slate-800 bg-slate-950/50 hover:border-slate-700")}>
      <button type="button" onClick={() => onChange(!value)} className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", value ? "bg-violet-500" : "bg-slate-700")}>
        <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", value ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-100">{label}</p>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
    </label>
  );
}