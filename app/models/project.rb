class Project < ApplicationRecord
  belongs_to :user

  has_many :project_assets
  has_many :library_assets, through: :project_assets

  belongs_to :root_division, class_name: "Division", optional: true
  accepts_nested_attributes_for :root_division

  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  before_destroy -> { update_column(:root_division_id, nil) }
  has_many :divisions, dependent: :destroy
  before_update :set_html_source

  default_scope { order(updated_at: :desc) }

  def effective_docinfo
    if use_common_docinfo? && user&.common_docinfo.present?
      user.common_docinfo
    else
      docinfo
    end
  end

  def self.default_docinfo
    DEFAULT_DOCINFO
  end

  def set_default_docinfo
    self.docinfo = DEFAULT_DOCINFO
  end

  def common_docinfo
    user.common_docinfo
  end

  DEFAULT_DOCINFO = File.read Rails.root.join("app", "default_docs", "docinfo.xml")

  private

  def set_html_source
    require "uri"
    require "net/http"
    # For LaTeX projects, use the editor-converted PreTeXt body.
    params = {
      source: pretext_source,
      token: ENV["BUILD_TOKEN"]
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)
    self.html_source = response.body
  end
end
