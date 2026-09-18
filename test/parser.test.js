import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAssetNames, parseExamMarkdown, parseTime, validateExam } from '../src/exam/parser.js';

const source = `# Sample Exam
Time: 00:10:00

## Which answer is correct? ![[diagram.png]]
- [ ] No
- [x] Yes

The explanation is preserved.
`;

test('parses title, time, questions, choices, and explanations', () => {
  const exam = parseExamMarkdown(source);
  assert.equal(exam.title, 'Sample Exam');
  assert.equal(exam.time, 600);
  assert.equal(exam.questions.length, 1);
  assert.equal(exam.questions[0].choices[1].correct, true);
  assert.equal(exam.questions[0].explanation, 'The explanation is preserved.');
});

test('validates malformed exams', () => {
  const validation = validateExam(parseExamMarkdown('# Empty'));
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /question/i);
});

test('parses supported durations and rejects invalid values', () => {
  assert.equal(parseTime('15:30'), 930);
  assert.equal(parseTime('01:02:03'), 3723);
  assert.equal(parseTime('00:80:00'), null);
});

test('collects unique Obsidian-style image references', () => {
  assert.deepEqual(extractAssetNames('![[a.png]] ![[a.png]] ![[b.jpg]]'), ['a.png', 'b.jpg']);
});
