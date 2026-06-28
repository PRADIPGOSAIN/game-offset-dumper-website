import fs from "fs";
import { Metadata } from "../src/lib/metadata";
import { ElfFile } from "../src/lib/elf";
import { Il2CppBinary } from "../src/lib/il2cpp";
import { generateDump } from "../src/lib/dumper";

async function main() {
  console.log("Loading files...");
  const t0 = Date.now();
  const metaBuf = fs.readFileSync("/home/pradip/Videos/Screencasts/global-metadata.dat").buffer;
  const soBuf = fs.readFileSync("/home/pradip/Videos/Screencasts/libil2cpp.so").buffer;
  console.log(`Files loaded in ${Date.now() - t0}ms`);

  console.log("Initializing metadata...");
  const t1 = Date.now();
  const metadata = new Metadata(metaBuf);
  console.log(`Metadata initialized in ${Date.now() - t1}ms (version ${metadata.version})`);

  console.log("Initializing ELF...");
  const t2 = Date.now();
  const elf = new ElfFile(soBuf);
  console.log(`ELF initialized in ${Date.now() - t2}ms`);

  console.log("Resolving IL2CPP binary...");
  const t3 = Date.now();
  const bin = new Il2CppBinary(elf, metadata);
  bin.resolve();
  console.log(`IL2CPP resolved in ${Date.now() - t3}ms`);
  for (const note of bin.notes) {
    console.log(`  NOTE: ${note}`);
  }

  console.log("Generating dump...");
  const t4 = Date.now();
  const dump = await generateDump(metadata, bin, {
    projectName: "Test",
    packageName: "test.pack",
    gameVersion: "1.0",
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
    sortMode: "metadata-order"
  }, (msg, pct) => {
    console.log(`  Progress: ${msg} (${pct?.toFixed(1)}%)`);
  });
  console.log(`Dump generated in ${Date.now() - t4}ms`);
  console.log(`Stats: Types=${dump.emittedTypes}, Methods=${dump.emittedMethods}, Fields=${dump.emittedFields}`);
}

main().catch(console.error);
