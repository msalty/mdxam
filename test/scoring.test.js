import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreExam, selectAttemptQuestions, shuffle } from '../src/exam/scoring.js';

const exam = {
  questions: [
    { id: 'q-1', choices: [{ id: 'a', correct: true }, { id: 'b', correct: false }] },
    { id: 'q-2', choices: [{ id: 'c', correct: true }, { id: 'd', correct: true }, { id: 'e', correct: false }] },
    { id: 'q-3', choices: [{ id: 'f', correct: false }] }
  ]
};

test('scores exact single and multiple-choice selections', () => {
  const result = scoreExam(exam, { 'q-1': ['a'], 'q-2': ['c', 'd'], 'q-3': [] });
  assert.equal(result.score, 2);
  assert.equal(result.total, 2);
  assert.equal(result.percent, 100);
});

test('does not award partially correct multiple-choice answers', () => {
  const result = scoreExam(exam, { 'q-1': ['b'], 'q-2': ['c'] });
  assert.equal(result.score, 0);
  assert.equal(result.percent, 0);
});

test('shuffle can be deterministic for testing', () => {
  assert.deepEqual(shuffle([1, 2, 3], () => 0), [2, 3, 1]);
});

test('selects only the questions stored in a shortened attempt, in attempt order', () => {
  const selected = selectAttemptQuestions(exam, [{ questionId: 'q-2' }, { questionId: 'q-1' }]);
  assert.deepEqual(selected.map(question => question.id), ['q-2', 'q-1']);
  const result = scoreExam({ ...exam, questions: selected }, { 'q-1': ['a'], 'q-2': ['c', 'd'] });
  assert.equal(result.total, 2);
  assert.equal(result.percent, 100);
});
