const defaultContent: string = `

  <p>
    This is a paragraph.  It can contain <term>terms</term> and <em>emphasis</em>.
  </p>
  <fact>
  <p>
  This is a fact.
  </p>
  </fact>
  <corollary>
  <title>My Corollary</title>
  <p>
    This is a paragraph in a section.  It can contain <term>terms</term> and <em>emphasis</em>.
  </p>
  </corollary>
  <theorem>
  <title>My Theorem</title>
  <p>
    This is a paragraph in a section.  It can contain <term>terms</term> and <em>emphasis</em>.
  </p>
  </theorem>
  <p>Lemma text here</p>
  <p>Another paragraph</p>
  <p>
    Welcome to this very basic demo of editing PreTeXt.  First, a definition.
  </p>

  <conjecture>
  <title>Title of Conjecture</title>

  <p>
  A <term>conjecture</term> is somethign you hope is true.
  </p>
  <p> Another paragraph </p>

  </conjecture>

  <definition>
  <title>Title of Definition</title>

  <p>
  A <term>definition block</term> is a section of text that contains a definition.
  </p>
  <p> Another paragraph </p>

  </definition>

  <assumption>
  <title>Title of Assumption</title>

  <p>
  An <term>assumption</term> is something you assume.
  </p>

  </assumption>

  <ul>
    <li>
      That's a bullet list with one …
    </li>
    <li>
      … or two list items.
    </li>
  </ul>

  <p>
    Pretty neat, huh?  Oh yeah, and it can do some math: <m>\\int_1^2 x^2 dx = \\frac{7}{3}</m>.  I don't know if you can do display math though.  Perhaps <md>\\int_1^2 x^2 dx = \\frac{7}{3}</md> will work?
  </p>
  <theorem>
    <title>My Theorem</title>

    <p>This is a theorem</p>
    <p>Another paragraph</p>
  </theorem>

  <p> And that's the end of the demo.  Thanks for coming!</p>

  `;

const simpleContent: string = `
  <section>
  <title>My Section</title>
  <p>
    This is a paragraph.  It can contain <term>terms</term> and <em>emphasis</em>.
  </p>
  </section>
  `;

export { defaultContent, simpleContent };
