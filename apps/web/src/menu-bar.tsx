import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "./i18n";
import { LineIcon } from "./icons";

export function MenuBar({ disabled, onBack, helpId }: {
  disabled: boolean;
  onBack: () => void;
  helpId: string;
}) {
  const settingsId = useId();
  const languageOptionsId = useId();
  const languageToggle = useRef<HTMLButtonElement>(null);
  const languageMenu = useRef<HTMLUListElement>(null);
  const [languageOptionsOpen, setLanguageOptionsOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const selectedLanguage = t(language === "vi" ? "language.option.vi" : "language.option.en");
  const chooseLanguage = (nextLanguage: "vi" | "en") => {
    setLanguage(nextLanguage);
    setLanguageOptionsOpen(false);
    languageToggle.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const menu = languageMenu.current;
    const toggle = languageToggle.current;
    if (!menu || !toggle) return;
    if (!languageOptionsOpen) {
      if (menu.matches(":popover-open")) menu.hidePopover();
      return;
    }
    menu.showPopover();
    const positionMenu = () => {
      const rect = toggle.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
      const top = rect.bottom + menuRect.height + 8 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - menuRect.height - 6);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    document.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("scroll", positionMenu, true);
    };
  }, [languageOptionsOpen]);
  return <header className="app-menu-bar" aria-label={t("app.navigation.label")}>
    <button className="controls-info" disabled={disabled} onClick={onBack}
      aria-label={t("app.overview")} title={t("app.overview")}>
      <LineIcon name="arrow-small-left" />
    </button>
    <h1 className="app-menu-title" title={t("app.title")}>{t("app.title")}</h1>
    <div className="app-menu-actions">
      <button className="controls-info" popoverTarget={helpId} aria-label={t("app.help")} title={t("app.help")}>
        <LineIcon name="alert-circle" />
      </button>
      <button className="controls-info" popoverTarget={settingsId} aria-label={t("app.settings")} title={t("app.settings")}
        onClick={() => setLanguageOptionsOpen(false)}>
        <LineIcon name="cog" />
      </button>
    </div>
    <section id={settingsId} className="settings-popover" popover="auto" aria-labelledby={`${settingsId}-title`}>
      <div className="guide-heading">
        <h2 id={`${settingsId}-title`}>{t("app.settings")}</h2>
        <button className="controls-info" aria-label={t("app.settings.close")} popoverTarget={settingsId} popoverTargetAction="hide"
          onClick={() => setLanguageOptionsOpen(false)}><LineIcon name="close-small" /></button>
      </div>
      <div className="settings-row">
        <span>{t("language.selector.label")}</span>
        <div className="settings-language-control">
          <button ref={languageToggle} className="settings-language-toggle" type="button" aria-haspopup="listbox"
            aria-expanded={languageOptionsOpen} aria-controls={languageOptionsId}
            onClick={() => setLanguageOptionsOpen(open => !open)}>
            {selectedLanguage}<LineIcon name="chevron-small-down" />
          </button>
          <ul ref={languageMenu} id={languageOptionsId} className="settings-language-menu" popover="auto"
            aria-label={t("language.selector.label")} onToggle={event => setLanguageOptionsOpen(event.currentTarget.matches(":popover-open"))}>
            <li><button className={`settings-language-option${language === "vi" ? " is-selected" : ""}`} type="button"
              aria-pressed={language === "vi"} onClick={() => chooseLanguage("vi")}>{t("language.option.vi")}</button></li>
            <li><button className={`settings-language-option${language === "en" ? " is-selected" : ""}`} type="button"
              aria-pressed={language === "en"} onClick={() => chooseLanguage("en")}>{t("language.option.en")}</button></li>
          </ul>
        </div>
      </div>
    </section>
  </header>;
}
