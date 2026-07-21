# Be sure to restart your server when you modify this file.

# Rails doesn't register `.wasm` out of the box, so ActionDispatch::Static
# falls back to a blank Content-Type when serving public/assets/libxslt.wasm
# (the @pretextbook/libxslt-wasm binary bundled by the web-editor's live
# preview). Browsers require an exact "application/wasm" Content-Type for
# WebAssembly.compileStreaming/instantiateStreaming, so without this the
# preview's streaming compile fails even once the file itself is served.
Mime::Type.register "application/wasm", :wasm
