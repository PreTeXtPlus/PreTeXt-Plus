class Project < ApplicationRecord
  belongs_to :user
  before_save :build_html

  def build_html
    require "net/http"
    # post to https://build.pretext.plus/
    params = {
      source: self.content,
      title: self.title,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI("https://build.pretext.plus/"), params)
    if response.code == "200"
      self.update(html: response.body)
    else
      raise "Build failed with status code #{response.code}"
    end
  end
end
