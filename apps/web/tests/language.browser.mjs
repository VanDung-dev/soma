import { closeSettings, openSettings } from './settings.fixture.mjs';

export async function checkLanguage() {
  const settings = await openSettings();
  const original = document.documentElement.lang;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const choose = async language => {
    const control = settings.querySelector(`button[lang="${language}"]`);
    if (document.documentElement.lang !== language) { control.click(); await frames(); }
    assert(document.documentElement.lang === language && control.getAttribute('aria-pressed') === 'true', 'Mark the selected language');
    assert(settings.querySelector('#settings-language').textContent === (language === 'vi' ? 'Ngôn ngữ' : 'Language'), 'Label the language group in the current language');
  };
  try {
    for (const language of ['en', 'vi', 'en', 'vi', 'en']) await choose(language);
    const control = settings.querySelector('button[lang="en"]');
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    control.focus();
    const style = getComputedStyle(control);
    assert(document.activeElement === control && style.outlineStyle === 'none' && style.textDecorationLine.includes('underline'),
      'Keep keyboard focus visible without a focus ring');
    return { bothLanguages: true, settingsPage: true, accessibleLabel: true, focus: true };
  } finally { await choose(original); await closeSettings(); }
}
