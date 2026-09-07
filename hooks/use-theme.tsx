import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const THEME_STORAGE_KEY = "patchwork-theme";

export type Theme = "mocha" | "latte";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialTheme(): Theme {
  const queryTheme = new URLSearchParams(location.search).get("theme");
  if (queryTheme === "mocha" || queryTheme === "latte") return queryTheme;
  return localStorage.getItem(THEME_STORAGE_KEY) === "latte" ? "latte" : "mocha";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "mocha" ? "latte" : "mocha"));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used within ThemeProvider");
  return theme;
}
