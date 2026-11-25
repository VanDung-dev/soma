import { useEffect, useState } from "react";
import type { Catalog } from "./catalog/types";
import { getCatalog } from "./core";

export function useCatalog(errorMessage: string, { logAfterUnmount = false } = {}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let owned: Catalog | undefined;
    getCatalog().then(value => {
      if (!active) { value.free(); return; }
      owned = value;
      setCatalog(value);
    }, cause => {
      if (active || logAfterUnmount) console.error(errorMessage, cause);
      if (active) setFailed(true);
    });
    return () => { active = false; owned?.free(); };
  }, [attempt, errorMessage, logAfterUnmount]);

  function retry() {
    setFailed(false);
    setAttempt(value => value + 1);
  }

  return { catalog, failed, retry };
}
