import { useSyncExternalStore } from "react";

const SERVER_VIEWPORT_WIDTH_PX = 1024;

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function getViewportWidth() {
  return innerWidth;
}

export function useViewportWidth() {
  return useSyncExternalStore(subscribe, getViewportWidth, () => SERVER_VIEWPORT_WIDTH_PX);
}
