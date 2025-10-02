import { ref } from "vue";
import { atou, utoa } from "./utils";

export const defaultCode = 'print "Hello, World!"\nprintflush message1';

export interface PlaygroundStore {
  code: string;

  serialize(): string;
}

export interface SerializedStoreData {
  code: string;
}

export class Store {
  #code = ref(defaultCode);

  get code() {
    return this.#code.value;
  }

  set code(value: string) {
    this.#code.value = value;
  }

  static deserialize(serialized: string): Store {
    const store = new Store();
    store.load(serialized);
    return store;
  }

  serialize(): string {
    const json = JSON.stringify({
      code: this.code,
    } satisfies SerializedStoreData);

    return "#" + utoa(json);
  }

  load(serialized: string) {
    if (serialized.startsWith("#")) serialized = serialized.slice(1);
    try {
      const { code } = JSON.parse(atou(serialized)) as SerializedStoreData;
      this.code = code;
    } catch {
      this.code = defaultCode;
    }
  }
}
