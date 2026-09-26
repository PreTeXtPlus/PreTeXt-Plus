import type { ReactNode } from "react";

/** Shared frame for the explorer rail's 36×36 stroke icons. */
const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    width="36"
    height="36"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="0.8"
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
    <path d="m 14.750039,20.75 h -2 l 1.90471,-2.9629 c 0.06221,-0.0968 0.09744,-0.2103 0.07238,-0.3226 -0.05774,-0.2588 -0.26109,-0.7145 -0.97709,-0.7145 -0.99999,0 -1,0.8889 -1,0.8889 0,0 0,0 0,0 v 0.2222" />
    <path d="m 17,12 h 4" />
    <path d="m 17,19 h 4" />
    <path d="M 17,5 V 18.932107" />
    <path d="m 14.25,13.999894 v -4 l -1.5,1.5" />
    <path d="m 8.75,13.999894 v -4 l -1.5,1.5" />
    <path d="m 8.75,20.749894 v -4 l -1.5,1.5" />
    <path d="M11.218067 14.218067h0" />
    <path d="M11.218067 20.718067h0" />
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
