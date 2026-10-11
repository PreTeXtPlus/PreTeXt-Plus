/**
 * Every icon the editor draws, in one place. Hosts use the ones exported from
 * the package's index (e.g. for the top bar's primary action and Account
 * menu) so the whole editor shares one icon set.
 */
import type { ReactNode } from "react";
import clsx from "clsx";
import type { SaveStatus } from "./SaveStatusIndicator";

/** The frame every icon shares: a stroked, round-jointed, decorative SVG. */
const SvgIcon = ({
  size,
  strokeWidth,
  viewBox = "0 0 24 24",
  className,
  children,
}: {
  size: number;
  strokeWidth: number;
  viewBox?: string;
  className?: string;
  children: ReactNode;
}) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

// ── Explorer rail (36×36) ────────────────────────────────────────────────────

const RailIcon = ({ children }: { children: ReactNode }) => (
  <SvgIcon size={36} strokeWidth={1.2}>
    {children}
  </SvgIcon>
);

export const TocIcon = () => (
  <RailIcon>
    <path d="M9 5L21 5" />
    <path d="m 17,12 h 4" />
    <path d="m 17,19 h 4" />
    <path d="M 17,5 V 18.932107" />
    {/* The numerals stay thinner than the frame so "1.1" and "1.2" don't close up. */}
    <g strokeWidth="1">
      <path d="M5 7L5 3L3.5 4.5" />
      <path d="m 14.750039,20.75 h -2 l 1.90471,-2.9629 c 0.06221,-0.0968 0.09744,-0.2103 0.07238,-0.3226 -0.05774,-0.2588 -0.26109,-0.7145 -0.97709,-0.7145 -0.99999,0 -1,0.8889 -1,0.8889 0,0 0,0 0,0 v 0.2222" />
      <path d="m 14.25,13.999894 v -4 l -1.5,1.5" />
      <path d="m 8.75,13.999894 v -4 l -1.5,1.5" />
      <path d="m 8.75,20.749894 v -4 l -1.5,1.5" />
      <path d="M11.218067 14.218067h0" />
      <path d="M11.218067 20.718067h0" />
    </g>
  </RailIcon>
);

export const SnippetsIcon = () => (
  <RailIcon>
    <path d="M7 18H10.5H14" />
    <path d="M7 14H7.5H8" />
    <path d="M7 10H8.5H10" />
    <path d="M7 2L16.5 2L21 6.5V19" />
    <path d="M3 20.5V6.5C3 5.67157 3.67157 5 4.5 5H14.2515C14.4106 5 14.5632 5.06321 14.6757 5.17574L17.8243 8.32426C17.9368 8.43679 18 8.5894 18 8.74853V20.5C18 21.3284 17.3284 22 16.5 22H4.5C3.67157 22 3 21.3284 3 20.5Z" />
    <path d="M14 5V8.4C14 8.73137 14.2686 9 14.6 9H18" />
  </RailIcon>
);

export const AssetsIcon = () => (
  <RailIcon>
    <path d="M21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6Z" />
    <path d="M3 16L10 13L21 18" />
    <path d="M16 10C14.8954 10 14 9.10457 14 8C14 6.89543 14.8954 6 16 6C17.1046 6 18 6.89543 18 8C18 9.10457 17.1046 10 16 10Z" />
  </RailIcon>
);

export const FindIcon = () => (
  <RailIcon>
    <circle cx="10" cy="10" r="6" />
    <path d="M14.25 14.25L20 20" />
  </RailIcon>
);

// ── Editor title bar ─────────────────────────────────────────────────────────

/** The division settings toggle in the bar above the code editor. */
export const GearIcon = () => (
  <SvgIcon size={18} strokeWidth={1.5}>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
    <path d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L21.9999 12.9772L22 11L19.6224 10.3954Z" />
  </SvgIcon>
);

// ── Tree rows ────────────────────────────────────────────────────────────────

/**
 * A tree row's expand/collapse twisty, after VS Code's: points right while the
 * row is shut and turns to point down once it is open.
 */
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <SvgIcon
    size={16}
    strokeWidth={1.5}
    viewBox="0 0 16 16"
    className={clsx("transition-transform duration-100", open && "rotate-90")}
  >
    <path d="M6 3.5L10.5 8L6 12.5" />
  </SvgIcon>
);

// ── Top bar ──────────────────────────────────────────────────────────────────

/** A thin-stroked cloud outline with a mark inside it for each save status. */
export const CloudIcon = ({ status }: { status: SaveStatus }) => (
  <SvgIcon size={20} strokeWidth={1.25}>
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    {status === "saved" && <path d="M9 13.75l2 2 4-4" />}
    {(status === "saving" || status === "unsaved") && (
      <>
        <path d="M12 16.5v-5" />
        <path d="M9.75 13.75L12 11.5l2.25 2.25" />
      </>
    )}
    {status === "error" && (
      <>
        <path d="M12 10.75v3" />
        <path d="M12 16.25h.01" />
      </>
    )}
    {status === "offline" && <path d="M4 4l16 16" />}
  </SvgIcon>
);

/** Lucide's "layout-dashboard" (ISC license) — e.g. a host's project-page action. */
export const DashboardIcon = () => (
  <SvgIcon size={16} strokeWidth={2}>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </SvgIcon>
);

/** Lucide's "user" (ISC license) — e.g. a host's Account menu. */
export const UserIcon = () => (
  <SvgIcon size={16} strokeWidth={2}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </SvgIcon>
);
