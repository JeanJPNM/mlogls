export interface ReadonlyBitSet {
  readonly length: number;
  get(index: number): boolean;

  or(other: ReadonlyBitSet): BitSet;

  and(other: ReadonlyBitSet): BitSet;

  clone(): BitSet;
}

export class BitSet implements ReadonlyBitSet {
  private readonly buffer: Int32Array;

  constructor(public readonly length: number) {
    // (length + 31) >>> 5 is equivalent to Math.ceil(length / 32)
    const bufferLength = (length + 31) >>> 5;
    this.buffer = new Int32Array(bufferLength);
  }

  get(index: number): boolean {
    const word = index >>> 5;
    const bit = index & 31;
    return (this.buffer[word] & (1 << bit)) !== 0;
  }

  set(index: number, value: boolean) {
    const word = index >>> 5;
    const bit = index & 31;
    if (value) {
      this.buffer[word] |= 1 << bit;
    } else {
      this.buffer[word] &= ~(1 << bit);
    }
  }

  toggle(index: number) {
    const word = index >>> 5;
    const bit = index & 31;
    this.buffer[word] ^= 1 << bit;
  }

  assignOr(other: BitSet): void {
    for (let i = 0; i < this.buffer.length; i++) {
      this.buffer[i] = this.buffer[i] | other.buffer[i];
    }
  }

  assignAnd(other: BitSet): void {
    for (let i = 0; i < this.buffer.length; i++) {
      this.buffer[i] = this.buffer[i] & other.buffer[i];
    }
  }

  or(other: BitSet): BitSet {
    const result = new BitSet(this.length);
    for (let i = 0; i < this.buffer.length; i++) {
      result.buffer[i] = this.buffer[i] | other.buffer[i];
    }
    return result;
  }

  and(other: BitSet): BitSet {
    const result = new BitSet(this.length);
    for (let i = 0; i < this.buffer.length; i++) {
      result.buffer[i] = this.buffer[i] & other.buffer[i];
    }
    return result;
  }

  clone(): BitSet {
    const result = new BitSet(this.length);
    result.buffer.set(this.buffer);
    return result;
  }
}
