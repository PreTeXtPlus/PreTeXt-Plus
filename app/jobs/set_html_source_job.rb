class SetHtmlSourceJob < ApplicationJob
  queue_as :default

  def perform(project)
    require "uri"
    require "net/http"

    params = {
      source: project.pretext_source,
      token: Rails.app.creds.require(:preview_build, :token)
    }
    response = Net::HTTP.post_form(URI.parse("https://#{Rails.app.creds.require(:preview_build, :host)}"), params)
    project.update_column(:html_source, response.body)
  end
end
