import test from 'node:test';
import assert from 'node:assert/strict';
import { readExamZip } from '../src/import/zip.js';

function little(value, bytes) {
  return Array.from({ length: bytes }, (_, index) => (value >>> (index * 8)) & 0xff);
}

function storedZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof value === 'string' ? encoder.encode(value) : value;
    const local = new Uint8Array([
      ...little(0x04034b50, 4), ...little(20, 2), ...little(0, 2), ...little(0, 2),
      ...little(0, 2), ...little(0, 2), ...little(0, 4), ...little(data.length, 4),
      ...little(data.length, 4), ...little(nameBytes.length, 2), ...little(0, 2), ...nameBytes, ...data
    ]);
    localParts.push(local);
    centralParts.push(new Uint8Array([
      ...little(0x02014b50, 4), ...little(20, 2), ...little(20, 2), ...little(0, 2), ...little(0, 2),
      ...little(0, 2), ...little(0, 2), ...little(0, 4), ...little(data.length, 4), ...little(data.length, 4),
      ...little(nameBytes.length, 2), ...little(0, 2), ...little(0, 2), ...little(0, 2), ...little(0, 2),
      ...little(0, 4), ...little(localOffset, 4), ...nameBytes
    ]));
    localOffset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    ...little(0x06054b50, 4), ...little(0, 2), ...little(0, 2), ...little(centralParts.length, 2),
    ...little(centralParts.length, 2), ...little(centralSize, 4), ...little(localOffset, 4), ...little(0, 2)
  ]);
  return new File([...localParts, ...centralParts, end], 'exam.zip', { type: 'application/zip' });
}

test('reads one Markdown exam and flattens nested image paths', async () => {
  const file = storedZip({
    'study/exam.md': '# ZIP Exam\n\n## Image? ![[diagram.png]]\n- [x] Yes\n- [ ] No',
    'study/images/diagram.png': new Uint8Array([137, 80, 78, 71]),
    'study/notes.csv': 'ignored'
  });
  const archive = await readExamZip(file);
  assert.equal(archive.markdownName, 'exam.md');
  assert.match(archive.source, /ZIP Exam/);
  assert.equal(archive.images[0].name, 'diagram.png');
  assert.equal(archive.ignoredCount, 1);
});

test('rejects archives with multiple Markdown files', async () => {
  const file = storedZip({ 'one.md': '# One', 'two.txt': '# Two' });
  await assert.rejects(() => readExamZip(file), /exactly one exam/);
});

test('rejects duplicate flattened image names', async () => {
  const file = storedZip({ 'exam.md': '# Exam', 'a/photo.png': new Uint8Array([1]), 'b/photo.png': new Uint8Array([2]) });
  await assert.rejects(() => readExamZip(file), /more than one image/);
});
