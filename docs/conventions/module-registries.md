# Module registries: the folder layout IS the registry

**Rule in one line:** when a family of implementations is selected by a key,
make the folder layout the registry — one module per implementation at
`<kind>/<key>.ts`, each exporting one canonical name; resolution parses the
key to the path, and a missing file *is* the "unsupported" error.

## Why

Hand-maintained dispatch (a `switch`, a routing table, per-kind factory
functions) is the same information stated twice: once in the file system,
once in code. The copies drift — tables fork per kind, switches grow special
cases, and "add an implementation" becomes an N-file change. When the path is
the registry, adding an implementation is dropping a file, deleting one
removes it everywhere, and the failure mode ("there is no `text/generate`
provider") falls out of the lookup instead of needing guard code.

## How to apply

1. **One module per implementation**, named by its key, grouped by kind:
   `providers/text/openai.ts`, `providers/image/generate.ts`,
   `exporters/csv.ts`. The abstract base for a kind lives in that folder's
   `base.ts`.
2. **One canonical export name** across all modules (e.g. every module exports
   `class Provider`) — the resolver depends on the name, not per-module
   knowledge. The file path already says which one it is; the class name
   doesn't repeat it.
3. **Resolve by parsing, not by listing**: derive the path from the selection
   keys (`` `${kind}/${type}.ts` ``) and look it up in an eagerly collected
   module map (`import.meta.glob` under Vite; an equivalent static manifest
   elsewhere). Throw a message that names the missing coordinate.
4. **Absence is the capability statement.** Don't write "X cannot do Y"
   guards; let the missing cell answer. If a combination needs a special
   message, phrase the lookup error well once.
5. Modules that aren't implementations (a kind's `base.ts`, content modules)
   may live in the same folders — they simply never match a key, because keys
   come from a closed union that doesn't contain `base`.

## Example

```ts
const MODULES = import.meta.glob<{ Provider?: ProviderCtor }>("./providers/*/*.ts", { eager: true });

function resolve(kind: Kind, type: Type): ProviderCtor {
  const ctor = MODULES[`./providers/${kind}/${type}.ts`]?.Provider;
  if (!ctor) throw new Error(`there is no ${kind}/${type} provider.`);
  return ctor;
}
```

Static side-tables on the canonical class extend the registry without new
lookups (e.g. `Provider.listModels?.()` — capability by presence).
