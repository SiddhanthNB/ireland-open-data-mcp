import { describe, expect, it } from "vitest";

import { plainText } from "../../src/providers/ckan/text";

describe("CKAN plain-text normalization", () => {
  it("keeps visible text and removes markup, hidden content, and link targets", () => {
    const html = `
      <style>.hidden { display: none }</style>
      <p style="font-family: Calibri">Weather <strong>stations</strong></p>
      <script>sendPrivateData()</script>
      <p>Contact <a href="https://eur01.safelinks.protection.outlook.com/?url=mailto%3Aprivate%40example.ie">the team</a>.</p>
    `;

    expect(plainText(html)).toBe("Weather stations Contact the team.");
  });

  it("decodes common and numeric entities and collapses whitespace", () => {
    expect(
      plainText("Rain&nbsp;&amp; wind &#8211; &#x00C9;ireann &unknown;"),
    ).toBe("Rain & wind – Éireann &unknown;");
  });

  it("does not treat comparison text as markup", () => {
    expect(plainText("Rainfall < 5 mm > 2 mm")).toBe(
      "Rainfall < 5 mm > 2 mm",
    );
  });

  it("preserves literal placeholders and angle-bracket URLs", () => {
    expect(
      plainText(
        "Call get_dataset with <dataset_id>, then visit <https://example.ie>.",
      ),
    ).toBe(
      "Call get_dataset with <dataset_id>, then visit <https://example.ie>.",
    );
  });

  it("removes recognized Office tags but preserves unknown namespaced text", () => {
    expect(
      plainText("<o:p>Office text</o:p> <custom:value>literal</custom:value>"),
    ).toBe("Office text <custom:value>literal</custom:value>");
  });
});
