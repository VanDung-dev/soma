export async function checkLanguage() {
  const control = document.querySelector('.module-preferences > button:not(.theme-toggle)');
  const original = document.documentElement.lang;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const choose = async language => {
    if (document.documentElement.lang !== language) { control.click(); await frames(); }
    assert(document.documentElement.lang === language && control.textContent === language.toUpperCase(), 'Keep language and its header button aligned');
    assert(control.getAttribute('aria-label') === (language === 'vi' ? 'Ngôn ngữ' : 'Language'), 'Label the language button in the current language');
  };
  try {
    for (const language of ['en', 'vi', 'en', 'vi', 'en']) await choose(language);
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    control.focus();
    assert(document.activeElement === control && getComputedStyle(control).outlineStyle === 'solid', 'Keep language switching keyboard accessible');
    return { bothLanguages: true, headerButton: true, accessibleLabel: true, focus: true };
  } finally { await choose(original); }
}
