import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, WifiOff, LogOut } from "lucide-react";

import { Row, fieldInput, fieldInputFull } from "./Field.tsx";
import { AVATARS, isConnected, login, logout, register, saveAccount, setConnection, useAccount } from "../../core/account.ts";
import { cn } from "../../lib/cn.ts";

const DEFAULT_ENDPOINT = "http://knowledge.localhost";

export function AccountSection() {
  const { t } = useTranslation();
  const account = useAccount();

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("account.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("account.subtitle")}</p>

      <Row label={t("account.connection")}>
        <div className="flex flex-col gap-2">
          <ConnChoice
            active={account.connection === "offline"}
            onClick={() => void setConnection("offline")}
            icon={<WifiOff size={16} />}
            title={t("account.offline")}
            desc={t("account.offlineDesc")}
          />
          <ConnChoice
            active={account.connection === "connected"}
            onClick={() => void setConnection("connected")}
            icon={<Cloud size={16} />}
            title={t("account.connected")}
            desc={t("account.connectedDesc")}
          />
        </div>
      </Row>

      {account.connection === "connected" && (
        <Row label={t("account.session")}>{isConnected() ? <SignedIn /> : <LoginForm />}</Row>
      )}

      <Row label={t("account.avatar")}>
        <div className="flex flex-wrap gap-1.5">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => saveAccount({ avatar: a })}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-lg",
                account.avatar === a ? "bg-neutral-900/5 ring-2 ring-neutral-900" : "hover:bg-neutral-100",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </Row>

      <Row label={t("account.username")}>
        <input
          value={account.username}
          onChange={(e) => saveAccount({ username: e.target.value })}
          placeholder={t("account.usernamePlaceholder")}
          className={fieldInput}
        />
      </Row>
    </div>
  );
}

function SignedIn() {
  const { t } = useTranslation();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex w-80 items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-neutral-800">{account.username}</span>
        <span className="block truncate text-xs text-neutral-500">{account.endpoint}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await logout();
        }}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
      >
        <LogOut size={14} />
        {t("account.logout")}
      </button>
    </div>
  );
}

function LoginForm() {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (fn: typeof login) => async () => {
    setBusy(true);
    setError(null);
    const r = await fn(endpoint, username.trim(), password);
    if (r.ok) return; // login applied: backend swapped + consumers re-hydrated, UI re-renders
    setError(r.error ?? "failed");
    setBusy(false);
  };

  return (
    <div className="flex w-80 flex-col gap-2">
      <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={t("account.endpointPlaceholder")} className={fieldInputFull} />
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("account.username")} autoComplete="username" className={fieldInputFull} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={t("account.password")} autoComplete="current-password" className={fieldInputFull} />
      {error && <p className="text-xs text-red-600">{t("account.loginError", { error })}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !endpoint || !username || !password}
          onClick={submit(login)}
          className="flex-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {t("account.login")}
        </button>
        <button
          type="button"
          disabled={busy || !endpoint || !username || !password}
          onClick={submit(register)}
          className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {t("account.register")}
        </button>
      </div>
    </div>
  );
}

function ConnChoice(props: { active: boolean; onClick: () => void; icon: ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "flex w-80 items-start gap-3 rounded-lg border px-3 py-2.5 text-left",
        props.active ? "border-neutral-900 bg-neutral-900/[0.03]" : "border-neutral-200 hover:bg-neutral-50",
      )}
    >
      <span className={cn("mt-0.5", props.active ? "text-neutral-900" : "text-neutral-400")}>{props.icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium text-neutral-800">{props.title}</span>
        <span className="mt-0.5 block text-xs text-neutral-500">{props.desc}</span>
      </span>
    </button>
  );
}
