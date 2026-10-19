import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { textContext } from "./clipboard";
import { useLanguage } from "./i18n";
import type { MessageKey } from "./i18n";
import { isMacPlatform, shortcutAction, shortcutLabel } from "./shortcuts";
import type { Shortcut } from "./shortcuts";

export interface ContextAction {
  id: string;
  label: MessageKey;
  disabled?: boolean;
  hint?: MessageKey;
  shortcut?: Shortcut;
  run: () => void;
}

export interface AppContext {
  name?: string;
  secondaryName?: string;
  showClipboard?: boolean;
  actions: ContextAction[];
}

type Menu = ReturnType<typeof textContext> & AppContext & { x: number; y: number; source: HTMLElement | null; container: Element };

export function ContextMenu({ resolve }: { resolve: (target: Element, x: number, y: number, keyboard: boolean) => AppContext }) {
  const { t } = useLanguage();
  const [menu, setMenu] = useState<Menu>();
  const [notice, setNotice] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const resolver = useRef(resolve); resolver.current = resolve;
  const close = (restore = true) => {
    if (restore) { menu?.source?.focus({ preventScroll: true }); menu?.restore(); }
    setMenu(undefined);
  };

  useEffect(() => {
    let pending: Menu | undefined;
    const open = (event: MouseEvent) => {
      if (event.shiftKey && event.button === 2) { pending = undefined; setMenu(undefined); return; }
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      event.preventDefault();
      const target = event.target;
      const keyboard = event.button !== 2;
      const bounds = target.getBoundingClientRect();
      const x = keyboard ? bounds.left + Math.min(bounds.width / 2, 40) : event.clientX;
      const y = keyboard ? bounds.top + Math.min(bounds.height / 2, 24) : event.clientY;
      const next = { ...textContext(target), ...resolver.current(target, x, y, keyboard), x, y,
        container: target.closest("[popover]") ?? document.body,
        source: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      if (event.buttons & 2) pending = next;
      else setMenu(next);
    };
    const up = () => { if (pending) { setMenu(pending); pending = undefined; } };
    const move = (event: PointerEvent) => {
      if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 5) pending = undefined;
    };
    const down = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) setMenu(undefined);
    };
    const dismiss = () => { pending = undefined; setMenu(undefined); };
    const message = (event: MessageEvent) => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>("iframe.wikipedia-article")]
        .find(frame => frame.contentWindow === event.source);
      if (!frame) return;
      if (event.data?.type === "wikipedia:pointerdown") { dismiss(); return; }
      if (event.data?.type !== "wikipedia:contextmenu") return;
      const { x, y, text } = event.data;
      if (!Number.isFinite(x) || !Number.isFinite(y) || typeof text !== "string" || text.length > 1_000_000
        || x < 0 || y < 0 || x > frame.clientWidth || y > frame.clientHeight) return;
      const bounds = frame.getBoundingClientRect();
      setMenu({ x: bounds.left + x, y: bounds.top + y, text, canPaste: false, restore: () => { frame.focus(); },
        paste: () => false, actions: [], source: frame, container: document.body });
    };
    document.addEventListener("contextmenu", open);
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointerup", up);
    document.addEventListener("pointermove", move); document.addEventListener("pointercancel", dismiss);
    document.addEventListener("scroll", dismiss, true); window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss); window.addEventListener("message", message);
    return () => {
      document.removeEventListener("contextmenu", open);
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up);
      document.removeEventListener("pointermove", move); document.removeEventListener("pointercancel", dismiss);
      document.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss); window.removeEventListener("message", message);
    };
  }, []);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!menu || !element) return;
    element.showPopover();
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    (element.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? element).focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const copy = async () => {
    if (!menu) return;
    const text = menu.text || menu.name;
    close();
    try { await navigator.clipboard.writeText(text!); setNotice(t("context.copied")); }
    catch { setNotice(t("context.copyFailed")); }
  };
  const paste = async () => {
    if (!menu) return;
    const destination = menu;
    close();
    try {
      const text = await navigator.clipboard.readText();
      if (!destination.paste(text)) setNotice(t("context.pasteFailed"));
    } catch { destination.restore(); setNotice(t("context.pasteFailed")); }
  };

  return <>
    {menu && createPortal(<div className="context-menu" ref={panel} popover="manual" role="menu" tabIndex={-1} aria-label={t("context.label")}
      onToggle={event => { if (!event.currentTarget.matches(":popover-open")) setMenu(undefined); }}
      onContextMenu={event => { if (!event.shiftKey || event.button !== 2) { event.preventDefault(); event.stopPropagation(); } }}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        const command = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
        if (menu.showClipboard !== false && command && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && ["c", "v"].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopPropagation();
          if (event.key.toLowerCase() === "c" && (menu.text || menu.name)) void copy();
          else if (event.key.toLowerCase() === "v" && menu.canPaste) void paste();
          return;
        }
        const shortcut = shortcutAction(event.nativeEvent);
        const action = shortcut && menu.actions.find(action => action.shortcut === shortcut);
        if (action && shortcut !== "restore" && !action.disabled) { event.preventDefault(); event.stopPropagation(); close(); action.run(); return; }
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation(); close();
        }
      }}>
      {menu.name && <div className={`context-name${menu.secondaryName ? " context-name-primary" : ""}`}>{menu.name}</div>}
      {menu.secondaryName && <div className="context-name-secondary">{menu.secondaryName}</div>}
      {menu.showClipboard !== false && <>
        <button role="menuitem" disabled={!menu.text && !menu.name} onClick={copy}><span>{t("context.copy")}</span><kbd>{shortcutLabel("copy")}</kbd></button>
        <button role="menuitem" disabled={!menu.canPaste} onClick={paste}><span>{t("context.paste")}</span><kbd>{shortcutLabel("paste")}</kbd></button>
      </>}
      {(menu.showClipboard !== false || !!menu.secondaryName) && !!menu.actions.length && <div role="separator" className="context-separator" />}
      {menu.actions.map(action => <button key={action.id} role="menuitem" disabled={action.disabled}
        title={action.hint ? t(action.hint) : undefined}
        onClick={() => { close(); action.run(); }}><span>{t(action.label)}</span>{action.shortcut && <kbd>{shortcutLabel(action.shortcut)}</kbd>}</button>)}
    </div>, menu.container)}
    <div className={`context-notice${notice ? " is-visible" : ""}`} role="status">{notice}</div>
  </>;
}
