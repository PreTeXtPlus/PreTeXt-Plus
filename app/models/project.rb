class Project < ApplicationRecord
  belongs_to :user

  has_many :project_assets
  has_many :library_assets, through: :project_assets

  has_many :divisions
  belongs_to :root_division, class_name: "Division", optional: true

  enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true

  before_update :set_html_source

  default_scope { order(updated_at: :desc) }

  def root_division
    super || begin
      division = divisions.build
      division.set_default_source
      division.save!
      update_column(:root_division_id, division.id)
      division
    end
  end

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

  def to_h
    [ :title, :pretext_source, :docinfo, :use_common_docinfo, :common_docinfo ]
      .map { |attr| [ attr, self.send(attr) ] }.to_h
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
