/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import {
  deliverIframePages,
  geogebraMaterialUrl,
  IFRAME_PAGE_SANDBOX,
  markIframePages,
  prepareIframePages,
  type DeliveredIframePages,
} from '../components/iframePages'
import { parsePreviewPage, patchPreviewPage } from '../components/wasmPreview'

// The iframes as pretext-html 0.20.0 emits them for a JSXGraph interactive, a
// Desmos one and a YouTube video, and a page shaped like the renderer's.
const JSX_IFRAME =
  '<iframe id="jsx1" style="width:360px; height:360px; display: block; " src="jsx1-if.html">'
const DESMOS_IFRAME =
  '<iframe src="https://www.desmos.com/calculator/jvnxfq0n4e" id="des" style="width:480px; height:360px; display: block; ">'
const PAGE =
  '<!DOCTYPE html>\n<html lang="en-US"><head><script src="external/board.js"></script></head>' +
  '<body><img src="generated/prefigure/graph.svg"><script>var a = "<b>" && 1;</script></body></html>\n'

const pageOf = (body: string) =>
  `<!DOCTYPE html><html><head><title>t</title></head><body><section id="s">${body}</section></body></html>`

describe('markIframePages', () => {
  it('takes the src off an iframe that names a page, and sandboxes it', () => {
    const html = markIframePages(`${JSX_IFRAME}</iframe>`, { 'jsx1-if.html': PAGE })
    expect(html).not.toContain('src=')
    expect(html).toContain('data-ptx-iframe-page="jsx1-if.html"')
    expect(html).toContain(`sandbox="${IFRAME_PAGE_SANDBOX}"`)
    expect(html).toContain('id="jsx1"')
    // The page's text stays out of the HTML the patcher diffs.
    expect(html).not.toContain('board.js')
  })

  it('never grants same-origin, whatever the markup asked for', () => {
    const html = markIframePages(
      '<iframe sandbox="allow-scripts allow-same-origin" src="jsx1-if.html">',
      { 'jsx1-if.html': PAGE },
    )
    expect(html).not.toContain('allow-same-origin')
    expect(html.match(/sandbox=/g)).toHaveLength(1)
  })

  it('leaves iframes onto a service, and pages it was not given, alone', () => {
    const html = `${JSX_IFRAME}</iframe>${DESMOS_IFRAME}</iframe>`
    expect(markIframePages(html, {})).toBe(html)
    expect(markIframePages(html, { 'other-if.html': PAGE })).toBe(html)
    expect(markIframePages(html, { 'jsx1-if.html': PAGE })).toContain(DESMOS_IFRAME)
  })

  it('is not fooled by a page named like an Object member', () => {
    const html = '<iframe src="constructor">'
    expect(markIframePages(html, { 'jsx1-if.html': PAGE })).toBe(html)
  })
})

// The page pretext-html 0.20.0 writes for `<interactive geogebra="jybewqhg"/>`.
const GEOGEBRA_PAGE =
  '<!DOCTYPE html>\n<html><head><script src="https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-chtml.js"></script>' +
  '<script type="text/javascript" src="https://cdn.geogebra.org/apps/deployggb.js"></script></head>' +
  '<body class="ptx-content ignore-math"><div style="aspect-ratio: 1.33;"><script>var ggb_gg__ggb__slate_params = {\n' +
  'material_id:"jybewqhg",\nwidth:800,\nheight:600,\n};\n' +
  'new Promise((resolve, reject) => {\nvar ggb_gg__ggb__slate = new GGBApplet(ggb_gg__ggb__slate_params, true);\n' +
  "resolve(ggb_gg__ggb__slate);})\n.then((ggb_gg__ggb__slate) => {\nwindow.onload = function() { ggb_gg__ggb__slate.inject('gg-ggb-slate-container'); }\n},\n" +
  "(error) => {console.log('GGB applet load failure.', error)});\n" +
  '</script><div class="geogebra-applet" id="gg-ggb-slate-container"></div></div></body></html>\n'

describe('a GeoGebra material', () => {
  it('is framed from geogebra.org rather than run in the sandbox', () => {
    expect(geogebraMaterialUrl(GEOGEBRA_PAGE)).toBe('https://www.geogebra.org/material/iframe/id/jybewqhg')
    const html = markIframePages('<iframe id="gg" style="width:480px" src="gg-if.html">', { 'gg-if.html': GEOGEBRA_PAGE })
    expect(html).toBe('<iframe id="gg" style="width:480px" src="https://www.geogebra.org/material/iframe/id/jybewqhg">')
  })

  it('keeps its own page when there is more to it than the material', () => {
    expect(geogebraMaterialUrl(PAGE)).toBeUndefined()
    // An author's script beside the applet.
    expect(geogebraMaterialUrl(GEOGEBRA_PAGE.replace('</body>', '<script src="external/extra.js"></script></body>'))).toBeUndefined()
    // Applet parameters beyond the material id.
    expect(geogebraMaterialUrl(GEOGEBRA_PAGE.replace('height:600,', 'height:600,\nappletOnLoad:f,'))).toBeUndefined()
    // An id that is not one.
    expect(geogebraMaterialUrl(GEOGEBRA_PAGE.replace('jybewqhg', 'a/../b'))).toBeUndefined()
  })
})

describe('prepareIframePages', () => {
  it('returns the same object when there is nothing to do', () => {
    const pages = { 'jsx1-if.html': PAGE }
    expect(prepareIframePages(pages)).toBe(pages)
    const none = {}
    expect(prepareIframePages(none, { baseUrl: 'https://x.test/projects/1/edit' })).toBe(none)
  })

  it('puts a base first in the head and rewrites generated images', () => {
    const prepared = prepareIframePages(
      { 'jsx1-if.html': PAGE },
      {
        baseUrl: 'https://x.test/projects/1/edit?a=1&b="2"',
        generatedImageUrl: (element, label) => `/stored/${element}/${label}`,
      },
    )['jsx1-if.html']
    expect(prepared).toContain(
      '<head><base href="https://x.test/projects/1/edit?a=1&amp;b=&quot;2&quot;"><script src="external/board.js">',
    )
    expect(prepared).toContain('<img src="/stored/prefigure/graph">')
  })
})

describe('deliverIframePages', () => {
  const live = (html: string) => new DOMParser().parseFromString(html, 'text/html')

  it('sets the page as srcdoc, once per iframe and page text', () => {
    const pages = { 'jsx1-if.html': PAGE }
    const doc = live(pageOf(markIframePages(`${JSX_IFRAME}</iframe>${DESMOS_IFRAME}</iframe>`, pages)))
    const delivered: DeliveredIframePages = new WeakMap()
    expect(deliverIframePages(doc, pages, delivered)).toBe(1)
    const iframe = doc.getElementById('jsx1')!
    expect(iframe.getAttribute('srcdoc')).toBe(PAGE)
    expect(iframe.getAttribute('sandbox')).toBe(IFRAME_PAGE_SANDBOX)
    expect(doc.getElementById('des')!.hasAttribute('srcdoc')).toBe(false)

    // Unchanged: not reloaded.
    expect(deliverIframePages(doc, pages, delivered)).toBe(0)
    // Changed: reloaded.
    const edited = { 'jsx1-if.html': PAGE.replace('1;', '2;') }
    expect(deliverIframePages(doc, edited, delivered)).toBe(1)
    expect(iframe.getAttribute('srcdoc')).toBe(edited['jsx1-if.html'])
  })

  it('restores a sandbox that went missing before running the page', () => {
    const pages = { 'jsx1-if.html': PAGE }
    const doc = live(pageOf('<iframe id="jsx1" data-ptx-iframe-page="jsx1-if.html" src="x"></iframe>'))
    deliverIframePages(doc, pages, new WeakMap())
    const iframe = doc.getElementById('jsx1')!
    expect(iframe.getAttribute('sandbox')).toBe(IFRAME_PAGE_SANDBOX)
    expect(iframe.hasAttribute('src')).toBe(false)
  })

  it('leaves an iframe whose page the render no longer has', () => {
    const doc = live(pageOf('<iframe id="jsx1" data-ptx-iframe-page="gone-if.html"></iframe>'))
    expect(deliverIframePages(doc, { 'jsx1-if.html': PAGE }, new WeakMap())).toBe(0)
  })
})

describe('the live patcher and a running interactive', () => {
  const pages = { 'jsx1-if.html': PAGE }
  const render = (text: string) =>
    pageOf(`<p id="p1">${text}</p><figure id="f">${markIframePages(`${JSX_IFRAME}</iframe>`, pages)}</figure>`)

  it('keeps the iframe, and its page, when only the text around it changed', () => {
    const before = render('one')
    document.open()
    document.write(before)
    document.close()
    const delivered: DeliveredIframePages = new WeakMap()
    deliverIframePages(document, pages, delivered)
    const iframe = document.getElementById('jsx1')!

    const patched = patchPreviewPage(window, parsePreviewPage(before), parsePreviewPage(render('two')))
    expect(patched).toBe(true)
    expect(document.getElementById('p1')!.textContent).toBe('two')
    expect(document.getElementById('jsx1')).toBe(iframe)
    expect(iframe.getAttribute('srcdoc')).toBe(PAGE)
    expect(deliverIframePages(document, pages, delivered)).toBe(0)
  })
})
