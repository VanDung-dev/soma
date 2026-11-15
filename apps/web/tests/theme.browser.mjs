import { closeSettings, openSettings } from './settings.fixture.mjs';

export async function checkTheme() {
  const settings = await openSettings();
  const root = document.documentElement;
  const original = settings.querySelector('.theme-toggle[aria-pressed="true"]').dataset.value;
  const originalTransition = document.startViewTransition;
  const originalMatchMedia = window.matchMedia;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const choose = async theme => {
    const control = settings.querySelector(`.theme-toggle[data-value="${theme}"]`);
    control.click(); await frames();
    assert(control.getAttribute('aria-pressed') === 'true', 'Select auto, light and dark on Settings');
  };
  const settled = theme => {
    const expected = theme === 'auto' ? originalMatchMedia.call(window, '(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme;
    assert(root.dataset.theme === expected, 'Apply the chosen theme');
    assert(document.querySelector('meta[name="theme-color"]').content === (expected === 'dark' ? '#292b2a' : '#f5f2ec'), 'Update browser theme color');
    assert(!root.hasAttribute('data-theme-transition') && !root.style.getPropertyValue('--theme-reveal-radius'), 'Clean up completed theme transitions');
  };
  try {
    for (const theme of ['light', 'dark', 'auto']) { await choose(theme); await wait(1100); settled(theme); }
    const rect = settings.querySelector('.theme-toggle').getBoundingClientRect();
    assert(settings.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), 'Keep Settings interactive through theme changes');
    for (const theme of ['light', 'dark', 'auto', 'light', 'dark']) await choose(theme);
    await wait(1100); settled('dark');
    document.startViewTransition = undefined;
    await choose('light'); await wait(1100); settled('light');
    window.matchMedia = query => query === '(prefers-reduced-motion: reduce)' ? { matches: true } : originalMatchMedia.call(window, query);
    await choose('dark'); await frames(); settled('dark');
    return { settingsPage: true, auto: true, rapidChanges: true, fallback: true, reducedMotion: true };
  } finally {
    document.startViewTransition = originalTransition;
    window.matchMedia = originalMatchMedia;
    await choose(original); await wait(1100);
    await closeSettings();
  }
}
