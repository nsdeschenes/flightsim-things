const parserPrefix = 'XML Parse error:';
const skippedXml =
  /^(?<prefix>Skipped malformed unrelated XML in .+?: )(?:SyntaxError: )?(?<message>XML Parse error:.*)$/su;
const reasons: readonly Readonly<{pattern: RegExp; message: string}>[] = [
  {
    message: 'XML Parse error: Mismatched closing tag',
    pattern: /^XML Parse error: Expected closing tag /u,
  },
  {message: 'XML Parse error: Undeclared entity', pattern: /^XML Parse error: Entity /u},
  {
    message: "XML Parse error: Expected an attribute name, '>' or '/>' in the start tag",
    pattern: /^XML Parse error: Expected an attribute name/u,
  },
  {
    message: 'XML Parse error: Duplicate attribute',
    pattern: /^XML Parse error: Duplicate attribute /u,
  },
  {
    message: 'XML Parse error: Declared encoding does not match document bytes',
    pattern: /^XML Parse error: Document is not /u,
  },
  {
    message: 'XML Parse error: Only one root element is allowed',
    pattern: /^XML Parse error: Only one root element is allowed/u,
  },
  {
    message: 'Airport requires an explicit valid ident',
    pattern: /^Airport in [^\r\n]* requires an explicit valid ident$/u,
  },
  {
    message: 'Invalid explicit airport IATA code',
    pattern: /^Invalid explicit airport IATA code in /u,
  },
  {message: 'Duplicate airport ident', pattern: /^Duplicate airport ident in /u},
];

function safeXmlMessage(message: string): string {
  const skipped = skippedXml.exec(message);
  const groups = skipped && skipped.groups;
  if (groups && typeof groups.prefix === 'string' && typeof groups.message === 'string') {
    return groups.prefix + safeXmlMessage(groups.message);
  }

  for (const reason of reasons) {
    if (reason.pattern.test(message)) {
      return reason.message;
    }
  }

  if (message.startsWith(parserPrefix)) {
    return 'XML Parse error: XML parsing failed';
  }

  return message;
}

export default safeXmlMessage;
