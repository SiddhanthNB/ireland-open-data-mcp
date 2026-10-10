const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const HIDDEN_ELEMENTS = new Set(["script", "style"]);

const HTML_ELEMENTS = new Set([
  "a",
  "abbr",
  "acronym",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "font",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "menu",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "param",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "section",
  "select",
  "small",
  "slot",
  "source",
  "span",
  "strike",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "tt",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

const OFFICE_ELEMENT_PATTERN = /^(?:m|o|v|w|x):[a-z][a-z0-9._-]*$/u;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  lt: "<",
  gt: ">",
};

interface HtmlTag {
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

export function plainText(value: string): string {
  let output = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] !== "<") {
      const nextTag = value.indexOf("<", index);
      const end = nextTag === -1 ? value.length : nextTag;
      output += value.slice(index, end);
      index = end;
      continue;
    }

    if (value.startsWith("<!--", index)) {
      const commentEnd = value.indexOf("-->", index + 4);
      index = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }
    if (value.startsWith("<!", index) || value.startsWith("<?", index)) {
      const declarationEnd = value.indexOf(">", index + 2);
      index = declarationEnd === -1 ? value.length : declarationEnd + 1;
      continue;
    }

    const tag = parseTag(value, index);
    if (!tag) {
      output += "<";
      index += 1;
      continue;
    }
    if (!isRecognizedElement(tag.name)) {
      output += value.slice(index, tag.end);
      index = tag.end;
      continue;
    }

    if (!tag.closing && !tag.selfClosing && HIDDEN_ELEMENTS.has(tag.name)) {
      index = hiddenElementEnd(value, tag.name, tag.end);
      continue;
    }

    if (BLOCK_ELEMENTS.has(tag.name)) {
      output += " ";
    }
    index = tag.end;
  }

  return decodeEntities(output).replace(/\s+/gu, " ").trim();
}

function isRecognizedElement(name: string): boolean {
  return HTML_ELEMENTS.has(name) || OFFICE_ELEMENT_PATTERN.test(name);
}

function parseTag(value: string, start: number): HtmlTag | undefined {
  let cursor = start + 1;
  let closing = false;
  if (value[cursor] === "/") {
    closing = true;
    cursor += 1;
  }

  while (isWhitespace(value[cursor])) {
    cursor += 1;
  }
  const nameStart = cursor;
  if (!isTagNameStart(value[cursor])) {
    return undefined;
  }
  while (isTagNameCharacter(value[cursor])) {
    cursor += 1;
  }
  if (cursor === nameStart) {
    return undefined;
  }

  const name = value.slice(nameStart, cursor).toLowerCase();
  let quote: string | undefined;
  for (; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      const beforeClose = value.slice(start, cursor).trimEnd();
      return {
        end: cursor + 1,
        name,
        closing,
        selfClosing: beforeClose.endsWith("/"),
      };
    }
  }
  return undefined;
}

function hiddenElementEnd(value: string, name: string, start: number): number {
  const lowerValue = value.toLowerCase();
  let closingStart = lowerValue.indexOf(`</${name}`, start);
  while (closingStart !== -1) {
    const closingTag = parseTag(value, closingStart);
    if (closingTag?.closing && closingTag.name === name) {
      return closingTag.end;
    }
    closingStart = lowerValue.indexOf(`</${name}`, closingStart + 2);
  }
  return value.length;
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/giu,
    (
      entity,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal !== undefined || hexadecimal !== undefined) {
        const codePoint = Number.parseInt(
          decimal ?? hexadecimal!,
          hexadecimal ? 16 : 10,
        );
        return isValidCodePoint(codePoint)
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return NAMED_ENTITIES[named!.toLowerCase()] ?? entity;
    },
  );
}

function isValidCodePoint(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value > 0 &&
    value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff)
  );
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/u.test(value);
}

function isTagNameCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9:-]/iu.test(value);
}

function isTagNameStart(value: string | undefined): boolean {
  return value !== undefined && /[a-z]/iu.test(value);
}
