import { Slot } from "./components/Slot.tsx";
import { ApprovalModal } from "./components/ApprovalModal.tsx";
import { Sidebar } from "./pages/workspace/Sidebar.tsx";
import { SessionView } from "./pages/workspace/SessionView.tsx";
import { SettingsModal } from "./pages/settings/SettingsModal.tsx";
import { contributionsFor } from "./lib/registry.ts";
import { useRoute } from "./lib/router.ts";
import { useRightPanel } from "./lib/ui.ts";

// The shell is dumb: a sidebar, the main view, and a right panel that's just
// region slots. Everything else is contributed by pages/<feature>/register.
// The main view is route-driven — a registered "main" contribution whose route
// matches takes over; otherwise the session/chat view is the default.
function MainView() {
  const route = useRoute();
  const match = contributionsFor("main").find(
    (m) => m.route && (route === m.route || route.startsWith(m.route + "/")),
  );
  return <>{match ? match.render() : <SessionView />}</>;
}

export default function App() {
  const rightPanel = useRightPanel();
  return (
    <div className="flex h-screen overflow-hidden bg-white text-neutral-900">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        <MainView />
      </main>

      {rightPanel && (
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-4">
          <Slot region="right-panel" />
        </aside>
      )}

      <SettingsModal />
      <ApprovalModal />
    </div>
  );
}
