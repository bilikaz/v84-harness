import { useTranslation } from "react-i18next";

import { usePluginsConfig, setPluginSettings } from "../../../core/plugins/config.ts";
import { COMICS_DEFAULTS, COMICS_SLUG, manifest, type ComicsSettings } from "../manifest.ts";

// The comics plugin's settings: curated folders + the generation attempt budgets.
export function ComicsSettingsBlock() {
  const { t } = useTranslation();
  const cfg = usePluginsConfig();
  const s = manifest.validateSettings((cfg[COMICS_SLUG]?.settings as ComicsSettings | undefined) ?? COMICS_DEFAULTS);
  const save = (patch: Partial<ComicsSettings>): void => setPluginSettings(COMICS_SLUG, { ...s, ...patch });

  const row = "flex items-center justify-between gap-4 py-2";
  const input = "w-40 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-400";
  return (
    <div className="divide-y divide-neutral-100">
      <div className={row}>
        <div>
          <div className="text-sm font-medium text-neutral-800">{t("plugins.comics.setAvatarsDir")}</div>
          <div className="text-xs text-neutral-500">{t("plugins.comics.setAvatarsDirHint")}</div>
        </div>
        <input className={input} defaultValue={s.avatarsDir} onBlur={(e) => save({ avatarsDir: e.target.value })} />
      </div>
      <div className={row}>
        <div>
          <div className="text-sm font-medium text-neutral-800">{t("plugins.comics.setComicsDir")}</div>
          <div className="text-xs text-neutral-500">{t("plugins.comics.setComicsDirHint")}</div>
        </div>
        <input className={input} defaultValue={s.comicsDir} onBlur={(e) => save({ comicsDir: e.target.value })} />
      </div>
      <div className={row}>
        <div>
          <div className="text-sm font-medium text-neutral-800">{t("plugins.comics.setMaxAvatar")}</div>
          <div className="text-xs text-neutral-500">{t("plugins.comics.setMaxHint")}</div>
        </div>
        <input className={input} type="number" min={1} max={30} defaultValue={s.maxAvatarAttempts} onBlur={(e) => save({ maxAvatarAttempts: Number(e.target.value) })} />
      </div>
      <div className={row}>
        <div>
          <div className="text-sm font-medium text-neutral-800">{t("plugins.comics.setMaxPanel")}</div>
          <div className="text-xs text-neutral-500">{t("plugins.comics.setMaxHint")}</div>
        </div>
        <input className={input} type="number" min={1} max={30} defaultValue={s.maxPanelAttempts} onBlur={(e) => save({ maxPanelAttempts: Number(e.target.value) })} />
      </div>
    </div>
  );
}
