// Composition root for persistence — a bundle of per-feature repos. Callers
// use each repo's own API: repos.users.findByUsername(...), repos.data.get(uid, key).
// Repos are thin over the shared kysely connection; user_id is a method arg.

import { getDb } from "./index.ts";
import { UsersRepo } from "../features/auth/repo.ts";
import { SessionsRepo } from "../features/sessions/repo.ts";
import { DataRepo } from "../features/data/repo.ts";

export interface Repos {
  users: UsersRepo;
  sessions: SessionsRepo;
  data: DataRepo;
}

export function openRepos(): Repos {
  const db = getDb();
  return {
    users: new UsersRepo(db),
    sessions: new SessionsRepo(db),
    data: new DataRepo(db),
  };
}
