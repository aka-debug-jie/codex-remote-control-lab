// React bindings for the domain store (selectors + shared singleton).
import { useCallback, useRef, useSyncExternalStore } from "react";
import { createStore } from "../lib/store.js";
import { createConnection } from "../lib/connection.js";

export const store = createStore();

export const connection = createConnection(store, {
  onThreadChange(threadId) {
    const url = new URL(location.href);
    if (threadId) url.searchParams.set("thread", threadId);
    else url.searchParams.delete("thread");
    history.replaceState(null, "", url.pathname + url.search);
  },
});

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) if (!Object.is(a[key], b[key])) return false;
  return true;
}

export function useStoreSelector(selector, equality = shallowEqual) {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef();
  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getState());
    if (cacheRef.current !== undefined && equality(cacheRef.current, next)) return cacheRef.current;
    cacheRef.current = next;
    return next;
  }, [equality]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
