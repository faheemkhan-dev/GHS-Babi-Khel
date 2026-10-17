import { useEffect, useState } from "react";
import { useTheme } from "./useTheme";

/**
 * Compatibility wrapper around the unified theme system.
 * Default mode is "system" — dashboards follow the OS preference until the
 * user explicitly toggles. The toggle flips between the only two modes the
 * site ships: System (bright/follows device) and Dark.
 */
export function useDarkMode() {
  const { theme, setTheme } = useTheme();

  const computeIsDark = () => {
    if (theme === "dark") return true;
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };

  const [isDark, setIsDark] = useState<boolean>(computeIsDark);

  useEffect(() => {
    setIsDark(computeIsDark());
    if (theme !== "system" || typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setIsDark(mql.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const toggle = () => setTheme(isDark ? "system" : "dark");
  const resetToSchedule = () => setTheme("system");

  return { isDark, toggle, resetToSchedule };
}
