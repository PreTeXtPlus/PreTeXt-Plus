class SetHtmlSourceJob < ApplicationJob
  queue_as :default

  def perform(project)
    require "uri"
    require "net/http"

    params = {
      source: project.pretext_source,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    # The build server writes bare `external/<id>.<ext>` image references; <base>
    # pins those at the public redirect (library_assets#share_file) so html_source
    # renders correctly on the /share page. update_column bypasses callbacks to
    # avoid re-triggering this job.
    project.update_column(:html_source, "<base href=\"/share_assets/\">#{response.body}")
  end
end
