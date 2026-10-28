export async function checkSidebar() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); };
  const panels = [...document.querySelectorAll('.catalog-panel, .information-panel')];
  const settle = async () => {
    await frames();
    await Promise.all(panels.flatMap(panel => panel.getAnimations()).map(animation => animation.finished.catch(() => {})));
    await frames();
  };
  const desktop = matchMedia('(min-width: 1141px)').matches;
  const buttons = [...document.querySelectorAll(desktop ? '.sidebar-toggle' : '.anatomy-panel-toggles button')];
  const frame = document.querySelector('.model-focus-frame');
  const canvas = document.querySelector('.model-canvas canvas');
  const tree = document.querySelector('.catalog-tree');
  const visible = panel => !!panel.getClientRects().length;
  const initial = buttons.map(button => button.getAttribute('aria-expanded') === 'true');
  const check = () => {
    buttons.forEach((button, index) => {
      assert(button.getAttribute('aria-controls') === panels[index].id, 'Link each toggle to its sidebar');
      assert((button.getAttribute('aria-expanded') === 'true') === visible(panels[index]), 'Announce the visible sidebar state');
      assert(button.getAttribute('aria-label') || button.textContent.trim(), 'Label every sidebar toggle');
    });
    assert(document.querySelector('.model-canvas canvas') === canvas, 'Keep the same viewer while toggling sidebars');
    assert(document.querySelector('.catalog-tree') === tree, 'Keep the mounted catalog tree');
    const bounds = frame.getBoundingClientRect();
    assert(bounds.width > 1 && bounds.height > 1, 'Keep the interaction frame usable');
    if (desktop) {
      const area = document.querySelector('.model-canvas').getBoundingClientRect();
      const left = visible(panels[0]) ? panels[0].getBoundingClientRect().right : area.left;
      const right = visible(panels[1]) ? panels[1].getBoundingClientRect().left : area.right;
      assert(Math.abs(bounds.left - left - 12) < 1 && Math.abs(right - bounds.right - 12) < 1,
        'Reclaim exactly the space of each hidden sidebar');
    } else assert(panels.filter(visible).length <= 1, 'Keep compact sidebars mutually exclusive');
  };
  try {
    await settle();
    check();
    if (desktop) assert(document.querySelector('.app-menu-history .sidebar-toggle').previousElementSibling.getAttribute('aria-label') === document.querySelector('.app-menu-history button:nth-child(2)').getAttribute('aria-label'), 'Place the catalog toggle next to forward');
    const command = /Mac|iPhone|iPad/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    for (const [index, key, code] of [[0, 'S', 'KeyS'], [1, '>', 'Period']]) {
      const before = visible(panels[index]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey: true, ...command, bubbles: true, cancelable: true }));
      await settle();
      assert(visible(panels[index]) !== before, 'Shortcut toggles the intended sidebar');
      check();
      document.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey: true, ...command, bubbles: true, cancelable: true }));
      await settle();
    }
    for (const index of [0, 1, 0, 1, 1, 0, 1, 0]) {
      buttons[index].focus();
      buttons[index].click();
      await settle();
      assert(document.activeElement === buttons[index], 'Retain focus on the toggle');
      check();
      if (!visible(panels[index])) assert(![...panels[index].querySelectorAll('button, input, a')].some(element => element.getClientRects().length),
        'Remove hidden sidebar controls from navigation');
    }
    return { desktop, independentPanels: desktop, compactExclusive: !desktop, viewportReclaimed: true, viewerPreserved: true, accessibleState: true };
  } finally {
    for (const [index, open] of initial.entries()) {
      if (visible(panels[index]) !== open) { buttons[index].click(); await settle(); }
    }
  }
}

export async function checkSidebarMotion() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
  const desktop = matchMedia('(min-width: 1141px)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buttons = [...document.querySelectorAll(desktop ? '.sidebar-toggle' : '.anatomy-panel-toggles button')];
  const panels = [...document.querySelectorAll('.catalog-panel, .information-panel')];
  const settle = async () => {
    await Promise.all(panels.flatMap(panel => panel.getAnimations()).map(animation => animation.finished.catch(() => {})));
    await frames();
  };
  await settle();
  const initial = buttons.map(button => button.getAttribute('aria-expanded') === 'true');
  try {
    for (const [index, button] of buttons.entries()) {
      const panel = panels[index];
      for (const open of [true, false, true]) {
        if ((button.getAttribute('aria-expanded') === 'true') === open) continue;
        button.click();
        await Promise.resolve();
        const animations = panel.getAnimations();
        assert(reduced ? animations.length === 0 : animations.some(animation => animation.transitionProperty === 'translate'),
          'Animate both entry and exit, respecting reduced motion');
        for (const animation of animations) { animation.pause(); animation.currentTime = 120; }
        await frames();
        assert(panel.inert === !open && panel.getAttribute('aria-hidden') === String(!open),
          'Disable interaction and screen reader access as soon as a sidebar closes');
        if (!reduced) {
          const opacity = Number(getComputedStyle(panel).opacity);
          assert(opacity > 0 && opacity < 1, 'Fade through a visible intermediate state');
          if (desktop) {
            const area = document.querySelector('.model-canvas').getBoundingClientRect();
            const frame = document.querySelector('.model-focus-frame').getBoundingClientRect();
            assert(frame.left >= area.left && frame.right <= area.right, 'Keep the moving interaction frame inside the viewer');
          }
        }
        for (const animation of animations) animation.play();
        await settle();
        assert(!!panel.getClientRects().length === open, 'Finish the transition at the requested visibility');
      }
      button.click();
      await Promise.resolve();
      button.click();
      await Promise.resolve();
      await settle();
      assert(panel.getClientRects().length > 0, 'Rapid reversal finishes with an open sidebar');
    }
    return { desktop, reducedMotion: reduced, entryAndExit: true, intermediateFade: !reduced, inertOnClose: true, rapidReversal: true };
  } finally {
    for (const [index, open] of initial.entries()) {
      if ((buttons[index].getAttribute('aria-expanded') === 'true') !== open) { buttons[index].click(); await Promise.resolve(); await settle(); }
    }
  }
}
