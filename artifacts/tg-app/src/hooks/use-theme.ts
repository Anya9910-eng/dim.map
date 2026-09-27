import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const LS_KEY = "tgapp-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
    }
    try { localStorage.setItem(LS_KEY, theme); } catch {}
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return { theme, setTheme, isDark: theme === "dark" };
}
