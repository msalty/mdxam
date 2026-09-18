export function createQuestionOrder(exam, randomize = true) {
  const questions = [...exam.questions];
  if (randomize) shuffle(questions);
  return questions.map(question => {
    const choiceIds = question.choices.map(choice => choice.id);
    if (randomize) shuffle(choiceIds);
    return { questionId: question.id, choiceIds };
  });
}

export function selectAttemptQuestions(exam, order) {
  if (!Array.isArray(order) || !order.length) return exam.questions;
  const questionsById = new Map(exam.questions.map(question => [question.id, question]));
  return order.map(item => questionsById.get(item.questionId)).filter(Boolean);
}

export function scoreExam(exam, answers) {
  const details = exam.questions.map(question => {
    const selected = new Set(answers[question.id] || []);
    const correctIds = question.choices.filter(choice => choice.correct).map(choice => choice.id);
    const graded = correctIds.length > 0;
    const correct = graded && selected.size === correctIds.length && correctIds.every(id => selected.has(id));
    return { questionId: question.id, selectedIds: [...selected], correctIds, graded, correct };
  });
  const graded = details.filter(detail => detail.graded);
  const score = graded.filter(detail => detail.correct).length;
  const total = graded.length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  return { score, total, percent, details };
}

export function shuffle(items, random = Math.random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}
