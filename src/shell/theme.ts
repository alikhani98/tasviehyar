import { useLayoutEffect, useState } from "react";

const storageKey = "tasviehyar-theme";
const darkQuery = "(prefers-color-scheme: dark)";
export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];

function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Browser storage can be unavailable in a restricted session.
  }
  return "system";
}

export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  useLayoutEffect(() => {
    const device = theme === "system" ? window.matchMedia?.(darkQuery) : undefined;

    function applyTheme() {
      document.documentElement.dataset.theme = theme === "dark" || device?.matches ? "dark" : "light";
    }

    applyTheme();
    device?.addEventListener("change", applyTheme);
    return () => device?.removeEventListener("change", applyTheme);
  }, [theme]);

  function selectTheme(next: Theme) {
    setTheme(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Keep the selected appearance for this session.
    }
  }

  return { theme, selectTheme };
}
