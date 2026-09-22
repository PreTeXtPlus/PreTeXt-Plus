import React, { useState } from "react";
import { MenuDropdown } from "@pretextbook/web-editor";

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
  hasProfilePage,
  profilePath,
  settingsPath,
  subscriptionsPath,
  onSignOut,
  newUserPath,
  newSessionPath,
}) {
  const [openMenu, setOpenMenu] = useState(/** @type {string|null} */ (null));

  const accountEntries = signedIn
    ? [
        ...(hasProfilePage
          ? [
              {
                kind: "item",
                key: "profile",
                label: "Public Profile",
                onSelect: () => {
                  window.location.href = profilePath;
                },
              },
            ]
          : []),
        {
          kind: "item",
          key: "settings",
          label: "Settings",
          onSelect: () => {
            window.location.href = settingsPath;
          },
        },
        {
          kind: "item",
          key: "subscriptions",
          label: "Manage Subscriptions",
          onSelect: () => {
            window.location.href = subscriptionsPath;
          },
        },
        {
          kind: "item",
          key: "sign-out",
          label: "Sign out",
          onSelect: () => onSignOut?.(),
        },
      ]
    : [
        {
          kind: "item",
          key: "create-account",
          label: "Create account",
          onSelect: () => {
            window.location.href = newUserPath;
          },
        },
        {
          kind: "item",
          key: "sign-in",
          label: "Sign in",
          onSelect: () => {
            window.location.href = newSessionPath;
          },
        },
      ];

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
        />
      ))}
    </div>
  );
}

export default AccountArea;
