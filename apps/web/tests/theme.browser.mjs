export async function checkTheme() {
  const control = document.querySelector('.theme-toggle');
  const root = document.documentElement;
  const original = control.dataset.theme;
  const originalTransition = document.startViewTransition;
  const originalMatchMedia = window.matchMedia;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const choose = async theme => {
    for (let tries = 0; control.dataset.theme !== theme && tries < 3; tries++) { control.click(); await frames(); }
    assert(control.dataset.theme === theme, 'Cycle the header button through auto, light and dark');
  };
  const settled = theme => {
    const expected = theme === 'auto' ? originalMatchMedia.call(window, '(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme;
    assert(root.dataset.theme === expected, 'Apply the chosen theme');
    assert(document.querySelector('meta[name="theme-color"]').content === (expected === 'dark' ? '#292b2a' : '#f5f2ec'), 'Update browser theme color');
    assert(!root.hasAttribute('data-theme-transition') && !root.style.getPropertyValue('--theme-reveal-radius'), 'Clean up completed theme transitions');
  };
  const popover = document.querySelector('.settings-popover');
  const wasOpen = popover?.matches(':popover-open');
  try {
    popover?.showPopover();
    for (const theme of ['light', 'dark', 'auto']) { await choose(theme); await wait(1100); settled(theme); }
    if (popover) {
      const content = popover.querySelector('.settings-content'), rect = content.getBoundingClientRect();
      assert(popover.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), 'Keep Settings interactive through theme changes');
      popover.hidePopover();
    }
    for (const theme of ['light', 'dark', 'auto', 'light', 'dark']) await choose(theme);
    await wait(1100); settled('dark');
    document.startViewTransition = undefined;
    await choose('light'); await wait(1100); settled('light');
    window.matchMedia = query => query === '(prefers-reduced-motion: reduce)' ? { matches: true } : originalMatchMedia.call(window, query);
    await choose('dark'); await frames(); settled('dark');
    assert(control.querySelector('svg'), 'Keep the theme control icon');
    return { headerButton: true, interactivePopover: !!popover, auto: true, rapidChanges: true, fallback: true, reducedMotion: true };
  } finally {
    document.startViewTransition = originalTransition;
    window.matchMedia = originalMatchMedia;
    await choose(original); await wait(1100);
    if (wasOpen) popover.showPopover(); else popover?.hidePopover();
  }
}
