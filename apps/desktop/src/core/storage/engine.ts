// StorageEngine — carried on ctx.storage. Same repository structure for local and remote; connecting
// just SWAPS the active provider (remote when connected, else local). A swap, not a merge — the
// two realms are separate and independent, nothing migrates. An empty remote shows nothing.

import type { StorageRepos } from "./types.ts";

export class StorageEngine {
  private remote: StorageRepos | null;

  constructor(
    private readonly local: StorageRepos,
    remote: StorageRepos | null = null,
  ) {
    this.remote = remote;
  }

  connect(remote: StorageRepos): void {
    this.remote = remote;
  }
  disconnect(): void {
    this.remote = null;
  }
  get connected(): boolean {
    return this.remote !== null;
  }

  // The active provider — remote when connected, else local. CONTENT (containers/sessions/
  // messages/media) uses this, so it follows the connection.
  repos(): StorageRepos {
    return this.remote ?? this.local;
  }

  // Always the local provider. MACHINE state (settings, ui, agents) uses this — it stays on the
  // device and does not swap to the (empty) remote on connect.
  localRepos(): StorageRepos {
    return this.local;
  }
}
