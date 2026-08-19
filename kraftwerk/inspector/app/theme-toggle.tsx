"use client";

export function ThemeToggle() {
  return (
    <button
      className="theme-btn"
      onClick={() => {
        const el = document.documentElement;
        const next = el.dataset.theme === "light" ? "dark" : "light";
        el.dataset.theme = next;
        try {
          localStorage.setItem("kw-theme", next);
        } catch {}
      }}
    >
      day / night
    </button>
  );
}
