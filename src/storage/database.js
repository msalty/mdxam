const DB_NAME = 'mdxam-db';
const DB_VERSION = 3;
let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('exams')) db.createObjectStore('exams', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('examResults')) db.createObjectStore('examResults', { keyPath: 'examId' });
      if (!db.objectStoreNames.contains('attempts')) {
        const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('examId', 'examId', { unique: false });
        attempts.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('assets')) {
        const assets = db.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('examId', 'examId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('examVersions')) {
        const versions = db.createObjectStore('examVersions', { keyPath: 'id' });
        versions.createIndex('examId', 'examId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other MDXam tabs so the database can be upgraded.'));
  });
  return databasePromise;
}

async function all(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName).objectStore(storeName).getAll());
}

function normalizeExam(record) {
  if (!record) return null;
  return {
    ...record,
    source: record.source ?? record.text ?? '',
    createdAt: record.createdAt ?? new Date(Number(record.id) || Date.now()).toISOString(),
    updatedAt: record.updatedAt ?? record.createdAt ?? new Date(Number(record.id) || Date.now()).toISOString()
  };
}

export async function listExams() {
  return (await all('exams')).map(normalizeExam).sort((a, b) => a.title.localeCompare(b.title));
}

export async function getExam(id) {
  const db = await openDatabase();
  return normalizeExam(await requestResult(db.transaction('exams').objectStore('exams').get(id)));
}

export async function saveExam(exam, assets = []) {
  const db = await openDatabase();
  const transaction = db.transaction(['exams', 'assets', 'examVersions'], 'readwrite');
  transaction.objectStore('exams').put(exam);
  for (const asset of assets) transaction.objectStore('assets').put(asset);
  if (exam.version && exam.source) {
    transaction.objectStore('examVersions').put({
      id: `${exam.id}:${exam.version}`,
      examId: exam.id,
      version: exam.version,
      source: exam.source,
      createdAt: exam.updatedAt || new Date().toISOString()
    });
  }
  await transactionDone(transaction);
  return exam;
}

export async function deleteExamAndData(examId) {
  const db = await openDatabase();
  const [attempts, assets, versions] = await Promise.all([getAttempts(examId), getAssets(examId), getExamVersions(examId)]);
  const transaction = db.transaction(['exams', 'attempts', 'assets', 'examResults', 'examVersions'], 'readwrite');
  transaction.objectStore('exams').delete(examId);
  transaction.objectStore('examResults').delete(examId);
  for (const attempt of attempts) transaction.objectStore('attempts').delete(attempt.id);
  for (const asset of assets) transaction.objectStore('assets').delete(asset.id);
  for (const version of versions) transaction.objectStore('examVersions').delete(version.id);
  await transactionDone(transaction);
}

export async function getAssets(examId) {
  const db = await openDatabase();
  return requestResult(db.transaction('assets').objectStore('assets').index('examId').getAll(examId));
}

export async function getExamVersion(examId, version) {
  if (!version) return null;
  const db = await openDatabase();
  return requestResult(db.transaction('examVersions').objectStore('examVersions').get(`${examId}:${version}`));
}

export async function getExamVersions(examId) {
  const db = await openDatabase();
  return requestResult(db.transaction('examVersions').objectStore('examVersions').index('examId').getAll(examId));
}

export async function saveAttempt(attempt) {
  const db = await openDatabase();
  const transaction = db.transaction('attempts', 'readwrite');
  transaction.objectStore('attempts').put(attempt);
  await transactionDone(transaction);
  return attempt;
}

export async function getAttempts(examId) {
  const db = await openDatabase();
  const attempts = await requestResult(db.transaction('attempts').objectStore('attempts').index('examId').getAll(examId));
  return attempts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listAttempts() {
  return (await all('attempts')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteAttempts(examId) {
  const attempts = await getAttempts(examId);
  const db = await openDatabase();
  const transaction = db.transaction(['attempts', 'examResults'], 'readwrite');
  for (const attempt of attempts) transaction.objectStore('attempts').delete(attempt.id);
  transaction.objectStore('examResults').delete(examId);
  await transactionDone(transaction);
}

export async function getSetting(key, fallback = null) {
  const db = await openDatabase();
  const value = await requestResult(db.transaction('settings').objectStore('settings').get(key));
  return value?.value ?? fallback;
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  const transaction = db.transaction('settings', 'readwrite');
  transaction.objectStore('settings').put({ key, value });
  await transactionDone(transaction);
}

export async function migrateLegacyResults() {
  if (await getSetting('legacy-results-migrated', false)) return;
  const legacyRecords = await all('examResults');
  const existingAttempts = await listAttempts();
  const existingIds = new Set(existingAttempts.map(attempt => attempt.id));
  const db = await openDatabase();
  const transaction = db.transaction(['attempts', 'settings'], 'readwrite');
  const store = transaction.objectStore('attempts');

  for (const record of legacyRecords) {
    for (const result of record.results || []) {
      const id = `legacy-${record.examId}-${result.attemptNumber}`;
      if (existingIds.has(id)) continue;
      const parsedDate = new Date(result.date);
      store.put({
        id,
        examId: record.examId,
        examTitle: result.attemptData?.examTitle || 'Legacy exam',
        createdAt: Number.isNaN(parsedDate.valueOf()) ? new Date().toISOString() : parsedDate.toISOString(),
        score: result.score,
        total: result.total,
        percent: result.scorePercent,
        durationSeconds: null,
        answers: result.attemptData?.userAnswers || {},
        legacySnapshot: result.attemptData || null
      });
    }
  }
  transaction.objectStore('settings').put({ key: 'legacy-results-migrated', value: true });
  await transactionDone(transaction);
}

export async function backfillExamVersions() {
  const exams = await listExams();
  const db = await openDatabase();
  const transaction = db.transaction('examVersions', 'readwrite');
  const store = transaction.objectStore('examVersions');
  for (const exam of exams) {
    if (!exam.version || !exam.source) continue;
    store.put({
      id: `${exam.id}:${exam.version}`,
      examId: exam.id,
      version: exam.version,
      source: exam.source,
      createdAt: exam.updatedAt
    });
  }
  await transactionDone(transaction);
}

export async function createBackup() {
  const [exams, attempts, assets, settings, examVersions] = await Promise.all([
    listExams(), listAttempts(), all('assets'), all('settings'), all('examVersions')
  ]);
  return { format: 'mdxam-backup', version: 3, exportedAt: new Date().toISOString(), exams, attempts, assets, settings, examVersions };
}

export async function restoreBackup(backup) {
  if (backup?.format !== 'mdxam-backup' || ![2, 3].includes(backup?.version)) throw new Error('This is not a supported MDXam backup.');
  const db = await openDatabase();
  const transaction = db.transaction(['exams', 'attempts', 'assets', 'settings', 'examVersions'], 'readwrite');
  for (const exam of backup.exams || []) transaction.objectStore('exams').put(exam);
  for (const attempt of backup.attempts || []) transaction.objectStore('attempts').put(attempt);
  for (const asset of backup.assets || []) transaction.objectStore('assets').put(asset);
  for (const setting of backup.settings || []) transaction.objectStore('settings').put(setting);
  for (const version of backup.examVersions || []) transaction.objectStore('examVersions').put(version);
  for (const exam of backup.exams || []) {
    if (exam.version && exam.source) transaction.objectStore('examVersions').put({ id: `${exam.id}:${exam.version}`, examId: exam.id, version: exam.version, source: exam.source, createdAt: exam.updatedAt });
  }
  await transactionDone(transaction);
}
