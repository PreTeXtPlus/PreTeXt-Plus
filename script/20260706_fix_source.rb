module UpdateSourceForRootDivisions
  def self.up
    Division.where(is_root: true, source_format: "latex").find_each do |division|
      lines = division.source.split("\n")
      if lines.first.strip.start_with?("\\section")
        lines[0] = "\\article{#{division.project.title}}\\label{#{division.ref}}"
        division.update!(source: lines.join("\n"))
      end
    end
    Division.where(is_root: true, source_format: "markdown").find_each do |division|
      lines = division.source.split("\n")
      unless lines.first.strip.start_with?("---")
        lines = [
          "---",
          "division: article",
          "id: #{division.ref}",
          "title: #{division.project.title}",
          "---",
          "" ] + lines
        division.update!(source: lines.join("\n"))
      end
    end
  end
  def self.down
    Division.where(is_root: true, source_format: "latex").find_each do |division|
      lines = division.source.split("\n")
      if lines.first.strip.start_with?("\\article")
        lines[0] = "\\section{#{division.project.title}}"
        division.update!(source: lines.join("\n"))
      end
    end
    Division.where(is_root: true, source_format: "markdown").find_each do |division|
      lines = division.source.split("\n")
      if lines.first.strip.start_with?("---")
        second_dashes = lines.each_with_index.find { |line, index| line.strip == "---" && index != 0 }
        lines = lines[(second_dashes[1] + 1)..-1] if second_dashes
        division.update!(source: lines.join("\n"))
      end
    end
  end
end
