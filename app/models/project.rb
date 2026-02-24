class Project < ApplicationRecord
  belongs_to :user

  before_save :set_html_source

  default_scope { order(updated_at: :desc) }

  private

  def set_html_source
    require "uri"
    require "net/http"
    # post self to build server
    params = {
      source: self.content,
      title: self.title,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    self.html_source = response.body
  end
end
