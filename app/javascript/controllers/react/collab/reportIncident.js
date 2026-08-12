/**
 * Reports a collaboration failure to the server, which forwards it to
 * Honeybadger (see CollabIncidentsController).
 *
 * There is no JavaScript error tracker in this app, and the failures worth
 * knowing about here are ones the server cannot see for itself: a client that
 * never joined, or one whose relay went quiet while every HTTP request it makes
 * keeps succeeding. Both look like an idle user from the server's side.
 *
 * Never throws and never rejects. Every caller is already on a failure path, and
 * an error reporter that can itself fail is a way to turn a degraded session
 * into a broken one. `keepalive` so a report sent as the tab goes away still
 * gets out.
 *
 * @param {Object} incident
 * @param {"join_failed"|"relay_stalled"|"relay_recovered"} incident.kind
 * @param {string} incident.projectId
 * @param {string} [incident.csrfToken]
 * @param {string} [incident.detail] Free text, truncated server-side.
 * @param {number} [incident.silentForSeconds] How long the relay was quiet.
 * @returns {Promise<void>}
 */
export async function reportCollabIncident({
  kind,
  projectId,
  csrfToken,
  detail,
  silentForSeconds,
}) {
  try {
    await fetch("/collab_incidents", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        kind,
        project_id: projectId,
        detail,
        silent_for_seconds: silentForSeconds,
      }),
    });
  } catch {
    // Reporting is best-effort by construction: if the network is down badly
    // enough that this fails, the session has larger problems and the user is
    // already being told about them.
  }
}
