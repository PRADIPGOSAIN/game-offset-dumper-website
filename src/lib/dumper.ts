// Generates a dump.cs from the parsed metadata and IL2CPP binary
import { Il2CppBinary } from "./il2cpp";
import { Metadata } from "./metadata";

const TYPE_ATTR_VISIBILITY_MASK = 0x00000007;
const TYPE_ATTR_NOT_PUBLIC = 0x0;
const TYPE_ATTR_PUBLIC = 0x1;
const TYPE_ATTR_NESTED_PUBLIC = 0x2;
const TYPE_ATTR_NESTED_PRIVATE = 0x3;
const TYPE_ATTR_NESTED_FAMILY = 0x4;
const TYPE_ATTR_NESTED_ASSEMBLY = 0x5;
const TYPE_ATTR_INTERFACE = 0x20;
const TYPE_ATTR_ABSTRACT = 0x80;
const TYPE_ATTR_SEALED = 0x100;

const METHOD_ATTR_MEMBER_ACCESS_MASK = 0x0007;
const METHOD_ATTR_PRIVATE = 0x1;
const METHOD_ATTR_FAMILY = 0x4;
const METHOD_ATTR_ASSEMBLY = 0x3;
const METHOD_ATTR_PUBLIC = 0x6;
const METHOD_ATTR_STATIC = 0x10;
const METHOD_ATTR_VIRTUAL = 0x40;
const METHOD_ATTR_ABSTRACT = 0x400;

const FIELD_ATTR_PRIVATE = 0x1;
const FIELD_ATTR_FAMILY = 0x4;
const FIELD_ATTR_PUBLIC = 0x6;
// (FIELD_ATTR_STATIC/INIT_ONLY/LITERAL reserved for future use)

function typeVisibility(flags: number): string {
  const v = flags & TYPE_ATTR_VISIBILITY_MASK;
  switch (v) {
    case TYPE_ATTR_PUBLIC:
    case TYPE_ATTR_NESTED_PUBLIC:
      return "public";
    case TYPE_ATTR_NESTED_PRIVATE:
      return "private";
    case TYPE_ATTR_NESTED_FAMILY:
      return "protected";
    case TYPE_ATTR_NESTED_ASSEMBLY:
      return "internal";
    case TYPE_ATTR_NOT_PUBLIC:
    default:
      return "internal";
  }
}

function methodAccess(flags: number): string {
  const a = flags & METHOD_ATTR_MEMBER_ACCESS_MASK;
  switch (a) {
    case METHOD_ATTR_PUBLIC: return "public";
    case METHOD_ATTR_PRIVATE: return "private";
    case METHOD_ATTR_FAMILY: return "protected";
    case METHOD_ATTR_ASSEMBLY: return "internal";
    default: return "private";
  }
}

function fieldAccess(flags: number): string {
  const a = flags & 0x7;
  switch (a) {
    case FIELD_ATTR_PUBLIC: return "public";
    case FIELD_ATTR_PRIVATE: return "private";
    case FIELD_ATTR_FAMILY: return "protected";
    default: return "private";
  }
}

export type SortMode = "metadata-order" | "alphabetical" | "by-rva" | "by-size";
export type AccessFilter = "all" | "public-only" | "non-private";

export interface DumpOptions {
  // Project info added to dump header for easier file tracking.
  projectName: string;
  packageName: string;
  gameVersion: string;
  analystNotes: string;
  // Manual offsets (useful when symbols are stripped and heuristics fail)
  manualCodeRegistrationVA: string;
  manualMetadataRegistrationVA: string;
  // Useful dump details
  includeFileOffset: boolean;
  includeTokens: boolean;
  includeSlot: boolean;
  includeTypeDefIndex: boolean;
  // Filtering
  includeFields: boolean;
  includeMethods: boolean;
  includeUnresolvedMethods: boolean;  // methods with RVA 0
  accessFilter: AccessFilter;
  namespaceFilter: string;            // regex (case-insensitive) or empty
  typeFilter: string;                 // regex (case-insensitive) or empty
  methodFilter: string;               // regex (case-insensitive) or empty
  excludeSystem: boolean;             // skip System.* / Unity.* / Microsoft.* / Mono.*
  // Sorting
  sortMode: SortMode;
}

export const DEFAULT_OPTIONS: DumpOptions = {
  projectName: "",
  packageName: "",
  gameVersion: "",
  analystNotes: "",
  manualCodeRegistrationVA: "",
  manualMetadataRegistrationVA: "",
  includeFileOffset: true,
  includeTokens: true,
  includeSlot: true,
  includeTypeDefIndex: true,
  includeFields: true,
  includeMethods: true,
  includeUnresolvedMethods: true,
  accessFilter: "all",
  namespaceFilter: "",
  typeFilter: "",
  methodFilter: "",
  excludeSystem: false,
  sortMode: "metadata-order",
};

const addrCache = new Map<bigint, string>();
function formatAddr(addr: bigint): string {
  const cached = addrCache.get(addr);
  if (cached !== undefined) return cached;
  const s = `0x${addr.toString(16).toUpperCase()}`;
  addrCache.set(addr, s);
  return s;
}

function buildRegex(pat: string): RegExp | null {
  if (!pat.trim()) return null;
  try { return new RegExp(pat, "i"); } catch { return null; }
}

const SYSTEM_PREFIXES = ["System", "Unity", "UnityEngine", "Microsoft", "Mono", "Internal", "MS"];

function isSystemNamespace(ns: string): boolean {
  if (!ns) return false;
  return SYSTEM_PREFIXES.some((p) => ns === p || ns.startsWith(p + "."));
}

export interface DumpProgress {
  (msg: string, pct?: number): void;
}

export interface DumpResult {
  text: BlobPart[];
  preview: string;
  emittedTypes: number;
  emittedMethods: number;
  emittedFields: number;
  resolvedRvaCount: number;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function generateDump(
  metadata: Metadata,
  binary: Il2CppBinary,
  options: DumpOptions = DEFAULT_OPTIONS,
  onProgress?: DumpProgress
): Promise<DumpResult> {
  addrCache.clear(); // Clear cache on new run to prevent memory growth
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: string[] = [];
  let currentChunk = "";
  let preview = "";
  const lines = {
    push: (item: string) => {
      const line = item + "\n";
      if (preview.length < 12000) preview += line.slice(0, 12000 - preview.length);
      currentChunk += line;
      if (currentChunk.length > 200000) { // ~200KB chunks
        chunks.push(currentChunk);
        currentChunk = "";
      }
    },
  };
  const flush = () => {
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
  };
  const totalTypes = metadata.types.length;

  const nsRegex = buildRegex(opts.namespaceFilter);
  const tyRegex = buildRegex(opts.typeFilter);
  const methodRegex = buildRegex(opts.methodFilter);

  let emittedTypes = 0;
  let emittedMethods = 0;
  let emittedFields = 0;
  let resolvedRva = 0;

  lines.push(`// Generated by IL2CPP Web Dumper`);
  if (opts.projectName) lines.push(`// Project: ${opts.projectName}`);
  if (opts.packageName) lines.push(`// Package: ${opts.packageName}`);
  if (opts.gameVersion) lines.push(`// Game version: ${opts.gameVersion}`);
  if (opts.analystNotes) lines.push(`// Notes: ${opts.analystNotes.replace(/\r?\n/g, " | ")}`);
  lines.push(`// Metadata version: ${metadata.version}`);
  lines.push(`// Total types: ${totalTypes} | methods: ${metadata.methods.length} | fields: ${metadata.fields.length}`);
  lines.push(`// Resolved method pointers: ${binary.methodPointers.length}`);
  lines.push(`// Options: sort=${opts.sortMode} access=${opts.accessFilter}` +
    `${opts.excludeSystem ? " excludeSystem" : ""}` +
    `${opts.namespaceFilter ? ` ns~/${opts.namespaceFilter}/` : ""}` +
    `${opts.typeFilter ? ` ty~/${opts.typeFilter}/` : ""}` +
    `${opts.methodFilter ? ` method~/${opts.methodFilter}/` : ""}`);
  for (const n of binary.notes) lines.push(`// NOTE: ${n}`);
  lines.push("");

  // Map type -> image
  const typeToImage = new Map<number, number>();
  for (let i = 0; i < metadata.images.length; i++) {
    const img = metadata.images[i];
    for (let t = img.typeStart; t < img.typeStart + img.typeCount; t++) {
      typeToImage.set(t, i);
    }
  }

  // Build an order array
  let order = Array.from({ length: totalTypes }, (_, i) => i);
  if (opts.sortMode === "alphabetical") {
    order.sort((a, b) => {
      const an = metadata.readString(metadata.types[a].nameIndex);
      const bn = metadata.readString(metadata.types[b].nameIndex);
      const ans = metadata.readString(metadata.types[a].namespaceIndex);
      const bns = metadata.readString(metadata.types[b].namespaceIndex);
      const sa = `${ans}.${an}`.toLowerCase();
      const sb = `${bns}.${bn}`.toLowerCase();
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  } else if (opts.sortMode === "by-size") {
    order.sort((a, b) => metadata.types[b].methodCount + metadata.types[b].fieldCount -
                         (metadata.types[a].methodCount + metadata.types[a].fieldCount));
  } else if (opts.sortMode === "by-rva") {
    // sort types by min RVA of their methods
    const minRva = new Map<number, bigint>();
    for (let i = 0; i < totalTypes; i++) {
      const t = metadata.types[i];
      let m = -1n;
      for (let mi = t.methodStart; mi < t.methodStart + t.methodCount; mi++) {
        const rva = binary.getMethodRva(mi);
        if (rva !== 0n && (m === -1n || rva < m)) m = rva;
      }
      minRva.set(i, m === -1n ? 0xFFFFFFFFFFFFFFFFn : m);
    }
    order.sort((a, b) => {
      const da = minRva.get(a)!;
      const db = minRva.get(b)!;
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  const TAB = "\t";
  const pushBlank = () => lines.push("");

  let lastImage = -1;
  let lastNs = "__none__";
  let nsOpen = false;

  for (let idx = 0; idx < order.length; idx++) {
    const ti = order[idx];
    const t = metadata.types[ti];
    const name = metadata.readString(t.nameIndex);
    const ns = metadata.readString(t.namespaceIndex);

    // Filters
    if (opts.excludeSystem && isSystemNamespace(ns)) continue;
    if (nsRegex && !nsRegex.test(ns)) continue;
    if (tyRegex && !tyRegex.test(name)) continue;

    const imgIdx = typeToImage.get(ti) ?? -1;
    if (opts.sortMode === "metadata-order" && imgIdx !== lastImage) {
      if (nsOpen) { lines.push(`}`); nsOpen = false; lastNs = "__none__"; }
      lastImage = imgIdx;
      pushBlank();
      const img = metadata.images[imgIdx];
      lines.push(`// =================================================================`);
      lines.push(`// Image: ${img ? metadata.readString(img.nameIndex) : "<unknown>"}`);
      lines.push(`// =================================================================`);
    }

    // Namespace block management
    if (ns !== lastNs) {
      if (nsOpen) { lines.push(`}`); nsOpen = false; }
      if (ns) { lines.push(`namespace ${ns} {`); nsOpen = true; }
      lastNs = ns;
    }

    // Type header
    const vis = typeVisibility(t.flags);
    const isInterface = (t.flags & TYPE_ATTR_INTERFACE) !== 0;
    const isAbstract = (t.flags & TYPE_ATTR_ABSTRACT) !== 0;
    const isSealed = (t.flags & TYPE_ATTR_SEALED) !== 0;
    let kind: string;
    if (isInterface) kind = "interface";
    else if (isAbstract && isSealed) kind = "static class";
    else if (isAbstract) kind = "abstract class";
    else if (isSealed) kind = "sealed class";
    else kind = "class";

    lines.push(`// Namespace: ${ns}`);
    if (opts.includeTypeDefIndex) lines.push(`// TypeDefIndex: ${ti}`);
    const headerExtras = opts.includeTypeDefIndex ? ` // TypeDefIndex: ${ti}` : "";
    lines.push(`${vis} ${kind} ${name}${headerExtras}`);
    lines.push(`{`);

    emittedTypes++;

    // Fields
    if (opts.includeFields && t.fieldCount > 0 && t.fieldStart >= 0) {
      lines.push(`${TAB}// Fields`);
      for (let f = t.fieldStart; f < t.fieldStart + t.fieldCount; f++) {
        if (f >= metadata.fields.length) break;
        const fd = metadata.fields[f];
        const fname = metadata.readString(fd.nameIndex);
        const tok = opts.includeTokens ? ` // 0x${fd.token.toString(16)}` : "";
        lines.push(`${TAB}${fieldAccess(0)} object ${fname};${tok}`);
        emittedFields++;
      }
      pushBlank();
    }

    // Methods
    if (opts.includeMethods && t.methodCount > 0 && t.methodStart >= 0) {
      lines.push(`${TAB}// Methods`);
      // Optionally sort methods inside a type by RVA
      let methodOrder: number[] = [];
      for (let m = t.methodStart; m < t.methodStart + t.methodCount; m++) methodOrder.push(m);
      if (opts.sortMode === "by-rva") {
        methodOrder.sort((a, b) => {
          const ra = binary.getMethodRva(a);
          const rb = binary.getMethodRva(b);
          if (ra === 0n && rb === 0n) return a - b;
          if (ra === 0n) return 1;
          if (rb === 0n) return -1;
          return ra < rb ? -1 : ra > rb ? 1 : 0;
        });
      } else if (opts.sortMode === "alphabetical") {
        methodOrder.sort((a, b) => {
          const fnA = metadata.readString(metadata.methods[a].nameIndex);
          const fnB = metadata.readString(metadata.methods[b].nameIndex);
          return fnA < fnB ? -1 : fnA > fnB ? 1 : 0;
        });
      }

      for (const m of methodOrder) {
        if (m >= metadata.methods.length) break;
        const md = metadata.methods[m];
        const mname = metadata.readString(md.nameIndex);
        const access = methodAccess(md.flags);
        if (methodRegex && !methodRegex.test(mname)) continue;

        // Access filter
        if (opts.accessFilter === "public-only" && access !== "public") continue;
        if (opts.accessFilter === "non-private" && access === "private") continue;

        const isStatic = (md.flags & METHOD_ATTR_STATIC) !== 0;
        const isAbs = (md.flags & METHOD_ATTR_ABSTRACT) !== 0;
        const isVirt = (md.flags & METHOD_ATTR_VIRTUAL) !== 0;

        let paramsStr = "";
        if (md.parameterCount > 0) {
          const params: string[] = [];
          for (let p = md.parameterStart; p < md.parameterStart + md.parameterCount; p++) {
            if (p < 0 || p >= metadata.parameters.length) break;
            const pd = metadata.parameters[p];
            params.push("object " + metadata.readString(pd.nameIndex));
          }
          paramsStr = params.join(", ");
        }

        const rva = binary.getMethodRva(m);
        const hasRva = rva !== 0n;
        if (!hasRva && !opts.includeUnresolvedMethods) continue;
        if (hasRva) resolvedRva++;

        const rvaStr = hasRva
          ? formatAddr(rva)
          : "0xFFFFFFFFFFFFFFFF";
        const fileOff = hasRva ? binary.elf.vaToOffset(rva) : -1;
        const fileOffStr = fileOff > 0
          ? formatAddr(BigInt(fileOff))
          : "-1";

        let mods = access;
        if (isStatic) mods += " static";
        if (isAbs) mods += " abstract";
        else if (isVirt) mods += " virtual";

        let parts = "RVA: " + rvaStr;
        if (opts.includeFileOffset) parts += " Offset: " + fileOffStr;
        parts += " VA: " + rvaStr;
        if (opts.includeSlot && md.slot !== 0xffff) parts += " Slot: " + md.slot;

        lines.push(TAB + "// " + parts);
        const tok = opts.includeTokens ? " // 0x" + md.token.toString(16) : "";
        lines.push(TAB + mods + " object " + mname + "(" + paramsStr + ");" + tok);
        lines.push("");
        emittedMethods++;
      }
    }

    lines.push(`}`);
    pushBlank();

    if (idx % 2000 === 0) {
      if (onProgress) {
        onProgress(`Processed ${idx}/${order.length} types`, (idx / order.length) * 100);
      }
      await tick();
    }
  }

  if (nsOpen) lines.push(`}`);

  onProgress?.("Dump generation complete", 100);
  flush();
  return {
    text: chunks,
    preview,
    emittedTypes,
    emittedMethods,
    emittedFields,
    resolvedRvaCount: resolvedRva,
  };
}

// ---------- script.json ----------
export function generateScript(
  metadata: Metadata,
  binary: Il2CppBinary,
  opts: { onlyResolved?: boolean } = {}
): string {
  const entries: any[] = [];
  for (let ti = 0; ti < metadata.types.length; ti++) {
    const t = metadata.types[ti];
    const typeName = `${metadata.readString(t.namespaceIndex)}.${metadata.readString(t.nameIndex)}`;
    for (let m = t.methodStart; m < t.methodStart + t.methodCount; m++) {
      if (m < 0 || m >= metadata.methods.length) break;
      const md = metadata.methods[m];
      const rva = binary.getMethodRva(m);
      if (opts.onlyResolved !== false && rva === 0n) continue;
      const off = binary.elf.vaToOffset(rva);
      entries.push({
        name: `${typeName}::${metadata.readString(md.nameIndex)}`,
        rva: `0x${rva.toString(16).toUpperCase()}`,
        offset: off > 0 ? `0x${off.toString(16).toUpperCase()}` : "-1",
        methodIndex: m,
        typeName,
      });
    }
  }
  return JSON.stringify({ ScriptMethod: entries }, null, 2);
}

// ---------- Frida hook template ----------
export function generateFridaScript(
  metadata: Metadata,
  binary: Il2CppBinary,
  opts: { libName?: string; maxHooks?: number; typeFilter?: string; methodFilter?: string } = {}
): string {
  const libName = opts.libName ?? "libil2cpp.so";
  const maxHooks = opts.maxHooks ?? 100;
  const re = opts.typeFilter ? buildRegex(opts.typeFilter) : null;
  const methodRe = opts.methodFilter ? buildRegex(opts.methodFilter) : null;

  const lines: string[] = [];
  lines.push(`/*`);
  lines.push(` * Auto-generated Frida hook template`);
  lines.push(` * Target library: ${libName}`);
  lines.push(` * Usage: frida -U -f <package> -l hooks.js --no-pause`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`const LIB = "${libName}";`);
  lines.push(`const base = Module.findBaseAddress(LIB);`);
  lines.push(`console.log("[+] " + LIB + " base = " + base);`);
  lines.push(``);
  lines.push(`function hookAt(rva, name) {`);
  lines.push(`    const addr = base.add(rva);`);
  lines.push(`    Interceptor.attach(addr, {`);
  lines.push(`        onEnter(args) { console.log("[->] " + name + " @ " + addr); },`);
  lines.push(`        onLeave(retval) { /* console.log("[<-] " + name); */ }`);
  lines.push(`    });`);
  lines.push(`}`);
  lines.push(``);

  let count = 0;
  for (let ti = 0; ti < metadata.types.length && count < maxHooks; ti++) {
    const t = metadata.types[ti];
    const name = metadata.readString(t.nameIndex);
    if (re && !re.test(name)) continue;
    const ns = metadata.readString(t.namespaceIndex);
    for (let m = t.methodStart; m < t.methodStart + t.methodCount && count < maxHooks; m++) {
      if (m < 0 || m >= metadata.methods.length) break;
      const md = metadata.methods[m];
      const methodName = metadata.readString(md.nameIndex);
      if (methodRe && !methodRe.test(methodName)) continue;
      const rva = binary.getMethodRva(m);
      if (rva === 0n) continue;
      const fq = `${ns ? ns + "." : ""}${name}::${methodName}`;
      lines.push(`hookAt(ptr("0x${rva.toString(16).toUpperCase()}"), ${JSON.stringify(fq)});`);
      count++;
    }
  }
  lines.push(``);
  lines.push(`console.log("[+] ${count} hooks installed");`);
  return lines.join("\n");
}

// ---------- IDA Python script (rename functions) ----------
export function generateIdaScript(
  metadata: Metadata,
  binary: Il2CppBinary
): string {
  const lines: string[] = [];
  lines.push(`# IL2CPP function renamer for IDA Pro`);
  lines.push(`# Run inside IDA: File -> Script file...`);
  lines.push(`import idaapi, idc, ida_name`);
  lines.push(``);
  lines.push(`def set_name(ea, name):`);
  lines.push(`    safe = "".join(c if c.isalnum() or c=='_' else '_' for c in name)`);
  lines.push(`    ida_name.set_name(ea, safe, ida_name.SN_NOWARN | ida_name.SN_FORCE)`);
  lines.push(``);
  lines.push(`base = idaapi.get_imagebase()`);
  lines.push(`print("[+] image base = 0x%X" % base)`);
  lines.push(``);

  let count = 0;
  for (let ti = 0; ti < metadata.types.length; ti++) {
    const t = metadata.types[ti];
    const tn = metadata.readString(t.nameIndex);
    for (let m = t.methodStart; m < t.methodStart + t.methodCount; m++) {
      if (m < 0 || m >= metadata.methods.length) break;
      const md = metadata.methods[m];
      const rva = binary.getMethodRva(m);
      if (rva === 0n) continue;
      const fq = `${tn}_${metadata.readString(md.nameIndex)}_${m}`;
      lines.push(`set_name(base + 0x${rva.toString(16).toUpperCase()}, ${JSON.stringify(fq)})`);
      count++;
    }
  }
  lines.push(``);
  lines.push(`print("[+] renamed ${count} functions")`);
  return lines.join("\n");
}

// ---------- CSV export ----------
export function generateCsv(metadata: Metadata, binary: Il2CppBinary): string {
  const rows: string[] = ["TypeDefIndex,Namespace,TypeName,MethodIndex,MethodName,RVA,FileOffset,Token,Slot,ParamCount"];
  for (let ti = 0; ti < metadata.types.length; ti++) {
    const t = metadata.types[ti];
    const tn = metadata.readString(t.nameIndex);
    const ns = metadata.readString(t.namespaceIndex);
    for (let m = t.methodStart; m < t.methodStart + t.methodCount; m++) {
      if (m < 0 || m >= metadata.methods.length) break;
      const md = metadata.methods[m];
      const rva = binary.getMethodRva(m);
      const off = rva !== 0n ? binary.elf.vaToOffset(rva) : -1;
      const mn = metadata.readString(md.nameIndex).replace(/,/g, "_");
      rows.push(
        `${ti},${ns},${tn.replace(/,/g, "_")},${m},${mn},` +
        `0x${rva.toString(16).toUpperCase()},${off > 0 ? "0x" + off.toString(16).toUpperCase() : "-1"},` +
        `0x${md.token.toString(16)},${md.slot},${md.parameterCount}`
      );
    }
  }
  return rows.join("\n");
}
