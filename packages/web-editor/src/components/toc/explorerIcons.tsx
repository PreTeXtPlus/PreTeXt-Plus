import type { ReactNode } from "react";

/** Shared frame for the explorer rail's 24×24 stroke icons. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const TocIcon = () => (
  <Icon>
    <path d="M9 5L21 5" />
    <path d="M5 7L5 3L3.5 4.5" />
    <path d="M5.5 14L3.5 14L5.40471 11.0371C5.46692 10.9403 5.50215 10.8268 5.47709 10.7145C5.41935 10.4557 5.216 10 4.5 10C3.50001 10 3.5 10.8889 3.5 10.8889C3.5 10.8889 3.5 10.8889 3.5 10.8889L3.5 11.1111" />
    <path d="M4 19L4.5 19C5.05228 19 5.5 19.4477 5.5 20V20C5.5 20.5523 5.05228 21 4.5 21L3.5 21" />
    <path d="M3.5 17L5.5 17L4 19" />
    <path d="M9 12L21 12" />
    <path d="M9 19L21 19" />
  </Icon>
);

export const SnippetsIcon = () => (
  <Icon>
    <path d="M7 18H10.5H14" />
    <path d="M7 14H7.5H8" />
    <path d="M7 10H8.5H10" />
    <path d="M7 2L16.5 2L21 6.5V19" />
    <path d="M3 20.5V6.5C3 5.67157 3.67157 5 4.5 5H14.2515C14.4106 5 14.5632 5.06321 14.6757 5.17574L17.8243 8.32426C17.9368 8.43679 18 8.5894 18 8.74853V20.5C18 21.3284 17.3284 22 16.5 22H4.5C3.67157 22 3 21.3284 3 20.5Z" />
    <path d="M14 5V8.4C14 8.73137 14.2686 9 14.6 9H18" />
  </Icon>
);

export const AssetsIcon = () => (
  <Icon>
    <path d="M21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6Z" />
    <path d="M3 16L10 13L21 18" />
    <path d="M16 10C14.8954 10 14 9.10457 14 8C14 6.89543 14.8954 6 16 6C17.1046 6 18 6.89543 18 8C18 9.10457 17.1046 10 16 10Z" />
  </Icon>
);

export const FindIcon = () => (
  <Icon>
    <path d="M17 17L21 21" />
    <path d="M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z" />
  </Icon>
);
