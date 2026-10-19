export function textContext(target: Element) {
  const field = target.closest("input, textarea");
  const input = field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
    && ["text", "search", "url", "tel", "password"].includes(field.type) ? field : undefined;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  const start = input?.selectionStart ?? 0, end = input?.selectionEnd ?? 0;
  const secret = input instanceof HTMLInputElement && input.type === "password";
  const text = secret ? "" : input ? input.value.slice(start, end) : selection?.toString() ?? "";
  const editable = input && !input.disabled && !input.readOnly ? input : undefined;
  return {
    text,
    canPaste: !!editable,
    restore: () => {
      if (input?.isConnected) { input.focus({ preventScroll: true }); input.setSelectionRange(start, end); }
      else if (range && range.startContainer.isConnected) { selection?.removeAllRanges(); selection?.addRange(range); }
    },
    paste: (value: string) => {
      if (!editable?.isConnected || editable.disabled || editable.readOnly) return false;
      editable.focus({ preventScroll: true }); editable.setSelectionRange(start, end);
      if (document.execCommand("insertText", false, value)) return true;
      const next = editable.value.slice(0, start) + value + editable.value.slice(end);
      const prototype = editable instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(editable, next);
      editable.setSelectionRange(start + value.length, start + value.length);
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: value }));
      return true;
    },
  };
}
