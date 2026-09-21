import React from "react";

const paths = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  battery: (
    <>
      <rect x="3" y="6" width="17" height="12" rx="2" />
      <path d="M23 10v4M7 10v4m4-4v4m4-4v4" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8v10H3ZM9 21v-8h6v8" />
    </>
  ),
  grid: (
    <>
      <path d="m8 3-5 18m13-18 5 18M8 3h8M6 9h12M4 16h16M8 3l10 13M16 3 6 16" />
    </>
  ),
  bolt: <path d="m14 2-10 12h7l-1 8 10-12h-7Z" />,
  generator: (
    <>
      <rect x="3" y="8" width="15" height="9" rx="2" />
      <path d="M18 11h3v3h-3M6.5 8V5.5h5V8M8 12h5M21 18H6" />
    </>
  ),
  devices: (
    <>
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-5v5M7 7h4m-4 4h9" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  logout: (
    <>
      <path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h13" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3c0 10 0 17-9 17a7 7 0 0 1-7-7C4 4 15 7 20 3ZM4 21l12-12" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  wifi: (
    <>
      <path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0" />
      <circle cx="12" cy="20" r=".6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};
export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.bolt}
    </svg>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Icon name="sun" size={25} />
      </span>
      <span>
        helio<span className="brand-period">.</span>
      </span>
    </div>
  );
}
