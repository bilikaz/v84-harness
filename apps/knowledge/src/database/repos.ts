// Composition root for persistence — a bundle of per-feature repos. Callers use
// each repo's own API: repos.users.findByUsername(...), repos.containers.list(uid).
// Repos are thin over the shared kysely connection; user_id is a method arg.

import { getDb } from "./index.ts";
import { UsersRepo } from "../features/auth/repo.ts";
import { SessionsRepo } from "../features/sessions/repo.ts"; // device-login sessions (auth_sessions table)
import { ContainersRepo } from "../features/data/containers/repo.ts";
import { ChatSessionsRepo } from "../features/data/sessions/repo.ts";
import { MessagesRepo } from "../features/data/messages/repo.ts";
import { MediaRepo } from "../features/data/media/repo.ts";
import { AgentsRepo } from "../features/data/agents/repo.ts";
import { SettingsRepo } from "../features/data/settings/repo.ts";
import { PluginsRepo } from "../features/data/plugins/repo.ts";
import { PluginDataRepo } from "../features/data/plugin_data/repo.ts";

export interface Repos {
  users: UsersRepo;
  authSessions: SessionsRepo;
  containers: ContainersRepo;
  sessions: ChatSessionsRepo;
  messages: MessagesRepo;
  media: MediaRepo;
  agents: AgentsRepo;
  settings: SettingsRepo;
  plugins: PluginsRepo;
  pluginData: PluginDataRepo;
}

export function openRepos(): Repos {
  const db = getDb();
  return {
    users: new UsersRepo(db),
    authSessions: new SessionsRepo(db),
    containers: new ContainersRepo(db),
    sessions: new ChatSessionsRepo(db),
    messages: new MessagesRepo(db),
    media: new MediaRepo(db),
    agents: new AgentsRepo(db),
    settings: new SettingsRepo(db),
    plugins: new PluginsRepo(db),
    pluginData: new PluginDataRepo(db),
  };
}
