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
    project.update_column(:html_source, response.body)
  end
end
