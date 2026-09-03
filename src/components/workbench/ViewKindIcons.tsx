// Small bespoke glyphs for each artifact/view type, used everywhere a lucide
// icon would normally go (hub groups, board cards, the "new project" wizard).
// Deliberately hand-drawn rather than reaching for generic stock icons --
// each one is meant to actually read as its diagram type at a glance rather
// than an arbitrary lucide pick that happens to be unused elsewhere.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ProcessMapIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="1.5" y="3" width="6" height="4.5" rx="1" />
      <rect x="12.5" y="12.5" width="6" height="4.5" rx="1" />
      <path d="M7.5 5.25 H12 M12 5.25 V12.5 H12.5" />
      <path d="M11 4.25 L12.5 5.25 L11 6.25" />
    </svg>
  );
}

export function BMCIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      {[1.5, 7.5, 13.5].flatMap((x) =>
        [1.5, 7.5, 13.5].map((y) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="0.8" />
        )),
      )}
    </svg>
  );
}

export function DFDIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="5.5" cy="6" r="3.5" />
      <path d="M8.5 8 L14 13" />
      <path d="M12.3 13 L14 13 L14 11.3" />
      <path d="M9 15.5 H18 M9 17.5 H18" />
    </svg>
  );
}

export function RACIIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="1.5" y="2.5" width="17" height="15" rx="1" />
      <path d="M1.5 7 H18.5 M7.5 2.5 V17.5" />
      <circle cx="4.5" cy="4.75" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="10" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DecisionTreeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="3.5" r="2" />
      <path d="M8.6 5 L4 12.5 M11.4 5 L16 12.5" />
      <circle cx="4" cy="15" r="2" />
      <circle cx="16" cy="15" r="2" />
    </svg>
  );
}

export function StateDiagramIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="5" cy="14" r="3" />
      <circle cx="15" cy="6" r="3" />
      <path d="M7.2 12 C 9 8.5, 11 8, 12.5 8" />
      <path d="M11.3 7 L12.5 8 L11.5 9.2" />
      <circle cx="5" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 2 V18 M9.5 2 V18 M16.5 2 V18" />
      <path d="M2.5 5 H9.5 M9.5 10.5 H16.5 M2.5 14.5 H9.5" />
      <circle cx="9.5" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
