import { type MouseEvent, type ReactNode } from "react";
import { type Section } from "./destinations";

const icons = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-8h6v8" /></>,
  invoices: <><path d="M6 3h9l4 4v14H5V3h1Z" /><path d="M14 3v5h5M8 12h8m-8 4h8" /></>,
  payments: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18m-14 5h3" /></>,
  parties: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m2-16a3 3 0 0 1 0 6m1 4a4 4 0 0 1 3 4v2" /></>,
  reports: <path d="M4 4v16h16M9 15v-3m5 3V8m5 7V5" />,
  reconciliation: <><path d="m12 3 10 17H2L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
  backup: <><path d="M3 13h18v7H3zM12 3v7m-3-3 3 3 3-3M7 17h.01" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m10 3-.6 2.4-2 .9L5 5.5 3 9l1.8 1.7v2.6L3 15l2 3.5 2.4-.8 2 .9L10 21h4l.6-2.4 2-.9 2.4.8 2-3.5-1.8-1.7v-2.6L21 9l-2-3.5-2.4.8-2-.9L14 3z" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  arrow: <path d="m14 6-6 6 6 6" />,
  mark: <><path d="M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4" /></>
};

export function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
}

export function SectionLink({ section, navigate, children, className, current }: {
  section: Section;
  navigate: (section: Section) => void;
  children: ReactNode;
  className?: string;
  current?: "page" | "location" | undefined;
}) {
  function followLink(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    navigate(section);
  }

  return <a href={`#/${section}`} className={className} aria-current={current} onClick={followLink}>{children}</a>;
}
