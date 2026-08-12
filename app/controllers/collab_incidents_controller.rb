# Where the editor reports collaboration failures it can see but the server cannot.
#
# Every *other* part of a collaborative session is ordinary HTTP on the primary
# database -- joining (ProjectDocsController#show), seeding, compaction, autosave --
# and all of it keeps working when the live relay dies. The relay itself is
# ActionCable over solid_cable against a separate database, and a client whose
# updates stop being broadcast looks, from here, exactly like a client that is
# simply idle. Nothing raises, nothing 500s, and the first anyone hears of it is a
# user saying "my collaborator can't see my edits" -- which is how the August 2026
# outage was found.
#
# So the browser is the only witness, and this is where it testifies. There is no
# JavaScript Honeybadger in this app; reports come here and are notified from Ruby,
# which also keeps the API key out of the bundle.
class CollabIncidentsController < ApplicationController
  # What a client is allowed to report. Anything else is a bug or a forgery, and
  # either way must not become a new error class in Honeybadger: the point of a
  # fixed list is that these are alertable *because* they are few and known.
  #
  # `relay_recovered` is reported so a stall can be read as an episode with an end
  # rather than an open question. It is the one kind here that is not itself a
  # problem, so mute it in Honeybadger if it turns out to be noisy -- but read it
  # first, because a stall that never recovers means the process stayed wedged,
  # which is the case that needs a restart.
  KINDS = %w[ join_failed relay_stalled relay_recovered ].freeze

  # Free text from the browser (an exception message, usually). Bounded because it
  # is written into an error tracker, and an unbounded field pointed at an error
  # tracker is a way to lose the signal.
  MAX_DETAIL_LENGTH = 500

  # Generous enough that a session in real trouble reports its stall, its recovery
  # and a couple of relapses, tight enough that a client stuck in a report loop
  # cannot turn Honeybadger into a firehose. The watchdog already reports each
  # episode once (see yCableProvider), so hitting this at all means something is
  # wrong with the reporting, and dropping those is the right outcome.
  rate_limit to: 10, within: 10.minutes, only: :create, with: -> { head :too_many_requests }

  def create
    kind = params[:kind].to_s
    return head :unprocessable_entity unless KINDS.include?(kind)

    project = Project.find_by(id: params[:project_id])
    # The report is *about* a collaborative session, so it is only meaningful from
    # someone who could be in one. This also keeps the project ids that reach
    # Honeybadger to ones the reporter genuinely has, so context can be trusted
    # while investigating.
    return head :forbidden unless project && current_ability.can?(:update, project)

    report(kind, project)
    head :accepted
  end

  private

    def report(kind, project)
      context = {
        project_id: project.id,
        user_id: current_user.id,
        kind: kind,
        detail: params[:detail].to_s.truncate(MAX_DETAIL_LENGTH).presence,
        # How long the relay had been silent (relay_stalled) or was silent before it
        # came back (relay_recovered), in seconds. The difference between "a blip
        # during a deploy" and "this process has been deaf for an hour".
        silent_for_seconds: params[:silent_for_seconds].presence&.to_i,
        user_agent: request.user_agent
      }.compact

      # One error class per kind, so alerting can be set per failure rather than on
      # one bucket that mixes "could not join" with "recovered".
      Honeybadger.notify(
        "Collaborative editing: #{kind.humanize.downcase}",
        error_class: "Collab::#{kind.camelize}",
        context: context
      )

      Rails.logger.warn("[collab-incident] #{context.to_json}")
    end
end
