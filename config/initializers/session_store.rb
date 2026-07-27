# The session cookie is deliberately host-only (no :domain option), so it is never sent
# to pub.pretext.plus, where published output -- user-authored HTML and JavaScript -- is
# served: a script running there carries no credentials toward the app origin, and with
# no CORS headers on our responses it cannot read anything either.
#
# The __Host- prefix closes the other direction. A subdomain may set a
# Domain=.pretext.plus cookie that shadows a parent-domain one (a session-fixation
# vector from the published origin), but browsers refuse to store a __Host- cookie that
# carries a Domain attribute at all, so ours cannot be overwritten from below.
#
# __Host- also requires Secure, so the prefix applies only in production, where
# force_ssl is on; development and test run over http and keep the default name.
# Renaming the cookie signs every existing production session out once at deploy.
Rails.application.config.session_store :cookie_store,
  key: Rails.env.production? ? "__Host-pretext_plus_session" : "_pretext_plus_session"
