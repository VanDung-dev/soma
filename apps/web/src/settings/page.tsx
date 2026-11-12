import { useContext, useEffect, useRef } from "react";
import { CameraDevicesContext } from "../anatomy/camera-devices";
import { useLanguage } from "../i18n";
import { useTheme } from "../theme";
import { ControlsGuide } from "./guide";
import { ShortcutControls } from "./shortcut-controls";
import { GraphicsControls } from "./graphics-controls";
import { useGraphicsSettings } from "../pages/use-graphics-settings";
import "./style.css";

const sections = {
  interface: "settings.interface",
  graphics: "settings.graphics",
  shortcuts: "settings.shortcuts",
  camera: "settings.camera",
  guide: "settings.guide",
  licenses: "settings.licenses",
} as const;

export type SettingsSection = keyof typeof sections;
const sectionNames = Object.keys(sections) as SettingsSection[];

export function settingsSectionAt(hash: string): SettingsSection {
  return sectionNames.find(section => hash === `#${section}`) ?? "interface";
}

export function settingsHref(section: SettingsSection) {
  return section === "interface" ? "/settings" : `/settings#${section}`;
}

function LicenseRow({ label, path }: { label: string; path: string }) {
  const { t } = useLanguage();
  return <div className="settings-row">
    <span className="graphics-options-label">{label}</span>
    <a className="settings-option settings-document-link" href={path} target="_blank" rel="noreferrer">{t("settings.licenses.view")}</a>
  </div>;
}

export function SettingsPage({ section = "interface", onReplayGuide }: {
  section?: SettingsSection; onReplayGuide?: () => void;
}) {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [graphics, setGraphics] = useGraphicsSettings();
  const cameras = useContext(CameraDevicesContext);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [section]);
  const hasCameraAccess = cameras && !cameras.error && cameras.devices.length > 0 && cameras.devices.every(device => !!device.label);

  return <main className="settings-page" aria-labelledby="settings-title">
      <div className="settings-layout">
        <nav className="settings-navigation" aria-labelledby="settings-title">
          <h1 id="settings-title">{t("app.settings")}</h1>
          {sectionNames.map(name => <a key={name} href={settingsHref(name)} aria-current={section === name ? "page" : undefined}>
            {t(sections[name])}
          </a>)}
        </nav>
        <section key={section} className={`settings-section settings-content${section === "guide" ? " controls-guide" : section === "shortcuts" ? " controls-shortcuts" : ""}`} aria-labelledby="settings-section-title">
          <h2 ref={heading} id="settings-section-title" tabIndex={-1}>{t(sections[section])}</h2>
          {section === "shortcuts" ? <ShortcutControls /> : <div className="settings-scroll">
          {section === "interface" && <>
            <div className="settings-row graphics-options-row">
              <span className="graphics-options-label" id="settings-language">{t("language.selector.label")}</span>
              <div className="graphics-options" role="group" aria-labelledby="settings-language">
                <button type="button" className="settings-option" lang="vi" aria-pressed={language === "vi"} onClick={() => setLanguage("vi")}>Tiếng Việt</button>
                <button type="button" className="settings-option" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
              </div>
            </div>
            <div className="settings-row graphics-options-row">
              <span className="graphics-options-label" id="settings-theme">{t("settings.theme")}</span>
              <div className="graphics-options" role="group" aria-labelledby="settings-theme">
                {(["auto", "light", "dark"] as const).map(option => <button key={option} type="button" className="settings-option theme-toggle"
                  data-value={option} aria-pressed={theme === option} onClick={() => setTheme(option)}>{t(`appearance.mode.${option}`)}</button>)}
              </div>
            </div>
          </>}
          {section === "graphics" && <GraphicsControls id="settings-graphics" graphics={graphics} onChange={setGraphics} buttons />}
          {section === "camera" && cameras && <>
            <div className="settings-row">
              <label htmlFor="settings-camera-device">{t("handCamera.device.label")}</label>
              <select id="settings-camera-device" className="settings-select" value={cameras.deviceId}
                  hidden={!hasCameraAccess} disabled={!hasCameraAccess}
                  onChange={event => cameras.setDeviceId(event.currentTarget.value)}>
                  <option value="">{t("handCamera.device.default")}</option>
                  {cameras.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
                    {device.label || t("handCamera.device.unnamed", { number: index + 1 })}
                  </option>)}
              </select>
              {!hasCameraAccess && <button type="button" className="settings-option" data-camera-access disabled={cameras.requesting} onClick={cameras.requestAccess}>
                  {t(cameras.requesting ? "handCamera.device.requesting" : cameras.error ? "handCamera.device.retry" : "handCamera.device.allow")}
              </button>}
            </div>
          </>}
          {section === "guide" && <div className="settings-guide-content">
            <h3>{t("controls.guide.title")}</h3>
            <ControlsGuide />
            {onReplayGuide && <button type="button" className="settings-option onboarding-replay" onClick={onReplayGuide}>{t("onboarding.replay")}</button>}
            <h3>{t("module.lessons")}</h3>
            <p>{t("lessons.guide.editor")}</p>
            <p>{t("lessons.dragInstructions")}</p>
            <p>{t("lessons.guide.reader")}</p>
            <p>{t("lessons.guide.cameraFocus")}</p>
          </div>}
          {section === "licenses" && <div className="settings-guide-content">
            <p>{t("settings.licenses.description")}</p>
            <h3>{t("settings.licenses.group.soma")}</h3>
            <LicenseRow label={t("settings.licenses.doc.license")} path="/licenses/LICENSE.txt" />
            <LicenseRow label={t("settings.licenses.doc.notice")} path="/licenses/NOTICE.txt" />
            <h3>{t("settings.licenses.group.assets")}</h3>
            <LicenseRow label={t("settings.licenses.doc.anatomy")} path="/models/z-anatomy/ATTRIBUTION.md" />
            <LicenseRow label={t("settings.licenses.doc.home")} path="/home/ATTRIBUTION.md" />
            <LicenseRow label={t("settings.licenses.doc.icons")} path="/icons/ATTRIBUTION.md" />
            <LicenseRow label={t("settings.licenses.doc.handInput")} path="/hand-input/ATTRIBUTION.md" />
            <h3>{t("settings.licenses.group.dependencies")}</h3>
            <LicenseRow label="Brotli" path="/licenses/brotli.txt" />
            <LicenseRow label={t("settings.licenses.doc.lessonContent")} path="/licenses/lesson-content.txt" />
            <LicenseRow label="Squoosh / libwebp" path="/licenses/squoosh.txt" />
            <LicenseRow label="TinyMCE" path="/licenses/tinymce.md" />
            <LicenseRow label="DOMPurify" path="/licenses/dompurify.txt" />
          </div>}
          </div>}
        </section>
      </div>
  </main>;
}
