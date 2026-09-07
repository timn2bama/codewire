import { describe, expect, it } from "vitest";
import { escapeHtmlAttribute, escapeHtmlText } from "./htmlEscape.mjs";

describe("HTML escaping", () => {
  it("escapes markup-significant text characters", () => {
    expect(escapeHtmlText('Use <b class="live">A&B</b>')).toBe(
      'Use &lt;b class="live"&gt;A&amp;B&lt;/b&gt;',
    );
  });

  it("prevents quoted attributes from being terminated", () => {
    expect(escapeHtmlAttribute('value" onload="$&<script>' + "'" )).toBe(
      "value&quot; onload=&quot;$&amp;&lt;script&gt;&#39;",
    );
  });
});
