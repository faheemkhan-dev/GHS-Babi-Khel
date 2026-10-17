import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

/**
 * Round moon / sun theme button for the mobile navbar (same pattern as the
 * GHSS Ghallanai header). Uses the site's existing two appearances:
 *   • Bright (System)  → shows a moon; tap switches to Dark
 *   • Dark             → shows a sun;  tap switches back to Bright (System)
 * The saved choice and the pre-paint theme bootstrap in index.html are
 * unchanged — this is only a nicer control for the same setting.
 */
const ThemeToggleButton = ({ className = "" }: { className?: string }) => {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "system" : "dark")}
      aria-label={isDark ? "Switch to bright theme" : "Switch to dark theme"}
      title={isDark ? "Bright theme" : "Dark theme"}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground/80 transition-colors duration-150 hover:bg-secondary hover:text-foreground ${className}`}
    >
      {isDark ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
};

export default ThemeToggleButton;
