// IL2CPP global-metadata.dat parser
// Supports versions 24-29 (Unity 2018-2022). Field layouts simplified.
import { BinaryReader } from "./binaryReader";

const SANITY = 0xfab11baf;

export interface MetadataHeader {
  sanity: number;
  version: number;
  stringLiteralOffset: number;
  stringLiteralSize: number;
  stringLiteralDataOffset: number;
  stringLiteralDataSize: number;
  stringOffset: number;
  stringSize: number;
  eventsOffset: number;
  eventsSize: number;
  propertiesOffset: number;
  propertiesSize: number;
  methodsOffset: number;
  methodsSize: number;
  parameterDefaultValuesOffset: number;
  parameterDefaultValuesSize: number;
  fieldDefaultValuesOffset: number;
  fieldDefaultValuesSize: number;
  fieldAndParameterDefaultValueDataOffset: number;
  fieldAndParameterDefaultValueDataSize: number;
  fieldMarshaledSizesOffset: number;
  fieldMarshaledSizesSize: number;
  parametersOffset: number;
  parametersSize: number;
  fieldsOffset: number;
  fieldsSize: number;
  genericParametersOffset: number;
  genericParametersSize: number;
  genericParameterConstraintsOffset: number;
  genericParameterConstraintsSize: number;
  genericContainersOffset: number;
  genericContainersSize: number;
  nestedTypesOffset: number;
  nestedTypesSize: number;
  interfacesOffset: number;
  interfacesSize: number;
  vtableMethodsOffset: number;
  vtableMethodsSize: number;
  interfaceOffsetsOffset: number;
  interfaceOffsetsSize: number;
  typeDefinitionsOffset: number;
  typeDefinitionsSize: number;
  imagesOffset: number;
  imagesSize: number;
  assembliesOffset: number;
  assembliesSize: number;
}

export interface Il2CppTypeDefinition {
  nameIndex: number;
  namespaceIndex: number;
  byvalTypeIndex: number;
  declaringTypeIndex: number;
  parentIndex: number;
  elementTypeIndex: number;
  genericContainerIndex: number;
  flags: number;
  fieldStart: number;
  methodStart: number;
  eventStart: number;
  propertyStart: number;
  nestedTypesStart: number;
  interfacesStart: number;
  vtableStart: number;
  interfaceOffsetsStart: number;
  methodCount: number;
  propertyCount: number;
  fieldCount: number;
  eventCount: number;
  nestedTypeCount: number;
  vtableCount: number;
  interfacesCount: number;
  interfaceOffsetsCount: number;
  bitfield: number;
  token: number;
}

export interface Il2CppMethodDefinition {
  nameIndex: number;
  declaringType: number;
  returnType: number;
  parameterStart: number;
  genericContainerIndex: number;
  token: number;
  flags: number;
  iflags: number;
  slot: number;
  parameterCount: number;
}

export interface Il2CppFieldDefinition {
  nameIndex: number;
  typeIndex: number;
  token: number;
}

export interface Il2CppParameterDefinition {
  nameIndex: number;
  token: number;
  typeIndex: number;
}

export interface Il2CppImageDefinition {
  nameIndex: number;
  assemblyIndex: number;
  typeStart: number;
  typeCount: number;
  exportedTypeStart: number;
  exportedTypeCount: number;
  entryPointIndex: number;
  token: number;
  customAttributeStart: number;
  customAttributeCount: number;
}

export class Metadata {
  reader: BinaryReader;
  header!: MetadataHeader;
  version: number = 0;
  types: Il2CppTypeDefinition[] = [];
  methods: Il2CppMethodDefinition[] = [];
  fields: Il2CppFieldDefinition[] = [];
  parameters: Il2CppParameterDefinition[] = [];
  images: Il2CppImageDefinition[] = [];

  private stringCache = new Map<number, string>();

  constructor(buf: ArrayBuffer) {
    this.reader = new BinaryReader(buf);
    const sanity = this.reader.readU32(0);
    if (sanity !== SANITY) throw new Error("Invalid global-metadata.dat sanity");
    this.version = this.reader.readU32(4);
    if (this.version < 16 || this.version > 31) {
      throw new Error(`Unsupported metadata version: ${this.version}`);
    }
    this.parseHeader();
    this.parseTypes();
    this.parseMethods();
    this.parseFields();
    this.parseParameters();
    this.parseImages();
  }

  private parseHeader() {
    // Field layouts differ slightly between versions but the order is consistent.
    // We read sequentially after sanity+version. Each pair is offset, size (u32, u32 / i32, i32).
    const r = this.reader;
    r.seek(8);
    const readPair = () => ({ off: r.readI32(), sz: r.readI32() });

    const h: any = { sanity: SANITY, version: this.version };
    const sl = readPair();
    h.stringLiteralOffset = sl.off; h.stringLiteralSize = sl.sz;
    const sld = readPair();
    h.stringLiteralDataOffset = sld.off; h.stringLiteralDataSize = sld.sz;
    const s = readPair();
    h.stringOffset = s.off; h.stringSize = s.sz;
    const ev = readPair();
    h.eventsOffset = ev.off; h.eventsSize = ev.sz;
    const pr = readPair();
    h.propertiesOffset = pr.off; h.propertiesSize = pr.sz;
    const me = readPair();
    h.methodsOffset = me.off; h.methodsSize = me.sz;
    const pdv = readPair();
    h.parameterDefaultValuesOffset = pdv.off; h.parameterDefaultValuesSize = pdv.sz;
    const fdv = readPair();
    h.fieldDefaultValuesOffset = fdv.off; h.fieldDefaultValuesSize = fdv.sz;
    const fpdv = readPair();
    h.fieldAndParameterDefaultValueDataOffset = fpdv.off; h.fieldAndParameterDefaultValueDataSize = fpdv.sz;
    const fms = readPair();
    h.fieldMarshaledSizesOffset = fms.off; h.fieldMarshaledSizesSize = fms.sz;
    const pa = readPair();
    h.parametersOffset = pa.off; h.parametersSize = pa.sz;
    const f = readPair();
    h.fieldsOffset = f.off; h.fieldsSize = f.sz;
    const gp = readPair();
    h.genericParametersOffset = gp.off; h.genericParametersSize = gp.sz;
    const gpc = readPair();
    h.genericParameterConstraintsOffset = gpc.off; h.genericParameterConstraintsSize = gpc.sz;
    const gc = readPair();
    h.genericContainersOffset = gc.off; h.genericContainersSize = gc.sz;
    const nt = readPair();
    h.nestedTypesOffset = nt.off; h.nestedTypesSize = nt.sz;
    const intf = readPair();
    h.interfacesOffset = intf.off; h.interfacesSize = intf.sz;
    const vt = readPair();
    h.vtableMethodsOffset = vt.off; h.vtableMethodsSize = vt.sz;
    const io = readPair();
    h.interfaceOffsetsOffset = io.off; h.interfaceOffsetsSize = io.sz;
    const td = readPair();
    h.typeDefinitionsOffset = td.off; h.typeDefinitionsSize = td.sz;
    // Versions >= 24 may have rgctx entries here; we skip optional sections we don't use.
    // Detect by trying images at expected location: try to read pairs until we find images.
    // Simpler: depending on version, read remaining pairs in known order.
    let imagesPair: { off: number; sz: number } | null = null;
    let assembliesPair: { off: number; sz: number } | null = null;

    if (this.version <= 24) {
      // v24: rgctxEntries pair, then images, assemblies
      readPair(); // rgctxEntries
      imagesPair = readPair();
      assembliesPair = readPair();
    } else if (this.version === 27 || this.version === 28) {
      // v27/28: rgctx removed in v27. Then images, assemblies, fieldRefs etc
      imagesPair = readPair();
      assembliesPair = readPair();
    } else if (this.version >= 29) {
      imagesPair = readPair();
      assembliesPair = readPair();
    } else {
      // generic fallback
      imagesPair = readPair();
      assembliesPair = readPair();
    }

    h.imagesOffset = imagesPair.off; h.imagesSize = imagesPair.sz;
    h.assembliesOffset = assembliesPair.off; h.assembliesSize = assembliesPair.sz;

    this.header = h as MetadataHeader;
  }

  readString(idx: number): string {
    if (idx < 0) return "";
    const cached = this.stringCache.get(idx);
    if (cached !== undefined) return cached;
    const off = this.header.stringOffset + idx;
    if (off < 0 || off >= this.reader.length) return "";
    const s = this.reader.readCString(off);
    this.stringCache.set(idx, s);
    return s;
  }

  // Type definition sizing varies. We provide a best-effort layout supporting 24-29.
  private getTypeDefSize(): number {
    // v24.0: 92 bytes? Actually:
    // We compute by reading two consecutive entries.
    // Standard sizes seen in dumpers:
    // v24/24.1: 0x5C (92)
    // v24.2: 0x60 (96)
    // v24.4: 0x60 (96)
    // v27/28: 0x5C (92) [rgctxStart/count removed but token/flags arrangement same]
    // v29: 0x5C (92)
    // Without precise version detection we use 92 by default, falling back via division.
    const size = this.header.typeDefinitionsSize;
    // Try common sizes by checking divisibility
    for (const candidate of [92, 96, 100, 104, 88]) {
      if (size % candidate === 0) return candidate;
    }
    return 92;
  }

  private parseTypes() {
    const r = this.reader;
    const size = this.getTypeDefSize();
    const count = Math.floor(this.header.typeDefinitionsSize / size);
    for (let i = 0; i < count; i++) {
      const base = this.header.typeDefinitionsOffset + i * size;
      r.seek(base);
      const t: Il2CppTypeDefinition = {
        nameIndex: r.readI32(),
        namespaceIndex: r.readI32(),
        byvalTypeIndex: r.readI32(),
        declaringTypeIndex: r.readI32(),
        parentIndex: r.readI32(),
        elementTypeIndex: r.readI32(),
        genericContainerIndex: r.readI32(),
        flags: r.readU32(),
        fieldStart: r.readI32(),
        methodStart: r.readI32(),
        eventStart: r.readI32(),
        propertyStart: r.readI32(),
        nestedTypesStart: r.readI32(),
        interfacesStart: r.readI32(),
        vtableStart: r.readI32(),
        interfaceOffsetsStart: r.readI32(),
        methodCount: r.readU16(),
        propertyCount: r.readU16(),
        fieldCount: r.readU16(),
        eventCount: r.readU16(),
        nestedTypeCount: r.readU16(),
        vtableCount: r.readU16(),
        interfacesCount: r.readU16(),
        interfaceOffsetsCount: r.readU16(),
        bitfield: r.readU32(),
        token: r.readU32(),
      };
      this.types.push(t);
    }
  }

  private getMethodSize(): number {
    const size = this.header.methodsSize;
    for (const c of [40, 44, 48, 52, 56, 36, 32]) {
      if (size % c === 0) return c;
    }
    return 40;
  }

  private parseMethods() {
    const r = this.reader;
    const size = this.getMethodSize();
    const count = Math.floor(this.header.methodsSize / size);
    for (let i = 0; i < count; i++) {
      const base = this.header.methodsOffset + i * size;
      r.seek(base);
      const m: Il2CppMethodDefinition = {
        nameIndex: r.readI32(),
        declaringType: r.readI32(),
        returnType: r.readI32(),
        parameterStart: 0,
        genericContainerIndex: 0,
        token: 0,
        flags: 0,
        iflags: 0,
        slot: 0,
        parameterCount: 0,
      };

      if (this.version >= 31) {
        r.readI32(); // returnParameterToken
      }

      m.parameterStart = r.readI32();

      if (this.version <= 24) {
        r.readI32(); // customAttributeIndex
      }

      m.genericContainerIndex = r.readI32();

      if (this.version <= 24.1) {
        r.readI32(); // methodIndex
        r.readI32(); // invokerIndex
        r.readI32(); // delegateWrapperIndex
        r.readI32(); // rgctxStartIndex
        r.readI32(); // rgctxCount
      }

      m.token = r.readU32();
      m.flags = r.readU16();
      m.iflags = r.readU16();
      m.slot = r.readU16();
      m.parameterCount = r.readU16();

      this.methods.push(m);
    }
  }

  private parseFields() {
    const r = this.reader;
    const size = 12; // nameIndex i32, typeIndex i32, token u32
    const count = Math.floor(this.header.fieldsSize / size);
    for (let i = 0; i < count; i++) {
      const base = this.header.fieldsOffset + i * size;
      r.seek(base);
      this.fields.push({
        nameIndex: r.readI32(),
        typeIndex: r.readI32(),
        token: r.readU32(),
      });
    }
  }

  private parseParameters() {
    const r = this.reader;
    const size = 12;
    const count = Math.floor(this.header.parametersSize / size);
    for (let i = 0; i < count; i++) {
      const base = this.header.parametersOffset + i * size;
      r.seek(base);
      this.parameters.push({
        nameIndex: r.readI32(),
        token: r.readU32(),
        typeIndex: r.readI32(),
      });
    }
  }

  private parseImages() {
    const r = this.reader;
    // image def: nameIndex i32, assemblyIndex i32, typeStart i32, typeCount u32, exportedTypeStart i32, exportedTypeCount u32, entryPointIndex i32, token u32 = 32 bytes
    // Some versions add customAttributeStart/customAttributeCount => 40 bytes
    const size = this.header.imagesSize > 0 &&
      this.header.imagesSize % 40 === 0 ? 40 : 32;
    const count = Math.floor(this.header.imagesSize / size);
    for (let i = 0; i < count; i++) {
      const base = this.header.imagesOffset + i * size;
      r.seek(base);
      const img: Il2CppImageDefinition = {
        nameIndex: r.readI32(),
        assemblyIndex: r.readI32(),
        typeStart: r.readI32(),
        typeCount: r.readU32(),
        exportedTypeStart: r.readI32(),
        exportedTypeCount: r.readU32(),
        entryPointIndex: r.readI32(),
        token: r.readU32(),
        customAttributeStart: size === 40 ? r.readI32() : 0,
        customAttributeCount: size === 40 ? r.readU32() : 0,
      };
      this.images.push(img);
    }
  }
}
