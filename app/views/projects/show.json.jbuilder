json.partial! "projects/project", project: @project
# The spell checker's learned words. Only the editor wants them, so they ride on
# show rather than in the shared partial that index.json renders per project.
json.dictionary_words @project.dictionary_words
# The publication file this project's build settings resolve to (account defaults, then
# the project's own -- not any one output's), for the editor's live preview to render
# with: what a build's publication/publication.ptx holds. Here rather than in the
# partial, which the project index and the build's own assembler also render and neither
# has a use for it.
#
# Without the default logo, which is a file only a build's archive holds.
json.publication PublicationFileBuilder.for(@project, default_logo: false).to_xml
