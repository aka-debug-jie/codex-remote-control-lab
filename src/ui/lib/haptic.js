// Haptic feedback via the WebView Vibration API. Silently no-ops when the
// device/browser does not support it (or the VIBRATE permission is missing).
export function haptic(pattern) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

export const tap = () => haptic(8);
export const long = () => haptic(14);
