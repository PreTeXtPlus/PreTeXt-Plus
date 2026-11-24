require "test_helper"

class Publication::DocumentTest < ActiveSupport::TestCase
  def document(xml, subscriber: true)
    Publication::Document.new(xml, subscriber:)
  end

  def messages(issues)
    issues.map(&:to_s).join("\n")
  end

  test "elements, attributes and leaf text are read into paths" do
    result = document(<<~XML)
      <publication>
        <latex font-size="12">
          <page right-alignment="ragged"><geometry>a5paper, margin=2cm</geometry></page>
        </latex>
      </publication>
    XML

    assert result.valid?, messages(result.errors)
    assert_equal({ "font-size" => "12" }, result.paths[%w[ latex ]][:attributes])
    assert_equal "ragged", result.value_at(%w[ latex page ], "right-alignment")
    assert_equal "a5paper, margin=2cm", result.value_at(%w[ latex page geometry ], nil)
    assert_nil result.value_at(%w[ html ], "theme")
  end

  test "an empty overlay is valid and sets nothing" do
    [ "", "   \n", "<publication/>" ].each do |xml|
      assert document(xml).valid?
      assert_empty document(xml).paths
    end
  end

  # ---- refused: the level keeps what it had ----

  test "XML that is not well formed is refused, with the line" do
    result = document("<publication>\n<latex>\n</publication>")

    assert_not result.valid?
    assert_match(/not well-formed/, messages(result.errors))
    assert result.errors.first.line
  end

  # An entity declared in a DOCTYPE is how a file on the server ends up in a document.
  # Nokogiri does not expand it unless asked, but nothing about a publication file needs a
  # DOCTYPE, so it is refused rather than reasoned about.
  test "a DOCTYPE is refused" do
    result = document(%(<!DOCTYPE p [<!ENTITY e SYSTEM "file:///etc/passwd">]><publication>&e;</publication>))

    assert_not result.valid?
    assert_match(/DOCTYPE/, messages(result.errors))
  end

  test "anything namespaced is refused, which is what keeps xi:include out" do
    [
      %(<publication xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="/etc/passwd"/></publication>),
      %(<publication><latex xmlns="urn:x"/></publication>),
      %(<publication><latex xml:lang="en"/></publication>)
    ].each do |xml|
      assert_not document(xml).valid?, xml
      assert_match(/namespace/, messages(document(xml).errors))
    end
  end

  test "the root must be <publication>" do
    assert_not document("<pretext/>").valid?
    assert_not document("<publication theme='x'/>").valid?
  end

  test "text beside child elements is refused" do
    result = document("<publication><latex>stray<page/></latex></publication>")

    assert_not result.valid?
    assert_match(/both text and elements/, messages(result.errors))
  end

  # PreTeXt resolves these against the external directory, so a path would let a build
  # read whatever is beside the project into its output.
  #
  # A CLI project's publication file names them by a path into its external directory, as
  # the Guide's samples do, so the folders are dropped rather than the file refused.
  test "a file reference with folders is read as its bare filename, with a warning" do
    { "images/cover.pdf" => "cover.pdf", "../secret.pdf" => "secret.pdf",
      "/srv/a/b/cover.pdf" => "cover.pdf", 'images\\cover.pdf' => "cover.pdf" }.each do |value, filename|
      result = document(%(<publication><latex><cover front="#{value}"/></latex></publication>))

      assert result.valid?, value
      assert_equal filename, result.value_at(%w[ latex cover ], "front")
      assert_match(/front on <cover> is read as #{Regexp.escape(filename)}/, messages(result.warnings))
    end

    assert_empty document(%(<publication><latex><cover front="cover.pdf"/></latex></publication>)).warnings
  end

  test "a file reference with no usable filename is refused" do
    [ "/etc/passwd", "images/", "my cover.pdf", "..", "" ].each do |value|
      result = document(%(<publication><latex><cover front="#{value}"/></latex></publication>))

      assert_not result.valid?, value
      assert_match(/must name a file in this project's assets/, messages(result.errors))
    end
  end

  test "a file reference is checked against the project's assets" do
    xml = ->(source) { %(<publication><html><brandlogo source="#{source}"/></html></publication>) }
    assets = Set["diagram.png", "cover.pdf"]

    assert_empty Publication::Document.new(xml["diagram.png"], asset_names: assets).warnings

    missing = Publication::Document.new(xml["logo.png"], asset_names: assets)
    assert missing.valid?
    assert_match(/names logo.png, but this project has no asset by that name yet.*Upload one with the Reference ID logo/,
                 messages(missing.warnings))

    # The asset is there, under the extension its content type gave it.
    other = Publication::Document.new(xml["diagram.jpg"], asset_names: assets)
    assert_match(/The asset with Reference ID diagram is diagram.png; use that name instead/, messages(other.warnings))

    # No project to check against.
    assert_empty Publication::Document.new(xml["logo.png"], asset_names: nil).warnings
  end

  test "a pasted CLI logo path finds the project's asset, and an account's is not checked" do
    project = projects(:one)
    project.update!(publication_xml: %(<publication><html><brandlogo source="images/diagram.png"/></html></publication>))

    document = project.reload.publication_document
    assert_equal "diagram.png", document.value_at(%w[ html brandlogo ], "source")
    assert_equal 1, document.warnings.size, messages(document.warnings)
    assert_match(/read as diagram.png/, messages(document.warnings))

    project.user.update!(publication_xml: %(<publication><html><brandlogo source="logo.png"/></html></publication>))
    assert_empty project.user.reload.publication_document.warnings
  end

  test "an overlay over the size limit is refused" do
    xml = "<publication><!-- #{'x' * Publication::Document::MAX_LENGTH} --></publication>"

    assert_not document(xml).valid?
  end

  test "an invalid overlay contributes nothing, not half of itself" do
    result = document(%(<publication><html><css theme="salem"/></html><latex><cover front="../x"/></latex></publication>))

    assert_empty result.paths
  end

  # ---- managed: saved, warned about, left out of the build ----

  test "the paths PreTeXt.Plus manages are dropped with a warning" do
    result = document(<<~XML)
      <publication>
        <source customizations="../../etc/x.xml">
          <directories external="/" generated="/tmp"/>
          <version include="instructor"/>
        </source>
        <html><resources host="local"/></html>
        <webwork server="https://ww.example.edu" pg-location="/opt/pg"/>
      </publication>
    XML

    assert result.valid?
    assert_nil result.paths[%w[ source directories ]]
    assert_nil result.paths[%w[ html resources ]]
    assert_empty result.paths[%w[ source ]][:attributes]
    assert_equal "instructor", result.value_at(%w[ source version ], "include"),
                 "source/version is the one part of <source> an author may set"
    assert_equal({ "server" => "https://ww.example.edu" }, result.paths[%w[ webwork ]][:attributes])
    assert_equal 4, result.warnings.size, messages(result.warnings)
  end

  test "a logo is dropped for an account without subscriber benefits" do
    xml = %(<publication><html><brandlogo source="mine.png"/></html></publication>)

    assert_equal "mine.png", document(xml, subscriber: true).value_at(%w[ html brandlogo ], "source")
    assert_nil document(xml, subscriber: false).value_at(%w[ html brandlogo ], "source")
    assert_match(/subscription/, messages(document(xml, subscriber: false).warnings))
  end

  # ---- unknown: saved and passed through, with a warning ----

  test "names and values PreTeXt does not read are warned about and kept" do
    result = document(<<~XML)
      <publication>
        <html><navigation logic="sideways" colour="red"/></html>
        <lateks/>
      </publication>
    XML

    assert result.valid?
    text = messages(result.warnings)
    assert_match(/should be one of linear, tree/, text)
    assert_match(/does not read colour/, text)
    assert_match(%r{does not read <lateks>}, text)
    assert_equal "sideways", result.value_at(%w[ html navigation ], "logic")
  end

  # html/css/@theme is looked up through a template, which the schema generator's literal
  # scan cannot see -- the catalog's own paths are merged in so it is not a false alarm.
  test "an attribute the modal itself writes is never warned about" do
    assert_empty document(%(<publication><html><css theme="salem"/></html></publication>)).warnings
  end

  # Theme options are read by name through get-theme-option, and which ones apply depends
  # on the theme: default-modern takes primary-color, salem and denver take color-main and
  # friends. All of them are PreTeXt's, so none is a typo.
  test "the color options of every HTML theme are not warned about" do
    [
      %(<css theme="default-modern" palette="blue-green" primary-color="#123456"
             secondary-color="rgb(1,2,3)" primary-color-dark="hsl(0,50%,50%)"/>),
      %(<css theme="denver" palette="ice-fire" color-main="#a00" color-do="#0a0"
             color-fact="#00a" color-meta="#555" primary-color-dark="#eee"/>),
      %(<css theme="tacoma" primary-color="teal" provide-dark-mode="no"/>),
      %(<css theme="custom" entry-point="my-theme.scss"/>)
    ].each do |css|
      result = document("<publication><html>#{css}</html></publication>")
      assert_empty result.warnings, messages(result.warnings)
    end
  end

  test "a color option the chosen theme does not read is warned about and kept" do
    result = document(%(<publication><html><css theme="denver" primary-color="#123" color-main="#456"/></html></publication>))

    assert result.valid?
    assert_equal 1, result.warnings.size, messages(result.warnings)
    assert_match(/primary-color on <css> is read only by the default-modern, tacoma, greeley, and boulder themes, so the denver theme ignores it/,
                 messages(result.warnings))
    assert_equal "#123", result.value_at(%w[ html css ], "primary-color")
  end

  test "with no theme chosen anywhere, options are checked against default-modern" do
    result = document(%(<publication><html><css color-main="#456" palette="blues"/></html></publication>))

    assert_equal 1, result.warnings.size, messages(result.warnings)
    assert_match(/read only by the denver and salem themes, so the default-modern theme, which is used when no theme is chosen, ignores it/,
                 messages(result.warnings))
  end

  test "with no theme chosen here, options are checked against the theme from the level above" do
    xml = %(<publication><html><css color-main="#456" primary-color="#123"/></html></publication>)
    result = Publication::Document.new(xml, theme_above: [ "salem", "your account" ])

    assert_equal 1, result.warnings.size, messages(result.warnings)
    assert_match(/primary-color .* so the salem theme \(from your account\) ignores it/, messages(result.warnings))

    # This level's own choice wins over the one above.
    own = %(<publication><html><css theme="tacoma" primary-color="#123"/></html></publication>)
    assert_empty Publication::Document.new(own, theme_above: [ "salem", "your account" ]).warnings
  end

  test "themes whose options cannot be known are not checked" do
    [
      %(<css theme="custom" entry-point="mine.scss" color-main="#456" primary-color="#123"/>),
      %(<css style="wide" primary-color="#123"/>),
      %(<css theme="somebody-elses" primary-color="#123"/>)
    ].each do |css|
      result = document("<publication><html>#{css}</html></publication>")
      assert_empty result.warnings, messages(result.warnings)
    end

    legacy_above = [ Publication::Document::LEGACY_THEME, "your account" ]
    xml = %(<publication><html><css primary-color="#123"/></html></publication>)
    assert_empty Publication::Document.new(xml, theme_above: legacy_above).warnings
  end

  test "a level is checked against the theme an account chooses" do
    project = projects(:one)
    project.user.update!(publication_xml: %(<publication><html><css theme="denver"/></html></publication>))
    project.update!(publication_xml: %(<publication><html><css color-main="#456" primary-color="#123"/></html></publication>))

    warnings = messages(project.reload.publication_document.warnings)
    assert_match(/primary-color .* so the denver theme \(from your account\) ignores it/, warnings)
    assert_no_match(/color-main/, warnings)
  end

  test "a repeated element is merged, with a warning" do
    result = document(%(<publication><latex print="yes"/><latex sides="two"/></publication>))

    assert_equal({ "print" => "yes", "sides" => "two" }, result.paths[%w[ latex ]][:attributes])
    assert_match(/more than once/, messages(result.warnings))
  end

  # ---- stored on a level ----

  test "a level refuses XML that would be refused, and keeps what it had" do
    project = projects(:one)
    project.update!(publication_xml: %(<publication><latex print="yes"/></publication>))

    project.publication_xml = "<publication><latex>"
    assert_not project.valid?
    assert project.errors[:publication_xml].any?
  end

  test "whitespace is stored as nothing" do
    project = projects(:one)
    project.update!(publication_xml: "  \n ")

    assert_nil project.reload.publication_xml
  end

  # ---- written by the modal ----

  # What the migration from the old jsonb column relies on, and what makes the modal an
  # editor rather than a second store: writing settings and reading them back is lossless,
  # for one value of every option the catalog has.
  test "every catalog option survives being written to XML and read back" do
    settings = Publication::Catalog.all.to_h do |option|
      value = if option.free_number? then option.choices.min.to_s
      elsif option.choices == Publication::Catalog::LENGTH then "1.5in"
      elsif option.choices == Publication::Catalog::LINK_URL then "https://example.edu"
      elsif option.free_text? then "solutions"
      elsif option.project_scoped? then "cover.pdf"
      else option.values.last
      end
      [ option.key, value ]
    end

    xml = Publication::Document.write(nil, settings)
    document = Publication::Document.new(xml)

    assert document.valid?, messages(document.errors)
    assert_empty document.warnings, messages(document.warnings)
    assert_equal settings, document.settings
  end

  test "taking a setting out removes what it leaves hollow, and nothing else" do
    xml = %(<publication><html><css theme="salem"/><knowl/></html><latex print="yes"/></publication>)

    result = Publication::Document.write(xml, "theme" => "", "latex_print" => nil)

    assert_no_match(/css|latex/, result)
    assert_match(%r{<knowl/>}, result, "an empty element the author wrote is theirs")
  end

  test "a repeated element cannot quietly undo a written attribute" do
    xml = %(<publication><latex print="no"/><latex print="no" sides="two"/></publication>)

    result = Publication::Document.new(Publication::Document.write(xml, "latex_print" => "yes"))

    assert_equal "yes", result.settings["latex_print"]
    assert_equal "two", result.settings["latex_sides"]
  end

  test "text that will not parse is returned as it was" do
    assert_equal "<publication><latex>", Publication::Document.write("<publication><latex>", "theme" => "salem")
  end

  # A pasted publication.ptx usually opens with a comment block; changing one setting in
  # the modal should not cost the author it.
  test "comments outside <publication> survive a write" do
    xml = %(<?xml version="1.0" encoding="UTF-8"?>\n<!-- header -->\n<publication>\n  <!-- inner -->\n  <latex print="no"/>\n</publication>\n<!-- footer -->\n)

    result = Publication::Document.write(xml, "latex_print" => "yes")

    assert_match(/\A<!-- header -->\n<publication>/, result)
    assert_match(/<!-- inner -->/, result)
    assert_match(/<!-- footer -->\z/, result)
    assert_equal "yes", Publication::Document.new(result).settings["latex_print"]
  end
end
