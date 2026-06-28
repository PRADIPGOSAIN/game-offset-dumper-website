// Little-endian binary reader for parsing IL2CPP files
export class BinaryReader {
  private view: DataView;
  public pos: number = 0;
  public buf: Uint8Array;

  constructor(buf: ArrayBuffer | Uint8Array) {
    if (buf instanceof Uint8Array) {
      this.buf = buf;
      this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    } else {
      this.buf = new Uint8Array(buf);
      this.view = new DataView(buf);
    }
  }

  get length() {
    return this.buf.length;
  }

  seek(p: number) {
    this.pos = p;
  }

  readU8(p?: number) {
    const o = p ?? this.pos;
    const v = this.view.getUint8(o);
    if (p === undefined) this.pos += 1;
    return v;
  }
  readU16(p?: number) {
    const o = p ?? this.pos;
    const v = this.view.getUint16(o, true);
    if (p === undefined) this.pos += 2;
    return v;
  }
  readU32(p?: number) {
    const o = p ?? this.pos;
    const v = this.view.getUint32(o, true);
    if (p === undefined) this.pos += 4;
    return v;
  }
  readI32(p?: number) {
    const o = p ?? this.pos;
    const v = this.view.getInt32(o, true);
    if (p === undefined) this.pos += 4;
    return v;
  }
  readI16(p?: number) {
    const o = p ?? this.pos;
    const v = this.view.getInt16(o, true);
    if (p === undefined) this.pos += 2;
    return v;
  }
  readU64(p?: number): bigint {
    const o = p ?? this.pos;
    const v = this.view.getBigUint64(o, true);
    if (p === undefined) this.pos += 8;
    return v;
  }
  readI64(p?: number): bigint {
    const o = p ?? this.pos;
    const v = this.view.getBigInt64(o, true);
    if (p === undefined) this.pos += 8;
    return v;
  }

  writeU64(p: number, v: bigint) {
    this.view.setBigUint64(p, v, true);
  }
  writeU32(p: number, v: number) {
    this.view.setUint32(p, v, true);
  }

  readCString(p: number): string {
    let end = p;
    while (end < this.buf.length && this.buf[end] !== 0) end++;
    return new TextDecoder("utf-8", { fatal: false }).decode(this.buf.subarray(p, end));
  }

  readBytes(n: number, p?: number): Uint8Array {
    const o = p ?? this.pos;
    const v = this.buf.subarray(o, o + n);
    if (p === undefined) this.pos += n;
    return v;
  }
}
