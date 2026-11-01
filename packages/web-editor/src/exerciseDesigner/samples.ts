/**
 * A worked example of each exercise type, in the shape an exercise record
 * stores: the `<exercise>`'s children and its attributes. "Load sample" in the
 * designer reads one through `designFromSource`, so the samples also exercise
 * the parser. Most are adapted from the PreTeXt sample book's Runestone chapter.
 */
import type { ExerciseKind } from "./model";

export const EXERCISE_SAMPLES: Record<ExerciseKind, { attrs: Record<string, string>; source: string }> = {
  truefalse: {
    attrs: {},
    source: `
<statement correct="no">
  <p>Every vector space has finite dimension.</p>
</statement>
<feedback>
  <p>The vector space of all polynomials has the basis <m>B = \\{1, x, x^2, x^3, \\dots\\}</m>, which is infinite.</p>
</feedback>
<hint>
  <p><m>P_n</m>, the vector space of polynomials with degree at most <m>n</m>, has dimension <m>n+1</m>. What happens if you remove the parameter <m>n</m>?</p>
</hint>`,
  },
  multiplechoice: {
    attrs: {},
    source: `
<statement>
  <p>What color is a stop sign?</p>
</statement>
<choices randomize="yes">
  <choice>
    <statement><p>Green</p></statement>
    <feedback><p>Green means go!</p></feedback>
  </choice>
  <choice correct="yes">
    <statement><p>Red</p></statement>
    <feedback><p>Red is universally used for prohibited activities or serious warnings.</p></feedback>
  </choice>
  <choice>
    <statement><p>White</p></statement>
    <feedback><p>White might be hard to see.</p></feedback>
  </choice>
</choices>
<hint><p>What did you see last time you went driving?</p></hint>
<hint><p>Maybe go out for a drive?</p></hint>`,
  },
  parsons: {
    attrs: { language: "python", indentation: "hide", adaptive: "yes" },
    source: `
<statement>
  <p>Put the blocks in a valid order to compute and print the hypotenuse <c>c</c> of a right triangle with legs <c>a</c> and <c>b</c>. Several orders are correct. Use only the blocks you need.</p>
</statement>
<blocks>
  <block name="math"><cline>import math</cline></block>
  <block name="a"><cline>a = 3</cline></block>
  <block name="b">
    <choice correct="yes"><cline>b = 4</cline></choice>
    <choice><cline>4 = b</cline></choice>
  </block>
  <block name="cSq" depends="a b"><cline>cSquared = a ** 2 + b ** 2</cline></block>
  <block name="c" depends="cSq math"><cline>c = math.sqrt(cSquared)</cline></block>
  <block depends="c"><cline>print(c)</cline></block>
  <block correct="no"><cline>import antigravity</cline></block>
</blocks>`,
  },
  horizontalparsons: {
    attrs: { language: "sql" },
    source: `
<statement>
  <p>Form the SQL statement that selects every column of the table <c>test</c>.</p>
</statement>
<blocks layout="horizontal" randomize="yes">
  <block><c>SELECT</c></block>
  <block><c>*</c></block>
  <block><c>FROM</c></block>
  <block><c>test</c></block>
  <block correct="no"><c>DROP</c></block>
</blocks>`,
  },
  cardsort: {
    attrs: {},
    source: `
<statement>
  <p>Sort each expression by its value.</p>
</statement>
<cardsort>
  <match>
    <premise>2 + 3</premise>
    <premise>4 + 1</premise>
    <response>5</response>
  </match>
  <match>
    <premise><m>12 + 2</m></premise>
    <premise>7 + 7</premise>
    <response>14</response>
  </match>
</cardsort>`,
  },
  matching: {
    attrs: {},
    source: `
<statement>
  <p>Associate each playing card with every applicable property.</p>
</statement>
<matching>
  <premise ref="card-jack card-heart">Jack of Hearts</premise>
  <premise ref="card-ace card-spade">Ace of Spades</premise>
  <premise ref="card-queen card-diamond">Queen of Diamonds</premise>
  <response xml:id="card-ace">Ace</response>
  <response xml:id="card-queen">Queen</response>
  <response xml:id="card-jack">Jack</response>
  <response xml:id="card-heart">Heart</response>
  <response xml:id="card-diamond">Diamond</response>
  <response xml:id="card-spade">Spade</response>
</matching>`,
  },
  clickable: {
    attrs: {},
    source: `
<statement>
  <p>Select all of the nouns in this line from John Keats.</p>
</statement>
<areas>
  <p>A <area>thing</area> of <area>beauty</area> is a <area>joy</area> <area correct="no">forever</area>: its <area>loveliness</area> <area correct="no">increases</area>.</p>
</areas>
<feedback>
  <p>A noun names a person, place, thing, or idea.</p>
</feedback>`,
  },
  fillin: {
    attrs: {},
    source: `
<statement>
  <p>The sum of 2 and 2 is <fillin mode="number" answer="4" width="5"/>, which is spelled <fillin mode="string" answer="four" width="8"/>.</p>
</statement>
<evaluation>
  <evaluate>
    <test correct="yes">
      <numcmp use-answer="yes"/>
      <feedback><p>Right.</p></feedback>
    </test>
    <test>
      <numcmp value="22"/>
      <feedback><p>That is the two digits written side by side. Add them instead.</p></feedback>
    </test>
  </evaluate>
  <evaluate>
    <test correct="yes">
      <strcmp case="insensitive">four</strcmp>
    </test>
  </evaluate>
</evaluation>`,
  },
  coding: {
    attrs: {},
    source: `
<statement>
  <p>Fix the following code so that it always correctly adds two numbers.</p>
</statement>
<program language="python" interactive="activecode">
  <code>
  def add(a, b):
      return 4
  </code>
  <tests>
  from unittest.gui import TestCaseGui

  class myTests(TestCaseGui):
      def testOne(self):
          self.assertEqual(add(2, 2), 4, "Adding two identical integers")
          self.assertEqual(add(7, 13), 20, "Adding two different integers")
          self.assertAlmostEqual(add(2.0, 3.0), 5.0, 5, "Adding two decimal numbers")

  myTests().main()
  </tests>
</program>`,
  },
  shortanswer: {
    attrs: {},
    source: `
<statement>
  <p>Explain in your own words why the sum of two even numbers is always even.</p>
</statement>
<response/>
<solution>
  <p>Even numbers have the form <m>2m</m> and <m>2n</m>, so their sum is <m>2(m + n)</m>, which is even.</p>
</solution>`,
  },
};
