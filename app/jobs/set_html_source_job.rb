class SetHtmlSourceJob < ApplicationJob
  queue_as :default

  def perform(project)
    require "uri"
    require "net/http"

    params = {
      source: project.pretext_source,
      token: Rails.application.credentials.dig(:preview_build, :token)
    }
    response = Net::HTTP.post_form(URI.parse("https://#{Rails.application.credentials.dig(:preview_build, :host)}"), params)
    project.update_column(:html_source, response.body)
  end
end
