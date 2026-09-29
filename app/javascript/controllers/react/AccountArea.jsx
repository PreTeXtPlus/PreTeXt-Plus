import React, { useState } from "react";
import { MenuDropdown } from "@pretextbook/web-editor";
import { buildAccountEntries } from "./accountEntries";

// The Account menu's icon: Lucide's "user" (ISC license). Below the top bar's
// compact breakpoint it stands in for the "Account" label.
const USER_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

/**
 * The Account menu for the unified editor top bar, matching the equivalent
 * menu in `app/views/layouts/application.html.erb` — same signed-in/signed-out
 * contents — built from the same `MenuDropdown` primitive the
 * File/Edit/Insert/Tools menus use, so all of them share one look and one set
 * of keyboard behaviors.
 *
 * @param {Object} props
 * @param {boolean} [props.signedIn] - Whether Account shows the signed-in entries.
 * @param {string} [props.userEmail]
 * @param {string} [props.projectsPath] - Signed-in only.
 * @param {boolean} [props.hasProfilePage]
 * @param {string} [props.profilePath]
 * @param {string} [props.settingsPath]
 * @param {string} [props.subscriptionsPath]
 * @param {() => void} [props.onSignOut] - Called when "Sign out" is selected.
 * @param {string} [props.newUserPath] - Signed-out only.
 * @param {string} [props.newSessionPath] - Signed-out only.
 * @param {(path: string) => void} [props.navigate] - See `buildAccountEntries`.
 * @returns {JSX.Element}
 */
function AccountArea({
  signedIn,
  userEmail,
  projectsPath,
  hasProfilePage,
  profilePath,
  settingsPath,
  subscriptionsPath,
  onSignOut,
  newUserPath,
  newSessionPath,
  navigate,
}) {
  const [openMenu, setOpenMenu] = useState(/** @type {string|null} */ (null));

  const accountEntries = buildAccountEntries({
    signedIn,
    projectsPath,
    hasProfilePage,
    profilePath,
    settingsPath,
    subscriptionsPath,
    onSignOut,
    newUserPath,
    newSessionPath,
    navigate,
  });

  const menus = [
    {
      key: "account",
      label: "Account",
      icon: USER_ICON,
      entries: accountEntries,
    },
  ];

  const moveBetweenMenus = (from, direction) => {
    setOpenMenu(menus[(from + direction + menus.length) % menus.length].key);
  };

  return (
    <div
      role="menubar"
      aria-label="Account"
      className="flex items-center gap-1"
    >
      {menus.map((menu, index) => (
        <MenuDropdown
          key={menu.key}
          label={menu.label}
          icon={menu.icon}
          iconOnlyWhenCompact
          outlined
          entries={menu.entries}
          isOpen={openMenu === menu.key}
          onOpenChange={(open) => setOpenMenu(open ? menu.key : null)}
          menubarActive={openMenu !== null}
          onNavigate={(direction) => moveBetweenMenus(index, direction)}
          align="right"
        />
      ))}
    </div>
  );
}

export default AccountArea;
