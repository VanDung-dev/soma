import { closeSettings, openSettings } from './settings.fixture.mjs';

export async function checkTheme() {
  const settings = await openSettings();
  const root = document.documentElement;
  const original = settings.querySelector('.theme-toggle[aria-pressed="true"]').dataset.value;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const choose = async theme => {
    const control = settings.querySelector(`.theme-toggle[data-value="${theme}"]`);
    control.click(); await frames();
    assert(control.getAttribute('aria-pressed') === 'true', 'Select auto, light and dark on Settings');
    const expected = theme === 'auto' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme;
    assert(root.dataset.theme === expected, 'Apply the chosen theme');
    assert(document.querySelector('meta[name="theme-color"]').content === (expected === 'dark' ? '#292b2a' : '#f5f2ec'), 'Update browser theme color');
  };
  try {
    for (const theme of ['light', 'dark', 'auto', 'light', 'dark']) await choose(theme);
    const rect = settings.querySelector('.theme-toggle').getBoundingClientRect();
    assert(settings.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), 'Keep Settings interactive through theme changes');
    return { settingsPage: true, auto: true, rapidChanges: true };
  } finally {
    await choose(original);
    await closeSettings();
  }
}
