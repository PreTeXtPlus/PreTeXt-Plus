import React, { useState } from "react";
import { MenuDropdown } from "@pretextbook/web-editor";
import { buildAccountEntries } from "./accountEntries";

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
  });

  const menus = [
    {
      key: "account",
      label: "Account",
      entries: accountEntries,
    },
  ];

  const navigate = (from, direction) => {
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
          entries={menu.entries}
          isOpen={openMenu === menu.key}
          onOpenChange={(open) => setOpenMenu(open ? menu.key : null)}
          menubarActive={openMenu !== null}
          onNavigate={(direction) => navigate(index, direction)}
          align="right"
        />
      ))}
    </div>
  );
}

export default AccountArea;
