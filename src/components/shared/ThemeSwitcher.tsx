import { Moon, Monitor } from "lucide-react";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";

// Exactly TWO appearances: Bright (System — follows the device) and Dark.
// Lantern (Hujra) mode was removed from the site's theme system.
const OPTIONS: { id: ThemeMode; label: string; Icon: typeof Moon }[] = [
  { id: "system",  label: "Bright (System)",   Icon: Monitor },
  { id: "dark",    label: "Dark",              Icon: Moon },
];

// Segmented pill toggle (System / Dark) — used everywhere.
const ThemeSegmented = ({ size = "md" }: { size?: "sm" | "md" }) => {
  const { theme, setTheme } = useTheme();
  const padY = size === "sm" ? 2 : 4;
  const padX = size === "sm" ? 5 : 7;
  const iconSize = size === "sm" ? 11 : 13;

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        borderRadius: 9999,
        backgroundColor: "hsl(var(--secondary))",
        border: "1px solid hsl(var(--border))",
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.id === theme;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.id}
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: `${padY}px ${padX}px`,
              borderRadius: 9999,
              border: "none",
              cursor: "pointer",
              backgroundColor: active ? "hsl(var(--background))" : "transparent",
              color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px hsl(var(--border))" : "none",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            <Icon style={{ width: iconSize, height: iconSize }} />
          </button>
        );
      })}
    </div>
  );
};

// Backwards-compatible exports — both desktop and mobile now render the same control.
export const ThemeInlineSelector = () => (
  <div style={{ width: "100%", display: "flex", justifyContent: "center", padding: "4px 0" }}>
    <ThemeSegmented size="md" />
  </div>
);

const ThemeSwitcher = (_props: { compact?: boolean } = {}) => <ThemeSegmented size="sm" />;

export default ThemeSwitcher;
