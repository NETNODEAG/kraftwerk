import { useEffect, useRef, useState } from "react";

/** Open state for a popover menu: closes on a click outside of `wrap` and on Escape. */
export function useMenu<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, wrap };
}
