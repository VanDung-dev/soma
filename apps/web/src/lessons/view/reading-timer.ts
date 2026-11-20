import { useEffect, useEffectEvent, useState } from "react";

export const READING_DURATION_MS = 15_000;

export function useReadingTimer(stepId: string, enabled: boolean, onRead: (stepId: string) => void) {
  const [restart, setRestart] = useState(0);
  const complete = useEffectEvent(onRead);

  useEffect(() => {
    if (!enabled) return;
    function start() {
      return window.setTimeout(() => complete(stepId), READING_DURATION_MS);
    }
    let timeout = start();
    const stop = () => window.clearTimeout(timeout);
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      stop();
      timeout = start();
      setRestart(current => current + 1);
    }

    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    return () => {
      stop();
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", restore);
    };
  }, [enabled, stepId]);

  return restart;
}
