import React, { useState } from "react";
import { MenuDropdown } from "@pretextbook/web-editor";

/**
 * Static help links, matching `app/views/layouts/_nav_dropdown.html.erb`'s
 * Help menu exactly (labels, targets, order).
 * @type {import("@pretextbook/web-editor").MenuEntry[]}
 */
const HELP_ENTRIES = [
  {
    kind: "item",
    key: "docs",
    label: "PreTeXt.Plus Documentation",
    onSelect: () => window.open("https://docs.pretext.plus", "_blank"),
  },
  {
    kind: "item",
    key: "guide",
    label: "PreTeXt Guide",
    onSelect: () =>
      window.open("https://pretextbook.org/doc/guide/html/", "_blank"),
  },
  {
    kind: "item",
    key: "sample",
    label: "PreTeXt Sample Article",
    onSelect: () =>
      window.open(
        "https://pretextbook.org/examples/sample-article/annotated/",
        "_blank",
      ),
  },
  {
    kind: "item",
    key: "support",
    label: "Email Support",
    onSelect: () => window.open("mailto:support@pretext.plus", "_blank"),
  },
];

/**
 * The Help and Account menus for the unified editor top bar, matching the
 * equivalent menus in `app/views/layouts/application.html.erb` — same links,
 * same signed-in/signed-out Account contents — built from the same
 * `MenuDropdown` primitive the File/Edit/Insert/Tools menus use, so all of
 * them share one look and one set of keyboard behaviors.
 *
 * @param {Object} props
 * @param {boolean} [props.signedIn] - Whether Help renders and Account shows the signed-in entries.
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
    ...(signedIn
      ? [{ key: "help", label: "Help", entries: HELP_ENTRIES }]
      : []),
    {
      key: "account",
      label: signedIn ? `Account (${userEmail})` : "Account",
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
