import { useEffect, useRef, type ReactNode } from "react";

/**
 * The shell every modal here shares. A native <dialog>: focus stays inside,
 * Escape and a click on the backdrop close it. With `onSubmit` the body is a
 * form and the footer's submit button triggers it.
 */
export function Modal({ title, onClose, onSubmit, footer, children }: {
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <header className="modal-head">
          <h2>{title}</h2>
        </header>
        {children}
        <footer className="modal-foot">{footer}</footer>
      </form>
    </dialog>
  );
}
