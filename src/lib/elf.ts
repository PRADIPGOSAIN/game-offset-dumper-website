// Minimal ELF parser supporting ELF32 and ELF64 (used by libil2cpp.so)
import { BinaryReader } from "./binaryReader";

export interface ElfSection {
  name: string;
  type: number;
  flags: bigint;
  addr: bigint;
  offset: bigint;
  size: bigint;
  link: number;
  info: number;
  addralign: bigint;
  entsize: bigint;
}

export interface ElfSegment {
  type: number;
  flags: number;
  offset: bigint;
  vaddr: bigint;
  paddr: bigint;
  filesz: bigint;
  memsz: bigint;
  align: bigint;
}

export interface ElfSymbol {
  name: string;
  value: bigint;
  size: bigint;
  info: number;
  other: number;
  shndx: number;
}

export class ElfFile {
  reader: BinaryReader;
  is64: boolean = false;
  isLE: boolean = true;
  entry: bigint = 0n;
  phoff: bigint = 0n;
  shoff: bigint = 0n;
  phentsize: number = 0;
  phnum: number = 0;
  shentsize: number = 0;
  shnum: number = 0;
  shstrndx: number = 0;
  sections: ElfSection[] = [];
  segments: ElfSegment[] = [];
  symbols: ElfSymbol[] = [];
  dynSymbols: ElfSymbol[] = [];

  constructor(buf: ArrayBuffer) {
    this.reader = new BinaryReader(buf);
    this.parseHeader();
    this.parseSegments();
    this.parseSections();
    this.parseSymbols();
    this.applyRelocations();
  }

  private parseHeader() {
    const r = this.reader;
    const magic = r.readU32(0);
    if (magic !== 0x464c457f) throw new Error("Not an ELF file");
    this.is64 = r.readU8(4) === 2;
    this.isLE = r.readU8(5) === 1;
    if (!this.isLE) throw new Error("Big-endian ELF not supported");

    if (this.is64) {
      r.seek(0x18);
      this.entry = r.readU64();
      this.phoff = r.readU64();
      this.shoff = r.readU64();
      r.pos += 4; // flags
      r.pos += 2; // ehsize
      this.phentsize = r.readU16();
      this.phnum = r.readU16();
      this.shentsize = r.readU16();
      this.shnum = r.readU16();
      this.shstrndx = r.readU16();
    } else {
      r.seek(0x18);
      this.entry = BigInt(r.readU32());
      this.phoff = BigInt(r.readU32());
      this.shoff = BigInt(r.readU32());
      r.pos += 4; // flags
      r.pos += 2; // ehsize
      this.phentsize = r.readU16();
      this.phnum = r.readU16();
      this.shentsize = r.readU16();
      this.shnum = r.readU16();
      this.shstrndx = r.readU16();
    }
  }

  private parseSegments() {
    const r = this.reader;
    for (let i = 0; i < this.phnum; i++) {
      const off = Number(this.phoff) + i * this.phentsize;
      r.seek(off);
      if (this.is64) {
        const type = r.readU32();
        const flags = r.readU32();
        const offset = r.readU64();
        const vaddr = r.readU64();
        const paddr = r.readU64();
        const filesz = r.readU64();
        const memsz = r.readU64();
        const align = r.readU64();
        this.segments.push({ type, flags, offset, vaddr, paddr, filesz, memsz, align });
      } else {
        const type = r.readU32();
        const offset = BigInt(r.readU32());
        const vaddr = BigInt(r.readU32());
        const paddr = BigInt(r.readU32());
        const filesz = BigInt(r.readU32());
        const memsz = BigInt(r.readU32());
        const flags = r.readU32();
        const align = BigInt(r.readU32());
        this.segments.push({ type, flags, offset, vaddr, paddr, filesz, memsz, align });
      }
    }
  }

  private parseSections() {
    const r = this.reader;
    const rawSections: ElfSection[] = [];
    for (let i = 0; i < this.shnum; i++) {
      const off = Number(this.shoff) + i * this.shentsize;
      r.seek(off);
      const nameOff = r.readU32();
      const type = r.readU32();
      let flags: bigint, addr: bigint, offset: bigint, size: bigint;
      let link: number, info: number, addralign: bigint, entsize: bigint;
      if (this.is64) {
        flags = r.readU64();
        addr = r.readU64();
        offset = r.readU64();
        size = r.readU64();
        link = r.readU32();
        info = r.readU32();
        addralign = r.readU64();
        entsize = r.readU64();
      } else {
        flags = BigInt(r.readU32());
        addr = BigInt(r.readU32());
        offset = BigInt(r.readU32());
        size = BigInt(r.readU32());
        link = r.readU32();
        info = r.readU32();
        addralign = BigInt(r.readU32());
        entsize = BigInt(r.readU32());
      }
      rawSections.push({
        name: String(nameOff),
        type,
        flags,
        addr,
        offset,
        size,
        link,
        info,
        addralign,
        entsize,
      });
    }
    // resolve names from shstrtab
    if (this.shstrndx < rawSections.length) {
      const shstr = rawSections[this.shstrndx];
      for (const s of rawSections) {
        const nameOff = Number(s.name);
        s.name = r.readCString(Number(shstr.offset) + nameOff);
      }
    }
    this.sections = rawSections;
  }

  private parseSymbols() {
    const interesting = new Set([
      "g_CodeRegistration",
      "s_Il2CppCodeRegistration",
      "_g_CodeRegistration",
      "g_MetadataRegistration",
      "s_Il2CppMetadataRegistration"
    ]);

    for (const s of this.sections) {
      if (s.type === 2 || s.type === 11) {
        // SYMTAB=2, DYNSYM=11
        const strtab = this.sections[s.link];
        if (!strtab) continue;
        const entSize = Number(s.entsize) || (this.is64 ? 24 : 16);
        const count = Number(s.size) / entSize;
        const r = this.reader;
        const symList: ElfSymbol[] = [];
        for (let i = 0; i < count; i++) {
          const off = Number(s.offset) + i * entSize;
          r.seek(off);
          let nameIdx: number, value: bigint, size: bigint, info: number, other: number, shndx: number;
          if (this.is64) {
            nameIdx = r.readU32();
            info = r.readU8();
            other = r.readU8();
            shndx = r.readU16();
            value = r.readU64();
            size = r.readU64();
          } else {
            nameIdx = r.readU32();
            value = BigInt(r.readU32());
            size = BigInt(r.readU32());
            info = r.readU8();
            other = r.readU8();
            shndx = r.readU16();
          }
          const name = r.readCString(Number(strtab.offset) + nameIdx);
          if (interesting.has(name)) {
            symList.push({ name, value, size, info, other, shndx });
          }
        }
        if (s.type === 2) this.symbols.push(...symList);
        else this.dynSymbols.push(...symList);
      }
    }
  }

  // Convert virtual address (RVA) to file offset
  vaToOffset(va: bigint): number {
    for (const seg of this.segments) {
      if (seg.type !== 1) continue; // PT_LOAD
      if (va >= seg.vaddr && va < seg.vaddr + seg.memsz) {
        return Number(va - seg.vaddr + seg.offset);
      }
    }
    // Fallback: If it is a valid file offset within the buffer boundaries, use it directly
    if (va >= 0n && va < BigInt(this.reader.length)) {
      return Number(va);
    }
    return -1;
  }

  findSymbol(name: string): ElfSymbol | undefined {
    return (
      this.symbols.find((s) => s.name === name) ||
      this.dynSymbols.find((s) => s.name === name)
    );
  }

  // ---------------------------------------------------------------------------
  // Apply ELF RELA/REL relocations so that pointer fields in the buffer
  // contain real virtual addresses (mirrors Perfare's RelocationProcessing).
  // Without this, R_AARCH64_RELATIVE slots are 0 in the raw file, so the
  // pointer map built by Il2CppBinary finds no L2/L3 references.
  // ---------------------------------------------------------------------------
  private applyRelocations() {
    try {
      // Find PT_DYNAMIC segment
      const dynSeg = this.segments.find((s) => s.type === 2); // PT_DYNAMIC
      if (!dynSeg) return;

      const r = this.reader;
      const dynEntSize = this.is64 ? 16 : 8;
      const dynCount = Number(dynSeg.filesz) / dynEntSize;
      const dynOff = Number(dynSeg.offset);

      // Parse dynamic entries
      let relaVA = 0n, relaSz = 0n, relaEnt = 0n;
      let relVA = 0n, relSz = 0n, relEnt = 0n;
      let pltRelVA = 0n, pltRelSz = 0n, pltRelType = 0n;
      let symtabVA = 0n;

      for (let i = 0; i < dynCount; i++) {
        const off = dynOff + i * dynEntSize;
        const tag = this.is64 ? r.readU64(off) : BigInt(r.readU32(off));
        const val = this.is64 ? r.readU64(off + 8) : BigInt(r.readU32(off + 4));
        switch (tag) {
          case 7n:  relaVA  = val; break; // DT_RELA
          case 8n:  relaSz  = val; break; // DT_RELASZ
          case 9n:  relaEnt = val; break; // DT_RELAENT
          case 17n: relVA   = val; break; // DT_REL
          case 18n: relSz   = val; break; // DT_RELSZ
          case 19n: relEnt  = val; break; // DT_RELENT
          case 20n: pltRelType = val; break; // DT_PLTREL (7=RELA, 17=REL)
          case 23n: pltRelVA  = val; break; // DT_JMPREL
          case 2n:  pltRelSz  = val; break; // DT_PLTRELSZ
          case 6n:  symtabVA  = val; break; // DT_SYMTAB
        }
      }

      // Helper: read symbol value by index from dynamic symbol table
      const symEntSize = this.is64 ? 24 : 16;
      const getSymValue = (idx: number): bigint => {
        if (symtabVA === 0n || idx === 0) return 0n;
        const off = this.vaToOffset(symtabVA + BigInt(idx * symEntSize));
        if (off < 0) return 0n;
        return this.is64 ? r.readU64(off + 8) : BigInt(r.readU32(off + 4));
      };

      // Apply RELA entries (64-bit: each entry is 24 bytes)
      if (relaVA !== 0n && relaSz !== 0n) {
        const entSize = relaEnt !== 0n ? Number(relaEnt) : 24;
        const count = Number(relaSz) / entSize;
        const baseOff = this.vaToOffset(relaVA);
        if (baseOff > 0) {
          this.applyRelaTable(baseOff, count, entSize, getSymValue);
        }
      }

      // Apply PLT RELA/REL entries
      if (pltRelVA !== 0n && pltRelSz !== 0n) {
        const isPltRela = pltRelType === 7n;
        const entSize = isPltRela ? 24 : 16;
        const count = Number(pltRelSz) / entSize;
        const baseOff = this.vaToOffset(pltRelVA);
        if (baseOff > 0) {
          if (isPltRela) {
            this.applyRelaTable(baseOff, count, entSize, getSymValue);
          }
        }
      }

      // Apply REL entries (32-bit ARM: each entry is 8 bytes)
      if (relVA !== 0n && relSz !== 0n) {
        const entSize = relEnt !== 0n ? Number(relEnt) : 8;
        const count = Number(relSz) / entSize;
        const baseOff = this.vaToOffset(relVA);
        if (baseOff > 0) {
          this.applyRelTable(baseOff, count, entSize, getSymValue);
        }
      }
    } catch {
      // Relocation errors are non-fatal; best-effort
    }
  }

  private applyRelaTable(
    baseOff: number, count: number, entSize: number,
    getSymValue: (idx: number) => bigint
  ) {
    const r = this.reader;
    // ARM64 relocation types
    const R_AARCH64_ABS64    = 257n;
    const R_AARCH64_RELATIVE = 1027n;
    const R_X86_64_64        = 1n;
    const R_X86_64_RELATIVE  = 8n;

    for (let i = 0; i < count; i++) {
      const off = baseOff + i * entSize;
      if (off + 24 > r.length) break;
      const rOffset  = r.readU64(off);
      const rInfo    = r.readU64(off + 8);
      const rAddend  = r.readI64(off + 16);
      const rType    = rInfo & 0xFFFFFFFFn;
      const rSym     = Number(rInfo >> 32n);

      const fileOff = this.vaToOffset(rOffset);
      if (fileOff < 0 || fileOff + 8 > r.length) continue;

      if (rType === R_AARCH64_RELATIVE || rType === R_X86_64_RELATIVE) {
        // value = addend (which is already the target VA)
        r.writeU64(fileOff, BigInt.asUintN(64, rAddend));
      } else if (rType === R_AARCH64_ABS64 || rType === R_X86_64_64) {
        const symVal = getSymValue(rSym);
        if (symVal !== 0n) {
          r.writeU64(fileOff, symVal + BigInt.asUintN(64, rAddend));
        }
      }
    }
  }

  private applyRelTable(
    baseOff: number, count: number, entSize: number,
    getSymValue: (idx: number) => bigint
  ) {
    const r = this.reader;
    const R_ARM_RELATIVE = 23;
    const R_ARM_ABS32    = 2;

    for (let i = 0; i < count; i++) {
      const off = baseOff + i * entSize;
      if (off + 8 > r.length) break;
      const rOffset = r.readU32(off);
      const rInfo   = r.readU32(off + 4);
      const rType   = rInfo & 0xFF;
      const rSym    = rInfo >>> 8;

      const fileOff = this.vaToOffset(BigInt(rOffset));
      if (fileOff < 0 || fileOff + 4 > r.length) continue;

      if (rType === R_ARM_RELATIVE) {
        // For REL, addend is the value already in the slot
        const existing = r.readU32(fileOff);
        if (existing !== 0) {
          r.writeU32(fileOff, existing); // already correct VA
        }
      } else if (rType === R_ARM_ABS32) {
        const symVal = Number(getSymValue(rSym));
        if (symVal !== 0) {
          const existing = r.readU32(fileOff);
          r.writeU32(fileOff, (symVal + existing) >>> 0);
        }
      }
    }
  }
}
