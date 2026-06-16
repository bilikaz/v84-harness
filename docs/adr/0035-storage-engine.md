# ADR-0035: Storage engine — backend embedded, persistence owned; init picks the backend

Superseded by [ADR-0043](0043-per-entity-repos.md) (the KV `Storage` port +
durable-IO ownership give way to per-entity `StorageRepos`) and
[ADR-0044](0044-storage-engine-provider-swap.md) (the `StorageEngine` is now a
provider swap, not an embedded backend). Original record archived at
[archive/0035-storage-engine.md](archive/0035-storage-engine.md).
