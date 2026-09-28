/**
 * Builds the Account menu's entries — same content for the standalone
 * "Account" dropdown (`AccountArea.jsx`) and for folding into the File menu
 * on small viewports (`TopBar`'s `accountMenuEntries` prop), so both stay in
 * sync from one source.
 *
 * @param {Object} props
 * @param {boolean} [props.signedIn]
 * @param {string} [props.projectsPath] - Signed-in only.
 * @param {boolean} [props.hasProfilePage]
 * @param {string} [props.profilePath]
 * @param {string} [props.settingsPath]
 * @param {string} [props.subscriptionsPath]
 * @param {() => void} [props.onSignOut]
 * @param {string} [props.newUserPath] - Signed-out only.
 * @param {string} [props.newSessionPath] - Signed-out only.
 * @param {(path: string) => void} [props.navigate] - Follows an entry's link.
 *   Defaults to a plain page load; the editor passes one that saves first.
 * @returns {import("@pretextbook/web-editor").MenuEntry[]}
 */
export function buildAccountEntries({
  signedIn,
  projectsPath,
  hasProfilePage,
  profilePath,
  settingsPath,
  subscriptionsPath,
  onSignOut,
  newUserPath,
  newSessionPath,
  navigate = (path) => {
    window.location.href = path;
  },
}) {
  return signedIn
    ? [
        {
          kind: "item",
          key: "projects",
          label: "Projects",
          onSelect: () => navigate(projectsPath),
        },
        { kind: "separator", key: "projects-sep" },
        ...(hasProfilePage
          ? [
              {
                kind: "item",
                key: "profile",
                label: "Public Profile",
                onSelect: () => navigate(profilePath),
              },
            ]
          : []),
        {
          kind: "item",
          key: "settings",
          label: "Settings",
          onSelect: () => navigate(settingsPath),
        },
        {
          kind: "item",
          key: "subscriptions",
          label: "Manage Subscriptions",
          onSelect: () => navigate(subscriptionsPath),
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
          onSelect: () => navigate(newUserPath),
        },
        {
          kind: "item",
          key: "sign-in",
          label: "Sign in",
          onSelect: () => navigate(newSessionPath),
        },
      ];
}
