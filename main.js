import { extractAssetNames, formatDuration, parseExamMarkdown, validateExam } from './src/exam/parser.js';
import { createQuestionOrder, scoreExam, selectAttemptQuestions } from './src/exam/scoring.js';
import { readExamZip } from './src/import/zip.js';
import {
  backfillExamVersions, createBackup, deleteAttempts, deleteExamAndData, getAssets, getAttempts, getExam, getExamVersion, getSetting,
  listAttempts, listExams, migrateLegacyResults, openDatabase, restoreBackup, saveAttempt, saveExam, setSetting
} from './src/storage/database.js';
import { clear, confirmAction, element, pageHeader, renderRichText, scoreChart, showToast } from './src/ui/dom.js';

const content = document.getElementById('content');
const SESSION_KEY = 'mdxam-active-session-v2';
const state = {
  exam: null,
  examRecord: null,
  session: null,
  timerId: null,
  assetUrls: new Map(),
  importDraft: null,
  editorDraft: null,
  selectedAttempt: null,
  deferredInstall: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    await openDatabase();
    await migrateLegacyResults();
    await backfillExamVersions();
    await repairSubsetAttemptScores();
    applyTheme(await getSetting('theme', 'system'));
    bindShell();
    registerServiceWorker();
    configureInstallPrompt();
    configureFileHandling();
    consumeShareTarget();
    await route();
  } catch (error) {
    console.error(error);
    clear(content).append(
      pageHeader('MDXam could not start', 'Your data has not been changed.'),
      element('div', { className: 'notice notice-error', text: error.message })
    );
  }
}

function bindShell() {
  window.addEventListener('hashchange', route);
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();
}

function updateConnectionStatus() {
  const indicator = document.getElementById('connectionStatus');
  indicator.textContent = navigator.onLine ? 'Online' : 'Offline';
  indicator.classList.toggle('offline', !navigator.onLine);
}

async function route() {
  stopTimer();
  revokeAssetUrls();
  const routeParts = location.hash.slice(1).split('/');
  const requestedRoute = (routeParts[0] || 'exams').toLowerCase();
  const routeName = requestedRoute === 'results' ? 'exams' : requestedRoute;
  if (requestedRoute === 'results') history.replaceState({}, '', '#exams');
  document.body.classList.toggle('exam-mode', routeName === 'exam');
  document.querySelectorAll('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === routeName));
  content.setAttribute('aria-busy', 'true');
  try {
    if (routeName === 'import') renderImport();
    else if (routeName === 'settings') await renderSettings();
    else if (routeName === 'editor') await renderEditor(decodeURIComponent(routeParts.slice(1).join('/')));
    else if (routeName === 'exam') await resumeSession(true);
    else if (routeName === 'review') {
      const attemptId = decodeURIComponent(routeParts.slice(1).join('/'));
      const attempt = state.selectedAttempt?.id === attemptId
        ? state.selectedAttempt
        : (await listAttempts()).find(item => item.id === attemptId);
      if (attempt) await renderReview(attempt);
      else navigate('exams');
    }
    else if (routeName === 'exams') await renderExamLibrary(decodeURIComponent(routeParts.slice(1).join('/')));
    else navigate('exams');
  } catch (error) {
    console.error(error);
    clear(content).append(element('div', { className: 'notice notice-error', text: `Something went wrong: ${error.message}` }));
  } finally {
    content.setAttribute('aria-busy', 'false');
    content.focus({ preventScroll: true });
  }
}

function navigate(name) {
  if (location.hash === `#${name}`) route();
  else location.hash = name;
}

async function renderExamLibrary(expandedExamId = '') {
  const [exams, attempts] = await Promise.all([listExams(), listAttempts()]);
  const savedSession = readSession();
  clear(content).append(pageHeader('Your exams', 'Private, local, and ready whenever you are.',
    element('a', { className: 'button', href: '#import', text: 'Add exam' })));

  if (savedSession) {
    const exam = await getExam(savedSession.examId);
    if (exam) {
      const resume = element('div', { className: 'notice' }, [
        element('strong', { text: `Continue “${exam.title}”? ` }),
        element('span', { text: `${Object.keys(savedSession.answers || {}).length} question(s) answered. ` }),
        element('button', { className: 'button button-small', text: 'Resume', onclick: () => resumeSession() }),
        ' ',
        element('button', { className: 'button button-small button-ghost', text: 'Discard', onclick: () => {
          localStorage.removeItem(SESSION_KEY);
          renderExamLibrary();
        } })
      ]);
      content.append(resume);
    } else localStorage.removeItem(SESSION_KEY);
  }

  if (!exams.length) {
    content.append(element('section', { className: 'empty-state' }, [
      element('h2', { text: 'Bring your first study guide' }),
      element('p', { className: 'muted', text: 'Import a Markdown file and MDXam will validate it before creating the exam.' }),
      element('a', { className: 'button', href: '#import', text: 'Add an exam' })
    ]));
    return;
  }

  const grid = element('div', { className: 'exam-grid' });
  for (const exam of exams) {
    const examAttempts = attempts
      .filter(attempt => String(attempt.examId) === String(exam.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const expanded = String(expandedExamId) === String(exam.id) && examAttempts.length > 0;
    const parsed = parseExamMarkdown(exam.source);
    const card = element('article', { className: 'card exam-card' }, [
      element('h2', { text: exam.title }),
      element('div', { className: 'metadata' }, [
        element('span', { text: `${parsed.questions.length} questions` }),
        parsed.time ? element('span', { text: formatDuration(parsed.time) }) : element('span', { text: 'Untimed' })
      ])
    ]);
    const actions = element('div', { className: 'card-actions' }, [
      element('button', { className: 'button', text: 'Start exam', onclick: () => configureExamStart(exam.id) }),
      element('button', {
        className: 'button button-ghost',
        text: `${expanded ? 'Hide history' : 'History'} (${examAttempts.length})`,
        disabled: examAttempts.length === 0,
        'aria-expanded': String(expanded),
        onclick: () => navigate(expanded ? 'exams' : `exams/${encodeURIComponent(exam.id)}`)
      }),
      element('button', { className: 'button button-ghost', text: 'Edit', onclick: () => navigate(`editor/${encodeURIComponent(exam.id)}`) }),
      element('button', { className: 'button button-ghost', text: 'Delete', onclick: async () => {
        const confirmed = await confirmAction({ title: 'Delete exam?', message: `“${exam.title}”, its images, and all its results will be permanently removed.`, confirmLabel: 'Delete' });
        if (!confirmed) return;
        await deleteExamAndData(exam.id);
        if (readSession()?.examId === exam.id) localStorage.removeItem(SESSION_KEY);
        showToast('Exam and related data deleted.');
        renderExamLibrary();
      } })
    ]);
    card.append(actions);
    const entry = element('div', { className: `exam-entry${expanded ? ' expanded' : ''}` }, [card]);
    if (expanded) entry.append(renderExamHistory(exam, examAttempts));
    grid.append(entry);
  }
  content.append(grid);
}

function renderExamHistory(exam, attempts) {
  const latest = attempts.at(-1);
  const section = element('section', { className: 'card exam-history', 'aria-label': `Results for ${exam.title}` });
  section.append(element('div', { className: 'result-summary' }, [
    element('div', { className: 'score-chip', text: `${latest.percent}%` }),
    element('div', { className: 'result-summary-text' }, [
      element('h2', { text: 'Attempt history' }),
      element('p', { className: 'muted', text: `${attempts.length} attempt${attempts.length === 1 ? '' : 's'} · latest ${new Date(latest.createdAt).toLocaleDateString()}` })
    ]),
    element('button', { className: 'button button-small button-ghost', text: 'Delete history', onclick: async () => {
      const confirmed = await confirmAction({ title: 'Delete result history?', message: 'All attempts for this exam will be permanently removed.', confirmLabel: 'Delete results' });
      if (!confirmed) return;
      await deleteAttempts(exam.id);
      showToast('Result history deleted.');
      navigate('exams');
    } })
  ]));
  section.append(scoreChart(attempts));
  const tbody = element('tbody');
  attempts.slice().reverse().forEach((attempt, index) => {
    tbody.append(element('tr', {}, [
      element('td', { text: attempts.length - index }),
      element('td', { text: `${attempt.percent}% (${attempt.score}/${attempt.total})` }),
      element('td', { text: new Date(attempt.createdAt).toLocaleString() }),
      element('td', {}, element('button', { className: 'button button-small button-ghost', text: 'Review', onclick: () => {
        state.selectedAttempt = attempt;
        navigate(`review/${encodeURIComponent(attempt.id)}`);
      } }))
    ]));
  });
  section.append(element('div', { className: 'table-wrap' }, element('table', {}, [
    element('thead', {}, element('tr', {}, ['Attempt', 'Score', 'Date', ''].map(label => element('th', { text: label })))), tbody
  ])));
  return section;
}

async function configureExamStart(examId) {
  const record = await getExam(examId);
  if (!record) return showToast('That exam could not be found.');
  const exam = parseExamMarkdown(record.source);
  const validation = validateExam(exam);
  if (!validation.valid) {
    showToast('This exam needs corrections before it can be started.');
    return navigate(`editor/${encodeURIComponent(examId)}`);
  }
  const dialog = document.getElementById('startExamDialog');
  const input = document.getElementById('questionCount');
  document.getElementById('startExamDescription').textContent = `${exam.title} contains ${exam.questions.length} questions.`;
  input.max = String(exam.questions.length);
  input.value = String(exam.questions.length);
  dialog.showModal();
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'start') return;
    const count = Math.max(1, Math.min(exam.questions.length, Number.parseInt(input.value, 10) || exam.questions.length));
    startExam(examId, count);
  }, { once: true });
}

async function startExam(examId, questionCount) {
  const record = await getExam(examId);
  if (!record) return showToast('That exam could not be found.');
  const exam = parseExamMarkdown(record.source);
  const validation = validateExam(exam);
  if (!validation.valid) {
    showToast('This exam needs corrections before it can be started.');
    state.importDraft = { record, exam, validation, assets: [] };
    return navigate('import');
  }
  const startedAt = Date.now();
  state.session = {
    version: 2,
    examId,
    startedAt,
    deadline: exam.time ? startedAt + exam.time * 1000 : null,
    order: createQuestionOrder(exam).slice(0, questionCount || exam.questions.length),
    answers: {},
    flags: [],
    currentIndex: 0
  };
  persistSession();
  await loadExamState(record, exam);
  navigate('exam');
}

async function resumeSession(fromRoute = false) {
  const session = readSession();
  if (!session) {
    if (fromRoute) navigate('exams');
    return;
  }
  const record = await getExam(session.examId);
  if (!record) {
    localStorage.removeItem(SESSION_KEY);
    showToast('The exam for that session no longer exists.');
    navigate('exams');
    return;
  }
  state.session = session;
  await loadExamState(record, parseExamMarkdown(record.source));
  if (!fromRoute) navigate('exam');
  else renderExamQuestion();
}

async function loadExamState(record, exam) {
  revokeAssetUrls();
  state.examRecord = record;
  state.exam = exam;
  const assets = await getAssets(record.id);
  for (const asset of assets) state.assetUrls.set(asset.name, URL.createObjectURL(asset.blob));
}

function renderExamQuestion() {
  const { exam, session } = state;
  if (!exam || !session) return navigate('exams');
  if (session.deadline && Date.now() >= session.deadline) return submitExam(true);

  const ordered = session.order[session.currentIndex];
  const question = exam.questions.find(item => item.id === ordered.questionId);
  const choices = ordered.choiceIds.map(id => question.choices.find(choice => choice.id === id));
  const selected = new Set(session.answers[question.id] || []);
  const answerType = question.choices.filter(choice => choice.correct).length === 1 ? 'radio' : 'checkbox';
  const answeredCount = Object.values(session.answers).filter(answer => answer.length).length;
  const progress = ((session.currentIndex + 1) / session.order.length) * 100;

  clear(content).append(
    element('div', { className: 'progress-shell' }, [
      element('div', { className: 'progress-meta' }, [
        element('span', { text: `${state.exam.title} · Question ${session.currentIndex + 1} of ${session.order.length}` }),
        session.deadline ? element('span', { className: 'timer', id: 'examTimer', text: formatDuration(Math.ceil((session.deadline - Date.now()) / 1000)) }) : element('span', { text: 'Untimed' })
      ]),
      element('div', { className: 'progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': Math.round(progress) },
        element('div', { className: 'progress-value', style: `width:${progress}%` }))
    ])
  );

  const card = element('section', { className: 'card question-card' });
  card.append(element('p', { className: 'eyebrow', text: question.choices.filter(choice => choice.correct).length > 1 ? 'Select all that apply' : 'Choose the best answer' }));
  card.append(renderRichText(element('div', { className: 'question-text' }), question.text, state.assetUrls));
  const fieldset = element('fieldset', { className: 'choice-list' });
  fieldset.append(element('legend', { className: 'hidden', text: `Answers for question ${session.currentIndex + 1}` }));
  for (const choice of choices) {
    const input = element('input', {
      type: answerType,
      name: question.id,
      value: choice.id,
      checked: selected.has(choice.id),
      onchange: () => saveAnswer(question.id, answerType)
    });
    fieldset.append(element('label', { className: 'choice' }, [input, element('span', { text: choice.text })]));
  }
  card.append(fieldset);
  card.append(element('div', { className: 'card-actions' }, [
    element('button', { className: 'button button-ghost', text: 'Previous', disabled: session.currentIndex === 0, onclick: () => moveQuestion(-1) }),
    element('button', { className: 'button button-ghost', text: session.flags.includes(question.id) ? '★ Flagged' : '☆ Flag', onclick: () => toggleFlag(question.id) }),
    session.currentIndex < session.order.length - 1
      ? element('button', { className: 'button', text: 'Next', onclick: () => moveQuestion(1) })
      : element('button', { className: 'button', text: 'Finish exam', onclick: () => submitExam(false) })
  ]));

  const navigatorCard = element('aside', { className: 'card question-nav', 'aria-label': 'Question navigator' }, [
    element('h2', { text: 'Questions' }),
    element('p', { className: 'muted', text: `${answeredCount} of ${session.order.length} answered` })
  ]);
  const jumps = element('div', { className: 'question-nav-grid' });
  session.order.forEach((item, index) => {
    const classes = ['question-jump'];
    if ((session.answers[item.questionId] || []).length) classes.push('answered');
    if (session.flags.includes(item.questionId)) classes.push('flagged');
    if (index === session.currentIndex) classes.push('current');
    jumps.append(element('button', { className: classes.join(' '), text: index + 1, 'aria-label': `Go to question ${index + 1}`, onclick: () => jumpQuestion(index) }));
  });
  navigatorCard.append(
    jumps,
    element('button', { className: 'button button-ghost exit-exam', text: 'Save & exit', onclick: async () => {
      const confirmed = await confirmAction({ title: 'Leave this attempt?', message: 'Your answers are saved on this device. You can resume from the Exams page.', confirmLabel: 'Save and exit' });
      if (confirmed) navigate('exams');
    } })
  );
  content.append(element('div', { className: 'question-layout' }, [card, navigatorCard]));
  startTimer();
}

function saveAnswer(questionId, type) {
  const inputs = [...document.querySelectorAll(`input[name="${CSS.escape(questionId)}"]`)];
  state.session.answers[questionId] = inputs.filter(input => input.checked).map(input => input.value);
  if (type === 'radio' && !state.session.answers[questionId].length) delete state.session.answers[questionId];
  persistSession();
  renderExamQuestion();
}

function moveQuestion(offset) { jumpQuestion(state.session.currentIndex + offset); }
function jumpQuestion(index) {
  if (index < 0 || index >= state.session.order.length) return;
  state.session.currentIndex = index;
  persistSession();
  renderExamQuestion();
}
function toggleFlag(questionId) {
  const flags = new Set(state.session.flags);
  flags.has(questionId) ? flags.delete(questionId) : flags.add(questionId);
  state.session.flags = [...flags];
  persistSession();
  renderExamQuestion();
}

function startTimer() {
  stopTimer();
  if (!state.session?.deadline) return;
  state.timerId = window.setInterval(() => {
    const remaining = Math.ceil((state.session.deadline - Date.now()) / 1000);
    const timer = document.getElementById('examTimer');
    if (timer) timer.textContent = formatDuration(Math.max(0, remaining));
    if (remaining <= 0) submitExam(true);
  }, 1000);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = null;
}

async function submitExam(timeExpired) {
  if (!state.exam || !state.session || state.session.submitting) return;
  if (!timeExpired) {
    const unanswered = state.session.order.filter(item => !(state.session.answers[item.questionId] || []).length).length;
    if (unanswered) {
      const confirmed = await confirmAction({ title: 'Finish exam?', message: `${unanswered} question(s) are unanswered. You can submit now or continue reviewing.`, confirmLabel: 'Submit anyway' });
      if (!confirmed) return;
    }
  }
  state.session.submitting = true;
  stopTimer();
  const attemptedQuestions = selectAttemptQuestions(state.exam, state.session.order);
  const result = scoreExam({ ...state.exam, questions: attemptedQuestions }, state.session.answers);
  const completedAt = new Date().toISOString();
  const attempt = {
    id: crypto.randomUUID(),
    examId: state.examRecord.id,
    examTitle: state.exam.title,
    examUpdatedAt: state.examRecord.updatedAt,
    examVersion: state.examRecord.version || null,
    createdAt: completedAt,
    startedAt: new Date(state.session.startedAt).toISOString(),
    durationSeconds: Math.max(0, Math.round((Date.now() - state.session.startedAt) / 1000)),
    score: result.score,
    total: result.total,
    percent: result.percent,
    answers: structuredClone(state.session.answers),
    flags: [...state.session.flags],
    order: structuredClone(state.session.order),
    timedOut: timeExpired
  };
  await saveAttempt(attempt);
  localStorage.removeItem(SESSION_KEY);
  state.selectedAttempt = attempt;
  history.replaceState({}, '', `#review/${encodeURIComponent(attempt.id)}`);
  await renderReview(attempt, true);
  if (timeExpired) showToast('Time expired. Your saved answers were submitted.');
}

async function renderReview(attempt, justCompleted = false) {
  stopTimer();
  let exam = null;
  let legacyQuestions = null;
  if (attempt.legacySnapshot) legacyQuestions = normalizeLegacyAttempt(attempt.legacySnapshot);
  else {
    const record = await getExam(attempt.examId);
    if (record) {
      const version = await getExamVersion(attempt.examId, attempt.examVersion);
      exam = parseExamMarkdown(version?.source || record.source);
      await loadExamState(record, exam);
    }
  }

  const attemptedQuestions = exam ? selectAttemptQuestions(exam, attempt.order) : null;

  const missedOnly = element('input', { type: 'checkbox', id: 'missedOnly' });
  const missedToggle = element('label', { className: 'switch', htmlFor: 'missedOnly' }, [
    missedOnly,
    element('span', { className: 'switch-track', 'aria-hidden': 'true' }),
    element('span', { className: 'switch-label', text: 'Missed only' })
  ]);
  clear(content).append(pageHeader(
    justCompleted ? 'Exam complete' : 'Attempt Review',
    attempt.examTitle,
    element('a', { className: 'button button-ghost', href: `#exams/${encodeURIComponent(attempt.examId)}`, text: 'Exam history' })
  ));
  const summary = element('section', { className: 'card result-summary' }, [
    element('div', { className: 'score-chip', text: `${attempt.percent}%` }),
    element('div', { className: 'result-summary-text' }, [
      element('h2', { text: `${attempt.score} of ${attempt.total} correct` }),
      element('p', { className: 'muted', text: `${new Date(attempt.createdAt).toLocaleString()} · ${formatDuration(attempt.durationSeconds)}` })
    ]),
    missedToggle
  ]);
  content.append(summary);

  if (!exam && !legacyQuestions) {
    content.append(element('div', { className: 'notice notice-warning', text: 'The source exam was deleted, so question-level review is unavailable for this attempt.' }));
    return;
  }

  const list = element('div', { className: 'review-list' });
  content.append(list);

  const draw = () => {
    clear(list);
    const reviewItems = legacyQuestions || attemptedQuestions.map(question => ({
      question,
      selectedIds: attempt.answers[question.id] || [],
      correct: isQuestionCorrect(question, attempt.answers[question.id] || [])
    }));
    for (const item of reviewItems) {
      if (missedOnly.checked && item.correct) continue;
      list.append(reviewQuestionCard(item));
    }
  };
  missedOnly.addEventListener('change', draw);
  draw();
}

async function repairSubsetAttemptScores() {
  const attempts = await listAttempts();
  const exams = new Map((await listExams()).map(exam => [String(exam.id), exam]));
  for (const attempt of attempts) {
    if (!Array.isArray(attempt.order) || !attempt.order.length || attempt.legacySnapshot) continue;
    const record = exams.get(String(attempt.examId));
    if (!record) continue;
    const version = await getExamVersion(attempt.examId, attempt.examVersion);
    const exam = parseExamMarkdown(version?.source || record.source);
    const questions = selectAttemptQuestions(exam, attempt.order);
    if (!questions.length) continue;
    const result = scoreExam({ ...exam, questions }, attempt.answers || {});
    if (attempt.score === result.score && attempt.total === result.total && attempt.percent === result.percent) continue;
    await saveAttempt({ ...attempt, score: result.score, total: result.total, percent: result.percent });
  }
}

function reviewQuestionCard({ question, selectedIds, correct }) {
  const card = element('article', { className: `card review-card ${correct ? 'correct' : 'incorrect'}` });
  card.append(renderRichText(element('h2'), question.text, state.assetUrls));
  const answers = element('ul', { className: 'answer-list' });
  for (const choice of question.choices) {
    const selected = selectedIds.includes(choice.id);
    const classes = ['answer-row'];
    if (choice.correct) classes.push('correct-answer');
    else if (selected) classes.push('user-wrong');
    const suffix = choice.correct ? ' — correct answer' : (selected ? ' — your selection' : '');
    answers.append(element('li', { className: classes.join(' '), text: `${choice.text}${suffix}` }));
  }
  card.append(answers);
  if (question.explanation) card.append(renderRichText(element('div', { className: 'explanation' }), question.explanation, state.assetUrls));
  return card;
}

function normalizeLegacyAttempt(snapshot) {
  return (snapshot.questions || []).map((oldQuestion, questionIndex) => {
    const choices = (oldQuestion.choices || []).map((choice, choiceIndex) => ({ id: `legacy-${questionIndex}-${choiceIndex}`, text: choice.text, correct: choice.isCorrect }));
    const selectedIds = choices.filter((choice, choiceIndex) => snapshot.userAnswers?.[questionIndex]?.[choiceIndex]).map(choice => choice.id);
    const question = { id: `legacy-${questionIndex}`, text: oldQuestion.question, choices, explanation: '' };
    return { question, selectedIds, correct: isQuestionCorrect(question, selectedIds) };
  });
}

function isQuestionCorrect(question, selectedIds) {
  const selected = new Set(selectedIds);
  const correct = question.choices.filter(choice => choice.correct).map(choice => choice.id);
  return correct.length > 0 && selected.size === correct.length && correct.every(id => selected.has(id));
}

async function renderEditor(routeId) {
  const record = (await listExams()).find(exam => String(exam.id) === String(routeId));
  if (!record) return navigate('exams');
  const existingAssets = await getAssets(record.id);
  state.editorDraft = { record, source: record.source, existingAssets, imageFiles: [], validation: null, exam: null };

  const sourceArea = element('textarea', { id: 'editorSource', value: record.source, spellcheck: false });
  const imageInput = element('input', { type: 'file', accept: 'image/*', multiple: true, id: 'editorImages' });
  const saveButton = element('button', { className: 'button', text: 'Save changes', onclick: saveEditorChanges });
  const preview = element('section', { className: 'card editor-preview', id: 'editorPreview' });
  const editor = element('section', { className: 'card editor-panel' }, [
    element('div', { className: 'field' }, [
      element('label', { htmlFor: 'editorSource', text: 'Exam Markdown' }),
      element('span', { className: 'field-help', text: 'Changes are validated as you type. Existing result history remains tied to the version originally taken.' }),
      sourceArea
    ]),
    element('div', { className: 'field' }, [
      element('label', { htmlFor: 'editorImages', text: 'Add or replace images' }), imageInput,
      element('span', { className: 'field-help', text: `${existingAssets.length} image(s) currently stored. Selecting the same filename replaces that image.` })
    ]),
    element('div', { className: 'card-actions' }, [saveButton, element('a', { className: 'button button-ghost', href: '#exams', text: 'Cancel' })])
  ]);
  clear(content).append(
    pageHeader('Edit exam', record.title, element('a', { className: 'button button-ghost', href: '#exams', text: 'All exams' })),
    element('div', { className: 'editor-layout' }, [editor, preview])
  );

  let validationTimer;
  sourceArea.addEventListener('input', () => {
    state.editorDraft.source = sourceArea.value;
    window.clearTimeout(validationTimer);
    validationTimer = window.setTimeout(drawEditorPreview, 180);
  });
  imageInput.addEventListener('change', () => {
    state.editorDraft.imageFiles = [...imageInput.files].filter(file => file.type.startsWith('image/'));
    drawEditorPreview();
  });
  drawEditorPreview();
}

function drawEditorPreview() {
  const draft = state.editorDraft;
  const preview = document.getElementById('editorPreview');
  if (!draft || !preview) return;
  const exam = parseExamMarkdown(draft.source);
  const validation = validateExam(exam);
  const availableNames = new Set([
    ...draft.existingAssets.map(asset => asset.name),
    ...draft.imageFiles.map(file => file.name)
  ]);
  for (const name of extractAssetNames(draft.source)) {
    if (!availableNames.has(name)) validation.warnings.push(`Image “${name}” is referenced but not stored with this exam.`);
  }
  draft.exam = exam;
  draft.validation = validation;
  const saveButton = document.querySelector('.editor-panel .button');
  if (saveButton) saveButton.disabled = !validation.valid;

  clear(preview).append(
    element('div', { className: 'preview-heading' }, [
      element('div', {}, [element('p', { className: 'eyebrow', text: 'Live preview' }), element('h2', { text: exam.title || 'Untitled exam' })]),
      element('span', { className: `validation-badge ${validation.valid ? 'valid' : 'invalid'}`, text: validation.valid ? 'Ready to save' : 'Needs attention' })
    ]),
    element('div', { className: 'metadata' }, [
      element('span', { text: `${exam.questions.length} questions` }),
      element('span', { text: exam.time ? formatDuration(exam.time) : 'Untimed' })
    ])
  );
  if (validation.errors.length) preview.append(validationBlock('Fix before saving', validation.errors, 'notice-error'));
  if (validation.warnings.length) preview.append(validationBlock('Warnings', validation.warnings, 'notice-warning'));
  const questions = element('div', { className: 'editor-question-list' });
  exam.questions.slice(0, 8).forEach((question, index) => {
    questions.append(element('article', { className: 'editor-question' }, [
      element('span', { className: 'question-number', text: index + 1 }),
      element('div', {}, [
        element('h3', { text: question.text.replace(/<[^>]+>/g, '').slice(0, 140) || 'Untitled question' }),
        element('p', { className: 'muted', text: `${question.choices.length} choices · ${question.choices.filter(choice => choice.correct).length} correct` })
      ])
    ]));
  });
  if (exam.questions.length > 8) questions.append(element('p', { className: 'muted', text: `Plus ${exam.questions.length - 8} more questions…` }));
  preview.append(questions);
}

async function saveEditorChanges() {
  const draft = state.editorDraft;
  if (!draft?.validation?.valid) return showToast('Fix the validation errors before saving.');
  const now = new Date().toISOString();
  const version = await hashText(draft.source);
  const record = {
    ...draft.record,
    title: draft.exam.title,
    source: draft.source,
    questionCount: draft.exam.questions.length,
    time: draft.exam.time,
    version,
    updatedAt: now
  };
  const assets = draft.imageFiles.map(file => ({ id: `${record.id}:${file.name}`, examId: record.id, name: file.name, blob: file, type: file.type, size: file.size }));
  await saveExam(record, assets);
  if (String(readSession()?.examId) === String(record.id)) {
    localStorage.removeItem(SESSION_KEY);
    showToast('Exam saved. Its previous in-progress session was cleared.');
  } else showToast('Exam changes saved.');
  state.editorDraft = null;
  navigate('exams');
}

function renderImport() {
  clear(content).append(pageHeader('Add an exam', 'Import locally, paste Markdown, or fetch a public Markdown URL.'));
  const localInput = element('input', { type: 'file', accept: '.md,.markdown,.txt,.zip,image/*', multiple: true, id: 'examFiles' });
  const sourceArea = element('textarea', { id: 'examSource', placeholder: '# Exam title\n\n## Question\n- [ ] Incorrect\n- [x] Correct' });
  const urlInput = element('input', { type: 'url', placeholder: 'https://example.com/exam.md', id: 'examUrl' });
  const editor = element('section', { className: 'card' }, [
    element('div', { className: 'field drop-zone' }, [
      element('label', { htmlFor: 'examFiles', text: 'Choose a ZIP, or Markdown and image files' }), localInput,
      element('span', { className: 'field-help', text: 'A ZIP should contain exactly one Markdown exam plus its images. Nested image folders are supported.' })
    ]),
    element('div', { className: 'field' }, [element('label', { htmlFor: 'examSource', text: 'Or paste Markdown' }), sourceArea]),
    element('button', { className: 'button', text: 'Validate Markdown', onclick: () => prepareImport(sourceArea.value, []) }),
    element('hr'),
    element('div', { className: 'field' }, [element('label', { htmlFor: 'examUrl', text: 'Or load a public URL' }), urlInput]),
    element('button', { className: 'button button-secondary', text: 'Fetch and validate', onclick: () => fetchImport(urlInput.value) })
  ]);
  const preview = element('section', { className: 'card', id: 'importPreview' }, [
    element('h2', { text: 'Import preview' }),
    element('p', { className: 'muted', text: 'Your validation results will appear here before anything is saved.' })
  ]);
  content.append(element('div', { className: 'import-layout' }, [editor, preview]));
  localInput.addEventListener('change', async () => {
    const files = [...localInput.files];
    const zip = files.find(file => /\.zip$/i.test(file.name));
    if (zip) {
      if (files.length > 1) return showToast('Choose the ZIP by itself.');
      try {
        const archive = await readExamZip(zip);
        sourceArea.value = archive.source;
        await prepareImport(archive.source, archive.images);
        showToast(`Loaded ${archive.markdownName} and ${archive.images.length} image(s) from ZIP.`);
      } catch (error) {
        showToast(`Could not read ZIP: ${error.message}`, 6000);
      }
      return;
    }
    const markdown = files.find(file => /\.(md|markdown|txt)$/i.test(file.name));
    if (!markdown) return showToast('Choose one Markdown or text file.');
    const source = await markdown.text();
    sourceArea.value = source;
    prepareImport(source, files.filter(file => file !== markdown && file.type.startsWith('image/')));
  });
  if (state.importDraft) drawImportPreview();
  const sharedUrl = sessionStorage.getItem('mdxam-shared-url');
  if (sharedUrl) { urlInput.value = sharedUrl; sessionStorage.removeItem('mdxam-shared-url'); }
}

async function prepareImport(source, imageFiles) {
  const exam = parseExamMarkdown(source);
  const validation = validateExam(exam);
  const suppliedNames = new Set(imageFiles.map(file => file.name));
  const missingAssets = extractAssetNames(source).filter(name => !suppliedNames.has(name));
  for (const name of missingAssets) validation.warnings.push(`Image “${name}” was referenced but not selected.`);
  state.importDraft = { source, exam, validation, imageFiles };
  drawImportPreview();
}

function drawImportPreview() {
  const preview = document.getElementById('importPreview');
  if (!preview || !state.importDraft) return;
  const { exam, validation, imageFiles } = state.importDraft;
  clear(preview).append(
    element('h2', { text: exam.title || 'Untitled exam' }),
    element('div', { className: 'metadata' }, [
      element('span', { text: `${exam.questions.length} questions` }),
      element('span', { text: exam.time ? formatDuration(exam.time) : 'Untimed' }),
      element('span', { text: `${imageFiles?.length || 0} local images` })
    ])
  );
  if (validation.errors.length) preview.append(validationBlock('Fix before importing', validation.errors, 'notice-error'));
  if (validation.warnings.length) preview.append(validationBlock('Warnings', validation.warnings, 'notice-warning'));
  if (validation.valid) {
    const sample = element('ol', { className: 'preview-list' });
    exam.questions.slice(0, 4).forEach(question => sample.append(element('li', { text: `${question.text.replace(/<[^>]+>/g, '').slice(0, 100)} (${question.choices.length} choices)` })));
    preview.append(element('h3', { text: 'Question sample' }), sample);
    preview.append(element('button', { className: 'button', text: 'Save exam', onclick: saveImport }));
  }
}

function validationBlock(title, messages, className) {
  const list = element('ul', { className: 'validation-list' }, messages.map(message => element('li', { text: message })));
  return element('div', { className: `notice ${className}` }, [element('strong', { text: title }), list]);
}

async function saveImport() {
  const { source, exam, validation, imageFiles = [] } = state.importDraft || {};
  if (!validation?.valid) return;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const digest = await hashText(source);
  const record = { id, title: exam.title, source, questionCount: exam.questions.length, time: exam.time, version: digest, createdAt: now, updatedAt: now };
  const assets = imageFiles.map(file => ({ id: `${id}:${file.name}`, examId: id, name: file.name, blob: file, type: file.type, size: file.size }));
  await saveExam(record, assets);
  state.importDraft = null;
  showToast('Exam saved and available offline.');
  navigate('exams');
}

async function fetchImport(value) {
  let url;
  try {
    url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return showToast('Enter a valid HTTP or HTTPS URL.');
  }
  const button = document.activeElement;
  if (button instanceof HTMLButtonElement) button.disabled = true;
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/markdown,text/plain;q=0.9' } });
    window.clearTimeout(timeout);
    if (!response.ok) throw new Error(`The server returned ${response.status}.`);
    const source = await response.text();
    if (source.length > 5_000_000) throw new Error('The Markdown file is larger than 5 MB.');
    document.getElementById('examSource').value = source;
    await prepareImport(source, []);
  } catch (error) {
    showToast(error.name === 'AbortError' ? 'The request timed out.' : `Could not load exam: ${error.message}`);
  } finally {
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
}

async function renderSettings() {
  const theme = await getSetting('theme', 'system');
  const estimate = await navigator.storage?.estimate?.();
  const usage = estimate?.usage ? formatBytes(estimate.usage) : 'Unavailable';
  const quota = estimate?.quota ? formatBytes(estimate.quota) : 'Unavailable';
  clear(content).append(pageHeader('Settings', 'Appearance, storage, and portable backups.'));
  const themeSelect = element('select', { id: 'themeSelect' }, [
    element('option', { value: 'system', text: 'System' }),
    element('option', { value: 'indigo', text: 'Indigo' }),
    element('option', { value: 'forest', text: 'Forest' }),
    element('option', { value: 'ember', text: 'Ember' }),
    element('option', { value: 'slate', text: 'Slate' })
  ]);
  themeSelect.value = theme;
  themeSelect.addEventListener('change', async () => { applyTheme(themeSelect.value); await setSetting('theme', themeSelect.value); });
  const backupInput = element('input', { type: 'file', accept: 'application/json,.json', id: 'backupFile' });
  backupInput.addEventListener('change', () => importBackup(backupInput.files[0]));
  content.append(element('div', { className: 'settings-grid' }, [
    element('section', { className: 'card' }, [
      element('h2', { text: 'Appearance' }),
      element('div', { className: 'field' }, [element('label', { htmlFor: 'themeSelect', text: 'Theme' }), themeSelect])
    ]),
    element('section', { className: 'card' }, [
      element('h2', { text: 'Local storage' }),
      element('p', { className: 'muted', text: `${usage} used of approximately ${quota}.` }),
      element('button', { className: 'button button-ghost', text: 'Request persistent storage', onclick: requestPersistentStorage })
    ]),
    element('section', { className: 'card' }, [
      element('h2', { text: 'Backup' }),
      element('p', { className: 'muted', text: 'Export exams, local images, results, and preferences to one JSON file.' }),
      element('div', { className: 'card-actions' }, [
        element('button', { className: 'button', text: 'Export backup', onclick: exportBackup }),
        element('label', { className: 'button button-ghost', htmlFor: 'backupFile', text: 'Import backup' }), backupInput
      ])
    ]),
    element('section', { className: 'card' }, [
      element('h2', { text: 'Exam format' }),
      element('p', { className: 'muted', text: 'Use # for the title, optional Time: HH:MM:SS, ## for questions, and Markdown checkboxes for choices. Text after the choices becomes the explanation.' }),
      element('a', { href: './readme.md', target: '_blank', rel: 'noopener', text: 'Open format documentation' })
    ])
  ]));
  backupInput.classList.add('hidden');
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return showToast('Persistent storage is not supported by this browser.');
  const granted = await navigator.storage.persist();
  showToast(granted ? 'Persistent storage is enabled.' : 'The browser did not grant persistent storage.');
}

async function exportBackup() {
  const backup = await createBackup();
  backup.assets = await Promise.all(backup.assets.map(async asset => ({ ...asset, blob: await blobToDataUrl(asset.blob) })));
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { href: url, download: `mdxam-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('Backup exported.');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const confirmed = await confirmAction({ title: 'Import backup?', message: 'Items with matching IDs will be replaced. Other local data will remain.', confirmLabel: 'Import' });
    if (!confirmed) return;
    backup.assets = await Promise.all((backup.assets || []).map(async asset => ({ ...asset, blob: await dataUrlToBlob(asset.blob) })));
    await restoreBackup(backup);
    applyTheme(await getSetting('theme', 'system'));
    showToast('Backup imported successfully.');
    navigate('exams');
  } catch (error) {
    showToast(`Backup could not be imported: ${error.message}`);
  }
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const colors = { system: '#172554', indigo: '#172554', forest: '#14532d', ember: '#4c1d1d', slate: '#1e293b' };
  document.querySelector('meta[name="theme-color"]').content = colors[theme] || colors.indigo;
}

function persistSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(state.session)); }
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch { localStorage.removeItem(SESSION_KEY); return null; }
}
function revokeAssetUrls() {
  for (const url of state.assetUrls.values()) URL.revokeObjectURL(url);
  state.assetUrls.clear();
}
async function hashText(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) throw new Error('Backup contains an invalid image.');
  return (await fetch(value)).blob();
}

function configureInstallPrompt() {
  const button = document.getElementById('installButton');
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.deferredInstall = event;
    button.classList.remove('hidden');
  });
  button.addEventListener('click', async () => {
    if (!state.deferredInstall) return;
    await state.deferredInstall.prompt();
    state.deferredInstall = null;
    button.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => { button.classList.add('hidden'); showToast('MDXam installed.'); });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(worker);
      });
    });
  } catch (error) {
    console.warn('Service worker registration failed:', error);
    showToast('Offline support could not be enabled.');
  }
}

function showUpdateToast(worker) {
  const region = document.getElementById('toastRegion');
  const toast = element('div', { className: 'toast' }, [
    element('span', { text: 'A new MDXam version is ready. ' }),
    element('button', { className: 'button button-small', text: 'Update', onclick: () => worker.postMessage({ type: 'SKIP_WAITING' }) })
  ]);
  region.append(toast);
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
}

function configureFileHandling() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async launchParams => {
    const handle = launchParams.files?.[0];
    if (!handle) return;
    const file = await handle.getFile();
    navigate('import');
    window.setTimeout(() => {
      const sourcePromise = file.text();
      sourcePromise.then(source => {
        const area = document.getElementById('examSource');
        if (area) area.value = source;
        prepareImport(source, []);
      });
    });
  });
}

function consumeShareTarget() {
  const params = new URLSearchParams(location.search);
  const sharedUrl = params.get('url') || (params.get('text')?.match(/https?:\/\/\S+/)?.[0]);
  if (!sharedUrl) return;
  sessionStorage.setItem('mdxam-shared-url', sharedUrl);
  history.replaceState({}, '', `${location.pathname}#import`);
}
