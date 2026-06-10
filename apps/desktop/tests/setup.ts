// Node test environment shims. The store kernel (and stores built on it)
// persist to localStorage; give them an in-memory one so module-load reads and
// persistence assertions work without a browser environment.
const backing = new Map<string, string>();

globalThis.localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() {
    return backing.size;
  },
} as Storage;
