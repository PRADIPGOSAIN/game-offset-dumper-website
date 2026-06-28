// IL2CPP binary analysis - faithful TypeScript port of Perfare's Il2CppDumper
// https://github.com/Perfare/Il2CppDumper
import { ElfFile } from "./elf";
import { Metadata } from "./metadata";

export class Il2CppBinary {
  elf: ElfFile;
  metadata: Metadata;
  methodPointers: BigInt64Array = new BigInt64Array(0);
  codeRegistrationVA: bigint = 0n;
  metadataRegistrationVA: bigint = 0n;
  resolved: boolean = false;
  notes: string[] = [];
  private sortedValues: BigInt64Array = new BigInt64Array(0);
  private sortedAddrs: BigInt64Array = new BigInt64Array(0);

  // Cached segment lists (mirrors Perfare's exec/data/bss separation)
  private execSegs: { offset: number; offsetEnd: number; address: bigint; addressEnd: bigint }[] = [];
  private dataSegs: { offset: number; offsetEnd: number; address: bigint; addressEnd: bigint }[] = [];

  constructor(elf: ElfFile, metadata: Metadata) {
    this.elf = elf;
    this.metadata = metadata;
    this.buildSegmentLists();
  }

  // ---------------------------------------------------------------------------
  // Segment classification (mirrors Elf64.GetSectionHelper)
  // ---------------------------------------------------------------------------
  private buildSegmentLists() {
    for (const seg of this.elf.segments) {
      if (seg.type !== 1 || seg.memsz === 0n) continue;
      const entry = {
        offset: Number(seg.offset),
        offsetEnd: Number(seg.offset + seg.filesz),
        address: seg.vaddr,
        addressEnd: seg.vaddr + seg.memsz,
      };
      // PF_X=1, also 3 and 5 and 7 have exec bit
      if ((seg.flags & 1) !== 0) {
        this.execSegs.push(entry);
      } else {
        // PF_W|PF_R = 2,4,6 → data
        this.dataSegs.push(entry);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------
  resolve(manualCodeReg?: bigint, manualMetaReg?: bigint) {
    if (manualCodeReg) {
      this.codeRegistrationVA = manualCodeReg;
      this.notes.push(`Using manual CodeRegistration: 0x${manualCodeReg.toString(16)}`);
      this.readCodeRegistration(manualCodeReg);
      this.resolved = true;
      if (manualMetaReg) {
        this.metadataRegistrationVA = manualMetaReg;
        this.notes.push(`Using manual MetadataRegistration: 0x${manualMetaReg.toString(16)}`);
      }
      return;
    }

    // --- Symbol search (mirrors Elf64.SymbolSearch) ---
    const codeRegSym =
      this.elf.findSymbol("g_CodeRegistration") ||
      this.elf.findSymbol("s_Il2CppCodeRegistration") ||
      this.elf.findSymbol("_g_CodeRegistration");
    const metaRegSym =
      this.elf.findSymbol("g_MetadataRegistration") ||
      this.elf.findSymbol("s_Il2CppMetadataRegistration");

    if (codeRegSym && metaRegSym) {
      this.notes.push(`Symbol: CodeRegistration at 0x${codeRegSym.value.toString(16)}`);
      this.notes.push(`Symbol: MetadataRegistration at 0x${metaRegSym.value.toString(16)}`);
      this.codeRegistrationVA = codeRegSym.value;
      this.metadataRegistrationVA = metaRegSym.value;
      this.readCodeRegistration(codeRegSym.value);
      this.resolved = true;
      return;
    }

    // --- PlusSearch (mirrors Elf64.PlusSearch) ---
    this.notes.push("Symbols not found. Running PlusSearch heuristics (Perfare port)...");
    try {
      this.buildBinarySearchMap();
      const codeReg = this.findCodeRegistration();
      const metaReg = this.findMetadataRegistration();

      if (codeReg !== 0n) {
        // Apply version adjustments (mirrors AutoPlusInit)
        const adjusted = this.applyVersionAdjustment(codeReg);
        this.codeRegistrationVA = adjusted;
        this.notes.push(`PlusSearch: CodeRegistration at 0x${adjusted.toString(16)}`);
        this.readCodeRegistration(adjusted);
        this.resolved = true;
      }
      if (metaReg !== 0n) {
        this.metadataRegistrationVA = metaReg;
        this.notes.push(`PlusSearch: MetadataRegistration at 0x${metaReg.toString(16)}`);
      }
    } catch { /* ignored */ } finally {
      this.sortedValues = new BigInt64Array(0);
      this.sortedAddrs = new BigInt64Array(0);
    }

    if (!this.resolved) {
      this.notes.push(
        "CodeRegistration not found. Enter addresses manually in Advanced Options → Manual Offsets."
      );
    }
  }

  // ---------------------------------------------------------------------------
  // FindCodeRegistration — mirrors SectionHelper.FindCodeRegistration()
  // ---------------------------------------------------------------------------
  private findCodeRegistration(): bigint {
    const ver = this.metadata.version;
    if (ver >= 24.2) {
      // For ELF: try exec first, then data (mirrors the ElfBase branch)
      let result = this.findCodeRegistration2019(this.execSegs, "exec");
      if (result !== 0n) return result;
      result = this.findCodeRegistration2019(this.dataSegs, "data");
      return result;
    }
    return this.findCodeRegistrationOld();
  }

  // FindMetadataRegistration — mirrors SectionHelper.FindMetadataRegistration()
  private findMetadataRegistration(): bigint {
    const ver = this.metadata.version;
    if (ver < 19) return 0n;
    if (ver >= 27) return this.findMetadataRegistrationV21();
    return this.findMetadataRegistrationOld();
  }

  // ---------------------------------------------------------------------------
  // FindCodeRegistration2019 — exact port of SectionHelper.FindCodeRegistration2019
  // Searches for "mscorlib.dll\0" bytes in given segments, then does 3-level
  // pointer chasing to locate codeGenModules array, then backs up to struct start.
  // ---------------------------------------------------------------------------
  private findCodeRegistration2019(
    segs: { offset: number; offsetEnd: number; address: bigint; addressEnd: bigint }[],
    label: string
  ): bigint {
    const ptrSize = this.elf.is64 ? 8 : 4;
    const r = this.elf.reader;
    const ver = this.metadata.version;
    const imageCount = this.metadata.images.length;

    // featureBytes = "mscorlib.dll\0"
    const featureBytes = [0x6D, 0x73, 0x63, 0x6F, 0x72, 0x6C, 0x69, 0x62, 0x2E, 0x64, 0x6C, 0x6C, 0x00];
    const buf = r.buf;

    let stringsFound = 0;
    let refsL1Found = 0;
    let refsL2Found = 0;
    let refsL3Found = 0;

    for (const sec of segs) {
      const limit = Math.min(sec.offsetEnd, buf.length) - featureBytes.length;
      for (let i = sec.offset; i <= limit; i++) {
        if (buf[i] !== 0x6D) continue;
        let match = true;
        for (let j = 1; j < featureBytes.length; j++) {
          if (buf[i + j] !== featureBytes[j]) { match = false; break; }
        }
        if (!match) continue;

        stringsFound++;
        const dllva = sec.address + BigInt(i - sec.offset);
        const l1refs = this.findReference(dllva);
        refsL1Found += l1refs.length;

        for (const refva of l1refs) {
          const l2refs = this.findReference(refva);
          refsL2Found += l2refs.length;

          for (const refva2 of l2refs) {
            if (ver >= 27) {
              for (let idx = imageCount - 1; idx >= 0; idx--) {
                const targetVa = refva2 - BigInt(idx * ptrSize);
                const l3refs = this.findReference(targetVa);
                refsL3Found += l3refs.length;
                for (const refva3 of l3refs) {
                  const checkOff = this.elf.vaToOffset(refva3 - BigInt(ptrSize));
                  if (checkOff > 0) {
                    const checkVal = this.elf.is64 ? r.readU64(checkOff) : BigInt(r.readU32(checkOff));
                    if (Number(checkVal) === imageCount) {
                      const backOffset = ver >= 29 ? BigInt(ptrSize * 14) : BigInt(ptrSize * 13);
                      const result = refva3 - backOffset;
                      this.notes.push(`[${label}] mscorlib found. L1=${refsL1Found} L2=${refsL2Found} L3=${refsL3Found}. codeReg=0x${result.toString(16)}`);
                      return result;
                    }
                  }
                }
              }
            } else {
              for (let idx = 0; idx < imageCount; idx++) {
                const targetVa = refva2 - BigInt(idx * ptrSize);
                for (const refva3 of this.findReference(targetVa)) {
                  const result = refva3 - BigInt(ptrSize * 13);
                  this.notes.push(`[${label}] mscorlib found (old). codeReg=0x${result.toString(16)}`);
                  return result;
                }
              }
            }
          }
        }
      }
    }

    this.notes.push(`[${label}] Search done: strings=${stringsFound} L1refs=${refsL1Found} L2refs=${refsL2Found} L3refs=${refsL3Found} imageCount=${imageCount} ver=${ver}`);
    return 0n;
  }

  // ---------------------------------------------------------------------------
  // FindCodeRegistrationOld — mirrors SectionHelper.FindCodeRegistrationOld
  // Searches data sections for [methodCount][ptr-to-code-array] pattern.
  // ---------------------------------------------------------------------------
  private findCodeRegistrationOld(): bigint {
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readPtr = (p: number) => (this.elf.is64 ? r.readU64(p) : BigInt(r.readU32(p)));
    const readIntPtr = (p: number) =>
      this.elf.is64 ? Number(r.readI64(p)) : r.readI32(p);
    const methodCount = this.metadata.methods.length;

    for (const sec of this.dataSegs) {
      for (let pos = sec.offset; pos < sec.offsetEnd - ptrSize; pos += ptrSize) {
        if (readIntPtr(pos) !== methodCount) continue;
        try {
          const ptrVa = readPtr(pos + ptrSize);
          const ptrOff = this.elf.vaToOffset(ptrVa);
          if (ptrOff <= 0) continue;
          // Verify: pointer to data range (not checking exec here like Perfare since we skip first check)
          const firstFnPtr = readPtr(ptrOff);
          if (this.isExecVA(firstFnPtr) || firstFnPtr === 0n) {
            return sec.address + BigInt(pos - sec.offset);
          }
        } catch { /* ignored */ }
      }
    }
    return 0n;
  }

  // ---------------------------------------------------------------------------
  // FindMetadataRegistrationV21 — mirrors SectionHelper.FindMetadataRegistrationV21
  // Looks for two consecutive ptr-size values both equal to typeDefinitionsCount,
  // followed by a pointer into data, followed by a pointer array into data/exec.
  // ---------------------------------------------------------------------------
  private findMetadataRegistrationV21(): bigint {
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readPtr = (p: number) => (this.elf.is64 ? r.readU64(p) : BigInt(r.readU32(p)));
    const readIntPtr = (p: number) =>
      this.elf.is64 ? Number(r.readI64(p)) : r.readI32(p);
    const typeCount = this.metadata.types.length;

    for (const sec of this.dataSegs) {
      const end = Math.min(sec.offsetEnd, r.length) - ptrSize * 3;
      for (let pos = sec.offset; pos < end; pos += ptrSize) {
        // First occurrence of typeCount (fieldOffsetsCount)
        if (readIntPtr(pos) !== typeCount) continue;
        // Second occurrence of typeCount (typeDefinitionsSizesCount) at pos + ptrSize * 2
        if (readIntPtr(pos + ptrSize * 2) !== typeCount) continue;
        try {
          // Pointer to typeDefinitionsSizes at pos + ptrSize * 3
          const ptrVa = readPtr(pos + ptrSize * 3);
          const ptrOff = this.elf.vaToOffset(ptrVa);
          if (ptrOff <= 0) continue;
          // Read the array of type pointers and verify they're in data/exec
          const firstTypePtr = readPtr(ptrOff);
          if (this.isDataVA(firstTypePtr) || this.isExecVA(firstTypePtr)) {
            // Back up 10 ptrSize fields to start of Il2CppMetadataRegistration
            return sec.address + BigInt(pos - sec.offset) - BigInt(ptrSize * 10);
          }
        } catch { /* ignored */ }
      }
    }
    return 0n;
  }

  // ---------------------------------------------------------------------------
  // FindMetadataRegistrationOld (pre-v27)
  // ---------------------------------------------------------------------------
  private findMetadataRegistrationOld(): bigint {
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readPtr = (p: number) => (this.elf.is64 ? r.readU64(p) : BigInt(r.readU32(p)));
    const readIntPtr = (p: number) =>
      this.elf.is64 ? Number(r.readI64(p)) : r.readI32(p);
    const typeCount = this.metadata.types.length;

    for (const sec of this.dataSegs) {
      const end = Math.min(sec.offsetEnd, r.length) - ptrSize;
      for (let pos = sec.offset; pos < end; pos += ptrSize) {
        if (readIntPtr(pos) !== typeCount) continue;
        try {
          const ptrVa = readPtr(pos + ptrSize * 3);
          const ptrOff = this.elf.vaToOffset(ptrVa);
          if (ptrOff <= 0) continue;
          const firstPtr = readPtr(ptrOff);
          if (this.isDataVA(firstPtr)) {
            return sec.address + BigInt(pos - sec.offset) - BigInt(ptrSize * 12);
          }
        } catch { /* ignored */ }
      }
    }
    return 0n;
  }

  // ---------------------------------------------------------------------------
  // Version adjustment — mirrors Il2Cpp.AutoPlusInit version correction logic
  // ---------------------------------------------------------------------------
  private applyVersionAdjustment(codeReg: bigint): bigint {
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readU64 = (va: bigint) => {
      const off = this.elf.vaToOffset(va);
      return off > 0 ? r.readU64(off) : 0n;
    };
    const limit = 0x50000n;
    const ver = this.metadata.version;

    // Read genericMethodPointersCount (field 2 in v24.2+: field 0=reversePInvokeWrapperCount, field 1=reversePInvokeWrappers, field 2=genericMethodPointersCount)
    const genericMethodPointersCount = readU64(codeReg + BigInt(ptrSize * 2));

    if (ver === 31) {
      if (genericMethodPointersCount > limit) {
        this.notes.push("v31: adjusting codeReg by -2 ptrSize");
        return codeReg - BigInt(ptrSize * 2);
      }
    }
    if (ver === 29) {
      if (genericMethodPointersCount > limit) {
        this.notes.push("v29→29.1: adjusting codeReg by -2 ptrSize");
        return codeReg - BigInt(ptrSize * 2);
      }
    }
    if (ver === 27) {
      const reversePInvokeWrapperCount = readU64(codeReg);
      if (reversePInvokeWrapperCount > limit) {
        this.notes.push("v27→27.1: adjusting codeReg by -1 ptrSize");
        return codeReg - BigInt(ptrSize);
      }
    }
    if (ver === 24.4) {
      this.notes.push("v24.4: adjusting codeReg by -2 ptrSize");
      return codeReg - BigInt(ptrSize * 2);
    }
    return codeReg;
  }

  private buildBinarySearchMap() {
    const r = this.elf.reader;
    const view = (r as any).view as DataView;
    const ptrSize = this.elf.is64 ? 8 : 4;

    const values: bigint[] = [];
    const addrs: bigint[] = [];
    for (const sec of this.dataSegs) {
      const end = Math.min(sec.offsetEnd, r.length) - ptrSize;
      for (let pos = sec.offset; pos <= end; pos += ptrSize) {
        const val = this.elf.is64
          ? view.getBigUint64(pos, true)
          : BigInt(view.getUint32(pos, true));
        values.push(val);
        addrs.push(sec.address + BigInt(pos - sec.offset));
      }
    }

    const indices = new Int32Array(values.length);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    indices.sort((a, b) => {
      const diff = values[a] - values[b];
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    });

    this.sortedValues = new BigInt64Array(values.length);
    this.sortedAddrs = new BigInt64Array(values.length);
    for (let i = 0; i < indices.length; i++) {
      this.sortedValues[i] = values[indices[i]];
      this.sortedAddrs[i] = addrs[indices[i]];
    }
  }

  private findReference(addr: bigint): bigint[] {
    const refs: bigint[] = [];
    let low = 0;
    let high = this.sortedValues.length - 1;
    let matchIdx = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const val = this.sortedValues[mid];
      if (val === addr) {
        matchIdx = mid;
        break;
      } else if (val < addr) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (matchIdx !== -1) {
      let idx = matchIdx;
      while (idx >= 0 && this.sortedValues[idx] === addr) {
        refs.push(this.sortedAddrs[idx]);
        idx--;
      }
      idx = matchIdx + 1;
      while (idx < this.sortedValues.length && this.sortedValues[idx] === addr) {
        refs.push(this.sortedAddrs[idx]);
        idx++;
      }
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // VA range checks (mirrors CheckPointerRange*)
  // ---------------------------------------------------------------------------
  private isExecVA(va: bigint): boolean {
    for (const seg of this.execSegs) {
      if (va >= seg.address && va < seg.addressEnd) return true;
    }
    return false;
  }

  private isDataVA(va: bigint): boolean {
    for (const seg of this.dataSegs) {
      if (va >= seg.address && va < seg.addressEnd) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Read CodeRegistration struct and extract method pointers
  // Mirrors Il2Cpp.Init — handles both old (methodPointers[]) and new (codeGenModules) layout
  // ---------------------------------------------------------------------------
  private readCodeRegistration(va: bigint) {
    const off = this.elf.vaToOffset(va);
    if (off < 0) {
      this.notes.push(`CodeRegistration VA 0x${va.toString(16)} not in file.`);
      return;
    }
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readPtr = (p: number) => (this.elf.is64 ? r.readU64(p) : BigInt(r.readU32(p)));
    const ver = this.metadata.version;

    if (ver >= 24.2) {
      // Layout (v24.2+): search for (codeGenModulesCount, codeGenModules) pair
      // We step by ptrSize instead of ptrSize * 2 to handle mixed single-pointers and pairs in CodeRegistration
      const imageCount = this.metadata.images.length;
      let cursor = off;
      for (let i = 0; i < 30; i++) {
        const cnt = this.elf.is64 ? Number(r.readU64(cursor)) : r.readU32(cursor);
        const ptrVa = readPtr(cursor + ptrSize);
        if (cnt === imageCount && imageCount > 0 && cnt < 2000) {
          const ptrOff = this.elf.vaToOffset(ptrVa);
          if (ptrOff > 0) {
            const firstModPtr = readPtr(ptrOff);
            if (this.elf.vaToOffset(firstModPtr) > 0) {
              this.notes.push(`Found ${cnt} codeGenModules`);
              this.readCodeGenModules(ptrVa, cnt);
              return;
            }
          }
        }
        cursor += ptrSize;
      }
      this.notes.push("Could not find codeGenModules in CodeRegistration.");
    } else {
      // Old layout: methodPointersCount, methodPointers
      const cnt = this.elf.is64 ? Number(r.readU64(off)) : r.readU32(off);
      const ptrVa = readPtr(off + ptrSize);
      const ptrOff = this.elf.vaToOffset(ptrVa);
      if (cnt > 0 && cnt < 5_000_000 && ptrOff > 0) {
        this.readMethodPointerTable(ptrOff, cnt);
      }
    }
  }

  private readCodeGenModules(va: bigint, count: number) {
    const baseOff = this.elf.vaToOffset(va);
    if (baseOff < 0) return;
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readPtr = (p: number) => (this.elf.is64 ? r.readU64(p) : BigInt(r.readU32(p)));

    const allPointers: bigint[] = [];
    for (let i = 0; i < count; i++) {
      const modPtr = readPtr(baseOff + i * ptrSize);
      const modOff = this.elf.vaToOffset(modPtr);
      if (modOff < 0) continue;
      // Il2CppCodeGenModule layout: ptr moduleName; size_t methodPointerCount; ptr methodPointers; ...
      const mpCount = this.elf.is64 ? Number(r.readU64(modOff + ptrSize)) : r.readU32(modOff + ptrSize);
      const mpPtrVa = readPtr(modOff + ptrSize * 2);
      const mpOff = this.elf.vaToOffset(mpPtrVa);
      if (mpOff < 0 || mpCount <= 0 || mpCount > 2_000_000) continue;
      for (let j = 0; j < mpCount; j++) {
        allPointers.push(readPtr(mpOff + j * ptrSize));
      }
    }
    this.methodPointers = new BigInt64Array(allPointers);
    this.notes.push(`Loaded ${allPointers.length} method pointers from codeGenModules`);
  }

  private readMethodPointerTable(off: number, count: number) {
    const r = this.elf.reader;
    const ptrSize = this.elf.is64 ? 8 : 4;
    const readPtr = (p: number) => (this.elf.is64 ? r.readU64(p) : BigInt(r.readU32(p)));
    const allPointers: bigint[] = [];
    for (let i = 0; i < count; i++) {
      allPointers.push(readPtr(off + i * ptrSize));
    }
    this.methodPointers = new BigInt64Array(allPointers);
    this.notes.push(`Loaded ${count} method pointers (legacy layout)`);
  }

  getMethodRva(methodIndex: number): bigint {
    if (methodIndex < 0 || methodIndex >= this.methodPointers.length) return 0n;
    return this.methodPointers[methodIndex];
  }
}
