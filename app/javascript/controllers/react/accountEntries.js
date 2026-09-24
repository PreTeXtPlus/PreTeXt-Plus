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
}) {
  return signedIn
    ? [
        {
          kind: "item",
          key: "projects",
          label: "Projects",
          onSelect: () => {
            window.location.href = projectsPath;
          },
        },
        { kind: "separator", key: "projects-sep" },
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
}
