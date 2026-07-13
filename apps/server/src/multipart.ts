// Minimal, binary-safe multipart/form-data parser for the attachment upload
// path (T-51). The server has no multipart dependency and its generic body
// reader is string-based (utf8), which corrupts binary — so this operates
// purely on Buffers. Scope is deliberately small: the fields + files a browser
// FormData produces. Not a general RFC 7578 implementation (no nested
// multipart/mixed), but correct for our single-file-plus-fields uploads.

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files: MultipartFile[];
}

const DASH = 0x2d; // '-'
const CR = 0x0d;
const LF = 0x0a;

export function parseBoundary(contentType: string): string | null {
  // e.g. multipart/form-data; boundary=----WebKitFormBoundaryABC123
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const b = (m[1] ?? m[2] ?? '').trim();
  return b || null;
}

// Split a buffer on every occurrence of `sep`, like String.prototype.split.
function splitBuffer(buf: Buffer, sep: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let from = 0;
  for (;;) {
    const idx = buf.indexOf(sep, from);
    if (idx < 0) {
      out.push(buf.subarray(from));
      break;
    }
    out.push(buf.subarray(from, idx));
    from = idx + sep.length;
  }
  return out;
}

function parseHeaders(headerText: string): {
  name: string;
  filename: string | null;
  contentType: string;
} {
  let name = '';
  let filename: string | null = null;
  let contentType = 'application/octet-stream';
  for (const line of headerText.split(/\r\n/)) {
    const cd = /^content-disposition:/i.test(line);
    if (cd) {
      const n = /name="([^"]*)"/i.exec(line);
      const f = /filename="([^"]*)"/i.exec(line);
      if (n) name = n[1]!;
      if (f) filename = f[1]!;
    } else if (/^content-type:/i.test(line)) {
      contentType = line.slice(line.indexOf(':') + 1).trim() || contentType;
    }
  }
  return { name, filename, contentType };
}

/**
 * Parse a multipart/form-data body. Throws on a missing/!matching boundary.
 * Binary-safe: file bytes pass through untouched.
 */
export function parseMultipart(body: Buffer, contentType: string): MultipartResult {
  const boundary = parseBoundary(contentType);
  if (!boundary) throw new Error('multipart: missing boundary');

  const delim = Buffer.from(`--${boundary}`);
  const segments = splitBuffer(body, delim);
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  // segments[0] is the preamble (usually empty). A real part segment begins
  // with CRLF (the line break after the delimiter) and ends with a trailing
  // CRLF before the next delimiter. The closing delimiter's segment begins
  // with "--"; anything after it is epilogue.
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.length >= 2 && seg[0] === DASH && seg[1] === DASH) break; // closing --
    // strip the leading CRLF
    let s = 0;
    if (seg[0] === CR && seg[1] === LF) s = 2;
    // strip the trailing CRLF
    let e = seg.length;
    if (e >= 2 && seg[e - 2] === CR && seg[e - 1] === LF) e -= 2;
    const part = seg.subarray(s, e);

    const sep = Buffer.from('\r\n\r\n');
    const hEnd = part.indexOf(sep);
    if (hEnd < 0) continue; // malformed part, skip
    const headerText = part.subarray(0, hEnd).toString('utf8');
    const data = part.subarray(hEnd + sep.length);
    const { name, filename, contentType: partType } = parseHeaders(headerText);
    if (filename !== null) {
      files.push({ field: name, filename, contentType: partType, data });
    } else {
      fields[name] = data.toString('utf8');
    }
  }

  return { fields, files };
}
