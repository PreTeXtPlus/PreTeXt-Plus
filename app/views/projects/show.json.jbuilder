json.partial! "projects/project", project: @project
# The spell checker's learned words. Only the editor wants them, so they ride on
# show rather than in the shared partial that index.json renders per project.
json.dictionary_words @project.dictionary_words
