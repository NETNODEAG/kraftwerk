export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
  </svg>
);

export const EditIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3Z" />
    <path d="m14.5 7.5 3 3" />
  </svg>
);

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const ChatIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...line}>
    <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
  </svg>
);

export const WorkflowIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...line}>
    <rect x="3" y="4" width="7" height="6" rx="1.5" />
    <rect x="14" y="14" width="7" height="6" rx="1.5" />
    <path d="M6.5 10v4a3 3 0 0 0 3 3H14" />
  </svg>
);

export const KnowledgeIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden {...line}>
    <path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z" />
    <path d="M12 6.5v13" />
  </svg>
);

/** A clock with a turning arrow: what ran before. */
export const RunsIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden {...line}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4.5v4h4" />
    <path d="M12 8v4.5l3 1.8" />
  </svg>
);
