import { Color } from "vscode-languageserver";
import {
  blocks,
  colorData,
  counterVar,
  globalReadonlyVariables,
  items,
  keywords,
  liquids,
  makeColorVarName,
  mathConstants,
  sensors,
  soundNames,
  teams,
  units,
} from "./constants";
import { parseColor } from "./parser/tokens";

export enum SymbolFlags {
  none = 0,
  keyword = 1 << 0,
  buildingLink = 1 << 1,
  writeable = 1 << 2,
  global = 1 << 3,
}

export class NameSymbol {
  constructor(
    public name: string,
    public flags: SymbolFlags,
    public color?: Color
  ) {}

  get isKeyword() {
    return this.flags & SymbolFlags.keyword;
  }

  get isWriteable() {
    return this.flags & SymbolFlags.writeable;
  }

  get isBuildingLink() {
    return this.flags & SymbolFlags.buildingLink;
  }

  get isGlobal() {
    return this.flags & SymbolFlags.global;
  }
}

export const builtInSymbols = [
  ...keywords.map((name) => new NameSymbol(name, SymbolFlags.keyword)),
  ...mathConstants.map(makeGlobal),
  ...globalReadonlyVariables.map(makeGlobal),
  new NameSymbol(counterVar, SymbolFlags.global | SymbolFlags.writeable),
  ...teams.map(makeGlobal),
  ...Object.keys(colorData).map(makeColorGlobal),
  ...items.map(makeGlobal),
  ...liquids.map(makeGlobal),
  ...blocks.map(makeGlobal),
  ...sensors.map(makeGlobal),
  ...units.map(makeGlobal),
  ...soundNames.map(makeGlobal),
];

export const builtInSymbolMap = new Map(
  builtInSymbols.map((symbol) => [symbol.name, symbol])
);

export class SymbolTable {
  private table = new Map<string, NameSymbol>();

  has(name: string) {
    return this.table.has(name) || builtInSymbolMap.has(name);
  }

  get(name: string) {
    return this.table.get(name) ?? builtInSymbolMap.get(name);
  }

  insert(symbol: NameSymbol) {
    this.table.set(symbol.name, symbol);
  }

  *[Symbol.iterator]() {
    yield* this.table;
    yield* builtInSymbolMap;
  }

  *keys() {
    yield* this.table.keys();
    yield* builtInSymbolMap.keys();
  }

  localKeys() {
    return this.table.keys();
  }

  *values() {
    yield* this.table.values();
    yield* builtInSymbolMap.values();
  }

  localValues() {
    return this.table.values();
  }

  *entries() {
    yield* this.table;
    yield* builtInSymbolMap;
  }

  localEntries() {
    return this.table.entries();
  }
}

function makeGlobal(name: string) {
  return new NameSymbol(name, SymbolFlags.global);
}

function makeColorGlobal(name: string) {
  const color = parseColor(colorData[name]);
  const globalName = makeColorVarName(name);

  return new NameSymbol(globalName, SymbolFlags.global, color);
}
