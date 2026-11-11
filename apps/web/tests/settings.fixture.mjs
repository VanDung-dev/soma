export async function openSettings(section = "interface") {
  if (!document.querySelector('.settings-page')) document.querySelector('.module-settings').click();
  const settings = await waitForSettings(true);
  const href = section === 'interface' ? '/settings' : `/settings#${section}`;
  const link = settings.querySelector(`.settings-navigation a[href="${href}"]`);
  if (link.getAttribute('aria-current') !== 'page') link.click();
  return waitForSettings(true, section);
}

export async function closeSettings() {
  document.querySelector('.module-settings[aria-current="page"]')?.click();
  await waitForSettings(false);
}

export async function waitForSettings(open, section) {
  for (let frame = 0; frame < 120; frame++) {
    const settings = document.querySelector('.settings-page');
    const href = section === 'interface' ? '/settings' : `/settings#${section}`;
    if (Boolean(settings) === open && (!section || settings?.querySelector(`.settings-navigation a[href="${href}"][aria-current="page"]`))) return settings;
    await new Promise(requestAnimationFrame);
  }
  throw Error(open ? 'Settings did not open' : 'Settings did not close');
}
