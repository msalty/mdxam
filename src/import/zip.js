const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const IMAGE_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
  ['webp', 'image/webp'], ['svg', 'image/svg+xml'], ['avif', 'image/avif'], ['bmp', 'image/bmp']
]);

function extension(name) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function baseName(name) {
  return name.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || '';
}

function findEndRecord(view) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('The ZIP directory could not be found. The file may be damaged.');
}

async function inflateRaw(bytes, expectedSize) {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('This browser cannot decompress ZIP files. Try a current browser or upload the files directly.');
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedSize || total > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error('Expanded ZIP data exceeded its declared size.');
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch {
    throw new Error('A compressed ZIP entry could not be decompressed.');
  }
}

async function readEntry(buffer, entry) {
  const view = new DataView(buffer);
  if (view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE) throw new Error(`Invalid ZIP entry: ${entry.name}`);
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (start < 0 || end > buffer.byteLength) throw new Error(`Incomplete ZIP entry: ${entry.name}`);
  const compressed = new Uint8Array(buffer, start, entry.compressedSize);
  const output = entry.method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed, entry.uncompressedSize);
  if (output.byteLength !== entry.uncompressedSize) throw new Error(`ZIP entry size did not match: ${entry.name}`);
  return output;
}

export async function readExamZip(file) {
  if (!file || !/\.zip$/i.test(file.name)) throw new Error('Choose a .zip file.');
  if (file.size > MAX_TOTAL_BYTES) throw new Error('The ZIP file is larger than 50 MB.');
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const eocd = findEndRecord(view);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (!entryCount || entryCount > MAX_ENTRIES) throw new Error(`ZIP archives must contain between 1 and ${MAX_ENTRIES} files.`);

  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let offset = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error('The ZIP directory is invalid.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = decoder.decode(new Uint8Array(buffer, nameStart, nameLength)).replace(/\\/g, '/');
    offset = nameStart + nameLength + extraLength + commentLength;

    if (flags & 1) throw new Error('Password-protected ZIP files are not supported.');
    if (![0, 8].includes(method)) throw new Error(`“${name}” uses an unsupported ZIP compression method.`);
    if (uncompressedSize > MAX_FILE_BYTES) throw new Error(`“${name}” is larger than 20 MB.`);
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('The expanded ZIP contents are larger than 50 MB.');
    if (name && !name.endsWith('/') && !name.includes('__MACOSX/') && !baseName(name).startsWith('.')) {
      entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    }
  }

  const markdownEntries = entries.filter(entry => ['md', 'markdown', 'txt'].includes(extension(entry.name)));
  if (markdownEntries.length !== 1) {
    throw new Error(markdownEntries.length
      ? `The ZIP contains ${markdownEntries.length} Markdown/text files. Include exactly one exam.`
      : 'The ZIP does not contain a Markdown exam.');
  }

  const markdownBytes = await readEntry(buffer, markdownEntries[0]);
  const source = decoder.decode(markdownBytes);
  const imageEntries = entries.filter(entry => IMAGE_TYPES.has(extension(entry.name)));
  const seenNames = new Set();
  const images = [];
  for (const entry of imageEntries) {
    const name = baseName(entry.name);
    const normalized = name.toLocaleLowerCase();
    if (seenNames.has(normalized)) throw new Error(`The ZIP contains more than one image named “${name}”. Rename one of them.`);
    seenNames.add(normalized);
    const bytes = await readEntry(buffer, entry);
    images.push(new File([bytes], name, { type: IMAGE_TYPES.get(extension(name)) }));
  }

  return { source, images, markdownName: baseName(markdownEntries[0].name), ignoredCount: entries.length - markdownEntries.length - imageEntries.length };
}
