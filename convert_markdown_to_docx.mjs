import fs from 'node:fs';
import path from 'node:path';

// CRC32 Lookup Table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createZipBuffer(files) {
  const encoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
    lhView.setUint32(0, 0x04034b50, true);
    lhView.setUint16(4, 20, true);
    lhView.setUint16(6, 0, true);
    lhView.setUint16(8, 0, true);
    lhView.setUint16(10, 0, true);
    lhView.setUint16(12, 0, true);
    lhView.setUint32(14, crc, true);
    lhView.setUint32(18, size, true);
    lhView.setUint32(22, size, true);
    lhView.setUint16(26, nameBytes.length, true);
    lhView.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localHeaders.push(lh, dataBytes);

    // Central header (46 bytes + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chView = new DataView(ch.buffer, ch.byteOffset, ch.byteLength);
    chView.setUint32(0, 0x02014b50, true);
    chView.setUint16(4, 20, true);
    chView.setUint16(6, 20, true);
    chView.setUint16(8, 0, true);
    chView.setUint16(10, 0, true);
    chView.setUint16(12, 0, true);
    chView.setUint16(14, 0, true);
    chView.setUint32(16, crc, true);
    chView.setUint32(20, size, true);
    chView.setUint32(24, size, true);
    chView.setUint16(28, nameBytes.length, true);
    chView.setUint16(30, 0, true);
    chView.setUint16(32, 0, true);
    chView.setUint16(34, 0, true);
    chView.setUint16(36, 0, true);
    chView.setUint32(38, 0, true);
    chView.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    centralHeaders.push(ch);
    offset += lh.length + dataBytes.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirOffset, true);
  eocdView.setUint16(20, 0, true);

  const totalLen = offset + centralDirSize + 22;
  const finalBuf = new Uint8Array(totalLen);
  let cur = 0;
  for (const part of [...localHeaders, ...centralHeaders, eocd]) {
    finalBuf.set(part, cur);
    cur += part.length;
  }
  return Buffer.from(finalBuf);
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderRuns(text, baseRPr = '<w:sz w:val="22"/><w:color w:val="334155"/>') {
  if (!text) return '';
  // Support **bold** and *italic*
  const tokens = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', val: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push({ type: 'bold', val: token.slice(2, -2) });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      tokens.push({ type: 'italic', val: token.slice(1, -1) });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push({ type: 'code', val: token.slice(1, -1) });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', val: text.slice(lastIndex) });
  }

  let runsXml = '';
  for (const t of tokens) {
    const escaped = escapeXml(t.val);
    if (t.type === 'bold') {
      runsXml += `<w:r><w:rPr>${baseRPr}<w:b/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    } else if (t.type === 'italic') {
      runsXml += `<w:r><w:rPr>${baseRPr}<w:i/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    } else if (t.type === 'code') {
      runsXml += `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/><w:color w:val="475569"/><w:highlight w:val="lightGray"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    } else {
      runsXml += `<w:r><w:rPr>${baseRPr}</w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    }
  }
  return runsXml;
}

export function markdownToDocx(markdownText, documentTitle = 'Meeting Summary') {
  const lines = (markdownText || '').split(/\r?\n/);
  let bodyXml = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      bodyXml += '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>';
      continue;
    }

    if (line === '---' || line === '***' || line === '___') {
      bodyXml += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr><w:spacing w:before="140" w:after="140"/></w:pPr></w:p>`;
      continue;
    }

    // Heading 1 (# ...)
    if (line.startsWith('# ')) {
      const text = line.slice(2).trim();
      bodyXml += `<w:p><w:pPr><w:spacing w:before="260" w:after="140"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="0F172A"/></w:rPr></w:pPr>${renderRuns(text, '<w:b/><w:sz w:val="36"/><w:color w:val="0F172A"/>')}</w:p>`;
      continue;
    }

    // Heading 2 (## ...)
    if (line.startsWith('## ')) {
      const text = line.slice(3).trim();
      bodyXml += `<w:p><w:pPr><w:spacing w:before="220" w:after="100"/><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1E293B"/></w:rPr></w:pPr>${renderRuns(text, '<w:b/><w:sz w:val="28"/><w:color w:val="1E293B"/>')}</w:p>`;
      continue;
    }

    // Heading 3 (### ...)
    if (line.startsWith('### ')) {
      const text = line.slice(4).trim();
      bodyXml += `<w:p><w:pPr><w:spacing w:before="180" w:after="80"/><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="334155"/></w:rPr></w:pPr>${renderRuns(text, '<w:b/><w:sz w:val="24"/><w:color w:val="334155"/>')}</w:p>`;
      continue;
    }

    // Checkbox items (- [ ] or - [x])
    const checkboxMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[1].toLowerCase() === 'x';
      const itemText = checkboxMatch[2];
      const symbol = isChecked ? '☑ ' : '☐ ';
      const symbolColor = isChecked ? '10B981' : '64748B';

      bodyXml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/><w:color w:val="${symbolColor}"/><w:sz w:val="24"/><w:b/></w:rPr><w:t xml:space="preserve">${symbol} </w:t></w:r>${renderRuns(itemText, '<w:sz w:val="22"/><w:color w:val="1E293B"/>')}</w:p>`;
      continue;
    }

    // Bullet items (- or *)
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const itemText = line.slice(2).trim();
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="360"/><w:spacing w:after="70"/></w:pPr><w:r><w:rPr><w:color w:val="4F46E5"/><w:sz w:val="22"/><w:b/></w:rPr><w:t xml:space="preserve">•  </w:t></w:r>${renderRuns(itemText, '<w:sz w:val="22"/><w:color w:val="1E293B"/>')}</w:p>`;
      continue;
    }

    // Timestamp speaker lines, e.g., [00:00] Speaker 1: "..."
    const timestampMatch = line.match(/^(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*([^:]+):\s*(.*)$/);
    if (timestampMatch) {
      const ts = escapeXml(timestampMatch[1]);
      const speaker = escapeXml(timestampMatch[2]);
      const speech = timestampMatch[3];

      bodyXml += `<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>` +
        `<w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="20"/><w:b/></w:rPr><w:t xml:space="preserve">${ts} </w:t></w:r>` +
        `<w:r><w:rPr><w:color w:val="4338CA"/><w:sz w:val="22"/><w:b/></w:rPr><w:t xml:space="preserve">${speaker}: </w:t></w:r>` +
        `${renderRuns(speech, '<w:sz w:val="22"/><w:color w:val="334155"/>')}</w:p>`;
      continue;
    }

    // Regular paragraph
    bodyXml += `<w:p><w:pPr><w:spacing w:after="100"/></w:pPr>${renderRuns(line, '<w:sz w:val="22"/><w:color w:val="334155"/>')}</w:p>`;
  }

  const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '  <Default Extension="xml" ContentType="application/xml"/>\n' +
    '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n' +
    '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n' +
    '</Types>';

  const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
    '</Relationships>';

  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
    '  <w:docDefaults>\n' +
    '    <w:rPrDefault>\n' +
    '      <w:rPr>\n' +
    '        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>\n' +
    '        <w:sz w:val="22"/>\n' +
    '        <w:color w:val="334155"/>\n' +
    '      </w:rPr>\n' +
    '    </w:rPrDefault>\n' +
    '  </w:docDefaults>\n' +
    '</w:styles>';

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
    '  <w:body>\n' +
    bodyXml +
    '    <w:sectPr>\n' +
    '      <w:pgSz w:w="12240" w:h="15840"/>\n' +
    '      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>\n' +
    '    </w:sectPr>\n' +
    '  </w:body>\n' +
    '</w:document>';

  return createZipBuffer([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml }
  ]);
}

// CLI execution
const inputPath = process.argv[2] || 'c:/LOCAL_DISK_(D)/Projects/infotech_Meetings/Meeting_Summary_2026-09-22_bjp-gsuf-cvh.md';
const outputPath = process.argv[3] || inputPath.replace(/\.md$/i, '.docx');

console.log(`Reading: ${inputPath}`);
const mdContent = fs.readFileSync(inputPath, 'utf-8');
const docxBuffer = markdownToDocx(mdContent, path.basename(outputPath, '.docx'));
fs.writeFileSync(outputPath, docxBuffer);
console.log(`✅ Successfully generated DOCX at: ${outputPath} (${docxBuffer.length} bytes)`);
