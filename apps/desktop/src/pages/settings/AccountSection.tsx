import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, WifiOff } from "lucide-react";

import { Row, fieldInput } from "./Field.tsx";
import { AVATARS, saveAccount, useAccount } from "../../lib/account.ts";
import { cn } from "../../lib/cn.ts";

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
            onClick={() => saveAccount({ connection: "offline" })}
            icon={<WifiOff size={16} />}
            title={t("account.offline")}
            desc={t("account.offlineDesc")}
          />
          <ConnChoice
            active={account.connection === "connected"}
            onClick={() => saveAccount({ connection: "connected" })}
            icon={<Cloud size={16} />}
            title={t("account.connected")}
            desc={t("account.connectedDesc")}
            soon={t("account.soon")}
          />
        </div>
      </Row>

      <Row label={t("account.avatar")}>
        <div className="flex flex-wrap gap-1.5">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => saveAccount({ avatar: a })}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-lg",
                account.avatar === a
                  ? "bg-neutral-900/5 ring-2 ring-neutral-900"
                  : "hover:bg-neutral-100",
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

function ConnChoice(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  desc: string;
  soon?: string;
}) {
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
        <span className="flex items-center gap-2 text-sm font-medium text-neutral-800">
          {props.title}
          {props.soon && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              {props.soon}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-neutral-500">{props.desc}</span>
      </span>
    </button>
  );
}
