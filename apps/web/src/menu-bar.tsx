import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "./i18n";

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
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
    </button>
    <h1 className="app-menu-title" title={t("app.title")}>{t("app.title")}</h1>
    <div className="app-menu-actions">
      <button className="controls-info" popoverTarget={helpId} aria-label={t("app.help")} title={t("app.help")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 16.5h.01" /></svg>
      </button>
      <button className="controls-info" popoverTarget={settingsId} aria-label={t("app.settings")} title={t("app.settings")}
        onClick={() => setLanguageOptionsOpen(false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 3-.5 2-2 1-2-.5-2 3.5L4 10.5v3l-1.5 1.5 2 3.5 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3.5-1.5-1.5v-3L20 9l-2-3.5-2 .5-2-1-.5-2Z" />
          <circle cx="11" cy="12" r="3" />
        </svg>
      </button>
    </div>
    <section id={settingsId} className="settings-popover" popover="auto" aria-labelledby={`${settingsId}-title`}>
      <div className="guide-heading">
        <h2 id={`${settingsId}-title`}>{t("app.settings")}</h2>
        <button className="controls-info" aria-label={t("app.settings.close")} popoverTarget={settingsId} popoverTargetAction="hide"
          onClick={() => setLanguageOptionsOpen(false)}>×</button>
      </div>
      <div className="settings-row">
        <span>{t("language.selector.label")}</span>
        <div className="settings-language-control">
          <button ref={languageToggle} className="settings-language-toggle" type="button" aria-haspopup="listbox"
            aria-expanded={languageOptionsOpen} aria-controls={languageOptionsId}
            onClick={() => setLanguageOptionsOpen(open => !open)}>
            {selectedLanguage}<span aria-hidden="true">⌄</span>
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
