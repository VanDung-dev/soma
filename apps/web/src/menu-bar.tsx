export function MenuBar({ disabled, onBack, helpId }: {
  disabled: boolean;
  onBack: () => void;
  helpId: string;
}) {
  return <header className="app-menu-bar" aria-label="Thanh điều hướng">
    <button className="controls-info" disabled={disabled} onClick={onBack}
      aria-label="Về góc nhìn tổng thể" title="Về góc nhìn tổng thể">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
    </button>
    <h1 className="app-menu-title" title="Không gian giải phẫu">Không gian giải phẫu</h1>
    <div className="app-menu-actions">
      <button className="controls-info" popoverTarget={helpId} aria-label="Trợ giúp" title="Trợ giúp">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 16.5h.01" /></svg>
      </button>
      <button className="controls-info" disabled aria-label="Cài đặt" title="Cài đặt — đang phát triển">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 3-.5 2-2 1-2-.5-2 3.5L4 10.5v3l-1.5 1.5 2 3.5 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3.5-1.5-1.5v-3L20 9l-2-3.5-2 .5-2-1-.5-2Z" />
          <circle cx="11" cy="12" r="3" />
        </svg>
      </button>
    </div>
  </header>;
}
