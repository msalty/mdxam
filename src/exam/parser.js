const CHECKBOX = /^\s*-\s*\[([ xX])\]\s+(.+)$/;
const TITLE = /^#\s+(.+)$/;
const QUESTION = /^##\s+(.+)$/;
const TIME = /^Time:\s*(.+)$/i;

export function parseTime(value) {
  if (!value) return null;
  const parts = value.trim().split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, ...parts];
  if (minutes > 59 || seconds > 59 || hours < 0 || minutes < 0 || seconds < 0) return null;
  return (hours * 3600) + (minutes * 60) + seconds;
}

export function parseExamMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const exam = { title: '', time: null, timeText: '', questions: [], source: text };
  let current = null;
  let questionNumber = 0;

  const finishQuestion = () => {
    if (!current) return;
    current.explanation = current.explanationLines.join('\n').trim();
    delete current.explanationLines;
    exam.questions.push(current);
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const titleMatch = line.match(TITLE);
    const timeMatch = line.match(TIME);
    const questionMatch = line.match(QUESTION);
    const choiceMatch = rawLine.match(CHECKBOX);

    if (titleMatch && !exam.title) {
      exam.title = titleMatch[1].trim();
    } else if (timeMatch && !current) {
      exam.timeText = timeMatch[1].trim();
      exam.time = parseTime(exam.timeText);
    } else if (questionMatch) {
      finishQuestion();
      questionNumber += 1;
      current = {
        id: `q-${questionNumber}`,
        text: questionMatch[1].trim(),
        choices: [],
        explanationLines: []
      };
    } else if (choiceMatch && current) {
      const choiceNumber = current.choices.length + 1;
      current.choices.push({
        id: `${current.id}-c-${choiceNumber}`,
        text: choiceMatch[2].trim(),
        correct: choiceMatch[1].toLowerCase() === 'x'
      });
    } else if (current) {
      current.explanationLines.push(rawLine);
    }
  }

  finishQuestion();
  return exam;
}

export function validateExam(exam) {
  const errors = [];
  const warnings = [];

  if (!exam.title) errors.push('Add an H1 title, for example: # Biology Practice Exam');
  if (!exam.questions.length) errors.push('Add at least one question using an H2 heading (## Question).');
  if (exam.timeText && exam.time === null) errors.push('Time must use MM:SS or HH:MM:SS format.');

  exam.questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    if (!question.text) errors.push(`${label} has no question text.`);
    if (question.choices.length < 2) errors.push(`${label} needs at least two answer choices.`);
    if (!question.choices.some(choice => choice.correct)) warnings.push(`${label} has no marked correct answer and will be treated as ungraded.`);
    const normalized = question.choices.map(choice => choice.text.toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) warnings.push(`${label} contains duplicate answer choices.`);
  });

  return { valid: errors.length === 0, errors, warnings };
}

export function extractAssetNames(text) {
  const names = new Set();
  for (const match of String(text).matchAll(/!\[\[([^\]]+)\]\]/g)) names.add(match[1].trim());
  return [...names];
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
