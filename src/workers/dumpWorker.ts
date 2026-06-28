import { Metadata } from "../lib/metadata";
import { ElfFile } from "../lib/elf";
import { Il2CppBinary } from "../lib/il2cpp";
import JSZip from "jszip";
import {
  generateCsv,
  generateDump,
  generateFridaScript,
  generateIdaScript,
  generateScript,
  type DumpOptions,
} from "../lib/dumper";

interface ExtrasOptions {
  generateScript: boolean;
  generateFrida: boolean;
  generateIda: boolean;
  generateCsv: boolean;
  fridaLib: string;
  fridaMaxHooks: number;
  fridaTypeFilter: string;
  fridaMethodFilter: string;
}

interface WorkerArtifact {
  name: string;
  mime: string;
  blob: Blob;
  preview: string;
  size: number;
  color: string;
  kind: "code" | "json" | "bolt" | "py" | "sheet" | "zip";
}

function makeArtifact(
  name: string,
  mime: string,
  content: BlobPart | BlobPart[],
  color: string,
  kind: WorkerArtifact["kind"],
  previewOverride?: string
): WorkerArtifact {
  const parts = Array.isArray(content) ? content : [content];
  const blob = new Blob(parts, { type: mime });
  return {
    name,
    mime,
    blob,
    preview: previewOverride ?? (typeof content === "string" ? content.slice(0, 12000) : "Preview unavailable for this generated file."),
    size: blob.size,
    color,
    kind,
  };
}

let lastProgressAt = 0;

function progress(message: string, pct: number) {
  const now = Date.now();
  if (now - lastProgressAt < 80 && pct < 100) return;
  lastProgressAt = now;
  self.postMessage({ type: "progress", message, pct });
}

function log(message: string) {
  self.postMessage({ type: "log", message });
}

self.onmessage = async (event: MessageEvent) => {
  const { metaBuf, soBuf, options, extras } = event.data as {
    metaBuf: ArrayBuffer;
    soBuf: ArrayBuffer;
    options: DumpOptions;
    extras: ExtrasOptions;
  };

  try {
    log("Starting Il2CppDumper...");
    log("Initializing metadata...");
    progress("Initializing metadata...", 10);
    await tick();
    const metadata = new Metadata(metaBuf);
    log(`Metadata Version: ${metadata.version}`);

    log("Initializing il2cpp file...");
    progress("Initializing il2cpp file in background...", 28);
    await tick();
    const elf = new ElfFile(soBuf);
    log(`${elf.is64 ? "ELF64" : "ELF32"} (Android/Linux)`);
    log("Applying relocations...");
    log(`Il2Cpp Version: ${metadata.version}`);

    log("Searching...");
    progress("Searching for registration data...", 46);
    await tick();
    const bin = new Il2CppBinary(elf, metadata);

    let manualCodeReg: bigint | undefined;
    let manualMetaReg: bigint | undefined;
    if (options.manualCodeRegistrationVA) {
      try {
        const cleaned = options.manualCodeRegistrationVA.trim();
        manualCodeReg = cleaned.startsWith("0x") || cleaned.startsWith("0X")
          ? BigInt(cleaned)
          : BigInt(cleaned);
      } catch (e) {
        log(`Warning: Failed to parse manual CodeRegistration address: ${options.manualCodeRegistrationVA}`);
      }
    }
    if (options.manualMetadataRegistrationVA) {
      try {
        const cleaned = options.manualMetadataRegistrationVA.trim();
        manualMetaReg = cleaned.startsWith("0x") || cleaned.startsWith("0X")
          ? BigInt(cleaned)
          : BigInt(cleaned);
      } catch (e) {
        log(`Warning: Failed to parse manual MetadataRegistration address: ${options.manualMetadataRegistrationVA}`);
      }
    }

    bin.resolve(manualCodeReg, manualMetaReg);
    // Print all internal heuristic notes to the live log
    for (const note of bin.notes) log(`NOTE: ${note}`);
    if (bin.codeRegistrationVA !== 0n) log(`CodeRegistration : ${bin.codeRegistrationVA.toString(16)}`);
    else log("CodeRegistration : not found in exported symbols or heuristics");
    if (bin.metadataRegistrationVA !== 0n) log(`MetadataRegistration : ${bin.metadataRegistrationVA.toString(16)}`);
    else log("MetadataRegistration : not found in exported symbols or heuristics");

    log("Dumping...");
    progress("Dumping metadata...", 60);
    await tick();
    const dump = await generateDump(metadata, bin, options, (msg, pct) => {
      progress(msg, 60 + ((pct ?? 0) / 100) * 28);
    });

    const artifacts: WorkerArtifact[] = [
      makeArtifact("dump.cs", "text/plain", dump.text, "violet", "code", dump.preview),
    ];
    log("Done!");

    if (extras.generateScript) {
      log("Generate script.json...");
      progress("Generating script.json...", 90);
      await tick();
      const content = generateScript(metadata, bin);
      artifacts.push(makeArtifact("script.json", "application/json", content, "amber", "json"));
      log("Done!");
    }

    if (extras.generateFrida) {
      log("Generate Frida hooks...");
      progress("Generating Frida hooks.js...", 93);
      await tick();
      const content = generateFridaScript(metadata, bin, {
        libName: extras.fridaLib,
        maxHooks: extras.fridaMaxHooks,
        typeFilter: extras.fridaTypeFilter || undefined,
        methodFilter: extras.fridaMethodFilter || undefined,
      });
      artifacts.push(makeArtifact("hooks.js", "text/javascript", content, "emerald", "bolt"));
      log("Done!");
    }

    if (extras.generateIda) {
      log("Generate IDA rename script...");
      progress("Generating IDA rename script...", 96);
      await tick();
      const content = generateIdaScript(metadata, bin);
      artifacts.push(makeArtifact("ida_rename.py", "text/x-python", content, "sky", "py"));
      log("Done!");
    }

    if (extras.generateCsv) {
      log("Generate CSV...");
      progress("Generating methods.csv...", 96);
      await tick();
      const content = generateCsv(metadata, bin);
      artifacts.push(makeArtifact("methods.csv", "text/csv", content, "rose", "sheet"));
      log("Done!");
    }

    let zipArtifact: WorkerArtifact | null = null;
    try {
      log("Creating zip archive...");
      progress("Creating ZIP archive...", 98);
      const zip = new JSZip();
      for (const artifact of artifacts) {
        zip.file(artifact.name, artifact.blob);
      }
      zip.file("analysis-log.txt", [
        "Generated by IL2CPP Web Dumper",
        `Metadata Version: ${metadata.version}`,
        `Architecture: ${elf.is64 ? "ELF64" : "ELF32"}`,
        `Types: ${metadata.types.length}`,
        `Methods: ${metadata.methods.length}`,
        `Fields: ${metadata.fields.length}`,
        `Resolved method pointers: ${bin.methodPointers.length}`,
        ...bin.notes.map((note) => `NOTE: ${note}`),
        "",
      ].join("\n"));
      
      const compression = extras.compressZip ? "DEFLATE" : "STORE";
      const compressionOptions = extras.compressZip ? { level: 3 } : undefined;
      const zipBlob = await zip.generateAsync({ type: "blob", compression, compressionOptions });
      
      zipArtifact = {
        name: "il2cpp-dump.zip",
        mime: "application/zip",
        blob: zipBlob,
        preview: "ZIP archive contains the generated dump files. Use Download ZIP to save it to your system.",
        size: zipBlob.size,
        color: "emerald",
        kind: "zip",
      };
      log(`Zip created (${(zipBlob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (zipErr: any) {
      log(`Warning: Failed to create ZIP archive: ${zipErr?.message ?? String(zipErr)}. Individual files are still available for download.`);
    }

    progress("Done", 100);
    self.postMessage({
      type: "done",
      artifacts: zipArtifact ? [zipArtifact, ...artifacts] : artifacts,
      stats: {
        metaVersion: metadata.version,
        types: metadata.types.length,
        methods: metadata.methods.length,
        fields: metadata.fields.length,
        images: metadata.images.length,
        resolvedPointers: bin.methodPointers.length,
        is64: elf.is64,
        notes: bin.notes,
        emittedTypes: dump.emittedTypes,
        emittedMethods: dump.emittedMethods,
        emittedFields: dump.emittedFields,
      },
    });
  } catch (error: any) {
    self.postMessage({ type: "error", error: error?.message ?? String(error) });
  }
};

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}