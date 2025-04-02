// main.js

// ============================
// Global Variables
// ============================
var examData = null;            // Holds the parsed exam object (with examData.examId)
var currentQuestionIndex = 0;   // Index for exam simulation navigation
var userAnswers = {};           // Stores user's checkbox answers by question index
var examTimer = 0;              // Total exam time in seconds (if provided)
var timerInterval = null;       // Reference for timer interval

// ============================
// Open (or create) a database called "mdxam-db" with two object stores.
// ============================
const dbPromise = idb.openDB('mdxam-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('exams')) {
      db.createObjectStore('exams', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('examResults')) {
      db.createObjectStore('examResults', { keyPath: 'examId' });
    }
  }
});

// ============================
// Service Worker Registration
// ============================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(function(reg) {
      console.log("Service worker registered:", reg);
    })
    .catch(function(err) {
      console.error("Service worker registration failed:", err);
    });
}

// ============================
// DOMContentLoaded: Set Up Event Listeners
// ============================
document.addEventListener('DOMContentLoaded', function() {
  // Apply saved theme or default to "Storm".
  var savedTheme = localStorage.getItem('theme') || "Storm";
  applyTheme(savedTheme);

  // Sidebar toggle for the hamburger button.
  var sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', toggleSidebar);
  }
  
  // Attach event listeners for navigation links.
  document.getElementById('nav-exams').addEventListener('click', function(e) {
    e.preventDefault();
    setActiveNav('nav-exams');
    renderExamList();
    if (window.innerWidth < 768) { autoHideSidebar(); }
  });
  
  document.getElementById('nav-results').addEventListener('click', function(e) {
    e.preventDefault();
    setActiveNav('nav-results');
    renderResults();
    if (window.innerWidth < 768) { autoHideSidebar(); }
  });
  
  document.getElementById('nav-add-exam').addEventListener('click', function(e) {
    e.preventDefault();
    setActiveNav('nav-add-exam');
    renderAddExam();
    if (window.innerWidth < 768) { autoHideSidebar(); }
  });
  
  document.getElementById('nav-settings').addEventListener('click', function(e) {
    e.preventDefault();
    setActiveNav('nav-settings');
    renderSettings();
    if (window.innerWidth < 768) { autoHideSidebar(); }
  });
  
  // Load default view ("Exams") on startup.
  renderExamList();

});

// Automatically hide sidebar on small screens after selecting a nav option.
function autoHideSidebar() {
  if (window.innerWidth < 768) {
    toggleSidebar();
  }
}

// ============================
// Theme Selector
// ============================
function applyTheme(themeName) {
  themeName = themeName || "Storm";
  localStorage.setItem('theme', themeName);

  var themes = {
    Storm: {
      topNav: "rgba(27, 38, 59, 0.8)", // with transparency
      sidebar: "#415a77",
      content: "#edf2f4"
    },
    Redshift: {
      topNav: "rgb(87, 4, 5)",
      sidebar: "rgb(119, 14, 16)",
      content: "#f5f3f4"
    },
    Diver: {
      topNav: "#1b263b",
      sidebar: "#415a77",
      content: "#f0f2f5"
    },
    SteelGray: {
      topNav: "#2f3e46",
      sidebar: "#2f3e46",
      content: "#f0f2f5"
    }
  };
  
  var theme = themes[themeName] || themes.Storm;
  
  // Set CSS variables on the root element
  document.documentElement.style.setProperty('--top-nav-color', theme.topNav);
  // Also update inline styles on your elements if needed:
  var topNav = document.getElementById('topNavbar');
  var sidebar = document.getElementById('sidebar');
  var content = document.getElementById('content');
  if (topNav) {
    topNav.style.backgroundColor = theme.topNav;
    topNav.style.backdropFilter = "blur(10px)";
    topNav.style.webkitBackdropFilter = "blur(10px)";
  }
  if (sidebar) {
    sidebar.style.backgroundColor = theme.sidebar;
  }
  if (content) {
    content.style.backgroundColor = theme.content;
  }
  document.body.style.backgroundColor = theme.content;
}


// ============================
// Sidebar Toggling Functions
// ============================
function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  // For narrow screens, toggle the "open" class
  if (window.innerWidth < 768) {
    sidebar.classList.toggle('open');
  } else {
    // For wider screens, use the existing behavior (e.g. toggling "hidden")
    sidebar.classList.toggle('hidden');
    var content = document.getElementById('content');
    content.classList.toggle('full-width');
  }
}

// ============================
// Navigation Helper
// ============================
function setActiveNav(activeId) {
  var navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(function(link) {
    link.classList.remove('active');
  });
  var activeLink = document.getElementById(activeId);
  if (activeLink) {
    activeLink.classList.add('active');
  }
}

// ============================
// Exam Caching & Parsing Functions
// ============================
// Open (or create) a database called "mdxam-db" with two object stores.
async function saveExamToCache(examText) {
  const examId = Date.now();
  let title = "Untitled Exam";
  const lines = examText.split('\n');
  if (lines[0] && lines[0].startsWith('# ')) {
    title = lines[0].substring(2).trim();
  }
  const exam = { id: examId, text: examText, title: title };
  
  const db = await dbPromise;
  await db.put('exams', exam);
  
  return exam;
}


function deleteExamFromCache(examId) {
  var cachedExams = JSON.parse(localStorage.getItem('cachedExams')) || [];
  cachedExams = cachedExams.filter(function(e) {
    return e.id !== examId;
  });
  localStorage.setItem('cachedExams', JSON.stringify(cachedExams));
}


async function loadExamFromCache(examId) {
  const db = await dbPromise;
  const exam = await db.get('exams', examId);
  if (!exam) {
    alert("Exam not found in cache.");
    return;
  }
  examData = parseExamMarkdown(exam.text);
  examData.examId = exam.id; // Set the exam ID for results.
  
  // Randomize the order of questions
  examData.questions = shuffle(examData.questions);

  // Randomize choices, etc.
  examData.questions.forEach(function(question) {
    question.choices = shuffle(question.choices);
  });
  
  currentQuestionIndex = 0;
  userAnswers = {};
  if (examData.time) {
    startTimer(examData.time);
  }
  renderExamSimulation();
}


function parseExamMarkdown(text) {
  var lines = text.split('\n');
  var exam = { title: '', time: '', questions: [] };
  var currentQuestion = null;
  lines.forEach(function(line) {
    line = line.trim();
    if (line.startsWith('# ')) {
      exam.title = line.substring(2).trim();
    } else if (line.startsWith('Time:')) {
      exam.time = line.substring(5).trim();
    } else if (line.startsWith('## ')) {
      if (currentQuestion) { exam.questions.push(currentQuestion); }
      currentQuestion = { question: line.substring(3).trim(), choices: [] };
    } else if (line.startsWith('- [')) {
      var match = line.match(/- \[([ xX])\]\s*(.+)/);
      if (match && currentQuestion) {
        var isCorrect = match[1].toLowerCase() === 'x';
        currentQuestion.choices.push({ text: match[2].trim(), isCorrect: isCorrect });
      }
    }
  });
  if (currentQuestion) { exam.questions.push(currentQuestion); }
  return exam;
}

// Fisher-Yates Shuffle to randomize an array.
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ============================
// Exam Simulation Functions
// ============================
function renderExamSimulation() {
  renderQuestion(currentQuestionIndex);
}

function renderQuestion(index) {
  // Save current answer before navigating.
  if (typeof currentQuestionIndex === 'number' && document.querySelector('#content form')) {
    saveCurrentAnswer();
  }
  currentQuestionIndex = index;
  if (!examData || !examData.questions.length) return;
  var question = examData.questions[index];
  
  // --- New code to handle images ---
  var imagePattern = /!\[\[([^\]]+)\]\]/g;
  // Process the question text and store in a new variable.
  var processedQuestion = question.question.replace(imagePattern, function(match, imageUrl) {
    return '</br><img src="' + imageUrl + '" alt="Question Image" style="max-width:100%; margin-top:1rem;">';
  });
  // console.log("Processed question text:", processedQuestion);
  // --- End new code ---
  
  var content = document.getElementById('content');
  content.innerHTML = "";
  
  // ============================
  // Progress Bar Container
  // ============================
  // Create a container for the progress bar.
  var progressContainer = document.createElement('div');
  progressContainer.className = "progress-container";

  // Create the progress bar container.
  var progressOuter = document.createElement('div');
  progressOuter.className = "progress mb-3";

  // Create the inner progress bar.
  var progressBar = document.createElement('div');
  progressBar.className = "progress-bar";
  var progressPercent = Math.floor(((index + 1) / examData.questions.length) * 100);
  progressBar.style.width = progressPercent + "%";
  progressBar.setAttribute("role", "progressbar");
  progressBar.setAttribute("aria-valuenow", index + 1);
  progressBar.setAttribute("aria-valuemin", "0");
  progressBar.setAttribute("aria-valuemax", examData.questions.length);
  progressOuter.appendChild(progressBar);

  // Create the overlay text element.
  var progressText = document.createElement('div');
  progressText.className = "progress-text";
  progressText.textContent = "Question " + (index + 1) + " of " + examData.questions.length;

  // Append both to the container.
  progressContainer.appendChild(progressOuter);
  progressContainer.appendChild(progressText);
  content.appendChild(progressContainer);
  
  
  // Display exam title on the first question.
  if (index === 0 && examData.title) {
    var titleEl = document.createElement('h2');
    titleEl.className = "text-center mb-4";
    titleEl.textContent = examData.title;
    content.appendChild(titleEl);
  }
  
  // Create question card.
  var card = document.createElement('div');
  card.className = "card";
  var cardBody = document.createElement('div');
  cardBody.className = "card-body";
  var qTitle = document.createElement('h5');
  qTitle.className = "card-title";
  // Use innerHTML to render HTML (including <img> tags) in the question text.
  qTitle.innerHTML = "Q" + (index + 1) + ": " + processedQuestion;
  cardBody.appendChild(qTitle);
  
  // Create form for answer options.
  var form = document.createElement('form');
  // Determine whether to use radio buttons or checkboxes.
  // For instance, if exactly one answer is correct, use radio buttons.
  var correctCount = question.choices.filter(choice => choice.isCorrect).length;
  var inputType = (correctCount === 1) ? 'radio' : 'checkbox';

 // Then, in your loop over answer choices:
  question.choices.forEach(function(choice, i) {
    var div = document.createElement('div');
    div.className = "form-check";
    var input = document.createElement('input');
    input.type = inputType;
    input.className = "form-check-input";
    // For radio buttons, assign a common name so only one can be selected.
    if (inputType === 'radio') {
      input.name = "question-" + index;
    }
    input.id = "q" + index + "-option" + i;
    input.dataset.correct = choice.isCorrect;
    if (userAnswers[index] && typeof userAnswers[index][i] !== "undefined") {
      input.checked = userAnswers[index][i];
    }
    var label = document.createElement('label');
    label.className = "form-check-label";
    label.setAttribute("for", input.id);
    label.textContent = choice.text;
    div.appendChild(input);
    div.appendChild(label);
    form.appendChild(div);
  });
  cardBody.appendChild(form);
  
  // Navigation buttons.
  var navDiv = document.createElement('div');
  navDiv.className = "mt-3 d-flex justify-content-between";
  if (index > 0) {
    var prevBtn = document.createElement('button');
    prevBtn.className = "btn btn-secondary";
    prevBtn.textContent = "Previous";
    prevBtn.addEventListener('click', function(e) {
      e.preventDefault();
      saveCurrentAnswer();
      renderQuestion(index - 1);
    });
    navDiv.appendChild(prevBtn);
  } else {
    navDiv.appendChild(document.createElement('div'));
  }
  if (index < examData.questions.length - 1) {
    var nextBtn = document.createElement('button');
    nextBtn.className = "btn btn-primary";
    nextBtn.textContent = "Next";
    nextBtn.addEventListener('click', function(e) {
      e.preventDefault();
      saveCurrentAnswer();
      renderQuestion(index + 1);
    });
    navDiv.appendChild(nextBtn);
  } else {
    var submitBtn = document.createElement('button');
    submitBtn.className = "btn btn-success";
    submitBtn.textContent = "Submit Exam";
    submitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      saveCurrentAnswer();
      scoreExam();
    });
    navDiv.appendChild(submitBtn);
  }
  cardBody.appendChild(navDiv);
  card.appendChild(cardBody);
  content.appendChild(card);
}

function saveCurrentAnswer() {
  var form = document.querySelector('#content form');
  if (!form) return;
  // Select both checkboxes and radio buttons.
  var inputs = form.querySelectorAll('input[type="checkbox"], input[type="radio"]');
  var selections = [];
  inputs.forEach(function(chk) {
    selections.push(chk.checked);
  });
  userAnswers[currentQuestionIndex] = selections;
}

async function scoreExam() {
  var score = 0;
  var total = examData.questions.length;
  examData.questions.forEach(function(question, idx) {
    var isCorrect = true;
    var savedAnswer = userAnswers[idx] || [];
    question.choices.forEach(function(choice, i) {
      if (choice.isCorrect !== (savedAnswer[i] || false)) {
        isCorrect = false;
      }
    });
    if (isCorrect) score++;
  });
  // Wait for the result to be stored before proceeding.
  await storeExamResult(examData.examId, score, total);
  // Optionally, add a small delay here if needed:
  // await new Promise(resolve => setTimeout(resolve, 100));
  showReviewCurrent(score, total);
}

// ============================
// Exam Results Storage Functions
// ============================
async function storeExamResult(examId, score, total) {
  // If no examId is provided, create one and assign it to examData
  if (!examId) {
    examId = Date.now();
    examData.examId = examId;
  }
  
  const db = await dbPromise; // dbPromise should be your IndexedDB connection using idb
  
  // Try to get the existing record for this examId
  let record = await db.get('examResults', examId);
  
  // If there's no record yet, create one
  if (!record) {
    record = {
      examId: examId,
      results: []
    };
  }
  
  // Calculate the attempt number and other metrics
  var attemptNumber = record.results.length + 1;
  var scorePercent = Math.round((score / total) * 100);
  var date = new Date().toLocaleString();
  
  // Create the attempt data snapshot
  var attemptData = {
    examTitle: examData.title,
    questions: examData.questions,
    userAnswers: JSON.parse(JSON.stringify(userAnswers))
  };
  
  var newResult = {
    attemptNumber: attemptNumber,
    scorePercent: scorePercent,
    score: score,
    total: total,
    date: date,
    attemptData: attemptData
  };
  
  // Append the new result to the record's results array.
  record.results.push(newResult);
  
  // Save the record back to the "examResults" object store.
  await db.put('examResults', record);
}

// ============================
// Get Exam Results from IndexedDB
// ============================
async function getExamResults(examId) {
  const db = await dbPromise; // dbPromise should be your open database connection
  return await db.get('examResults', examId);
}


// ============================
// Review for Current Attempt Functions
// ============================
async function showReviewCurrent(score, total) {
  var content = document.getElementById('content');
  content.innerHTML = "";
  
  var percentage = Math.round((score / total) * 100);
  var summaryHeader = document.createElement('div');
  summaryHeader.className = "mb-4";
  summaryHeader.innerHTML = "<h3>Result: " + percentage + "% (" + score + "/" + total + ")</h3>";
  content.appendChild(summaryHeader);
  
  // Retrieve exam results from IndexedDB
  const record = await getExamResults(examData.examId);
  if (!record || !record.results || record.results.length === 0) {
    content.innerHTML += "<p>No attempt data found.</p>";
    return;
  }
  
  // Use the latest attempt from the record.
  var latestResult = record.results[record.results.length - 1];
  var questions = latestResult.attemptData.questions;
  var userAns = latestResult.attemptData.userAnswers;
  
  // Render a toggle for missed questions.
  var toggleDiv = document.createElement('div');
  toggleDiv.className = "mb-3";
  var toggleLabel = document.createElement('label');
  toggleLabel.className = "form-check-label me-2";
  toggleLabel.setAttribute("for", "toggleMissed");
  toggleLabel.textContent = "Show missed questions only";
  var toggleInput = document.createElement('input');
  toggleInput.type = "checkbox";
  toggleInput.className = "form-check-input";
  toggleInput.id = "toggleMissed";
  toggleInput.addEventListener('change', function() {
    renderReviewListForCurrent(this.checked, questions, userAns);
  });
  toggleDiv.appendChild(toggleLabel);
  toggleDiv.appendChild(toggleInput);
  content.appendChild(toggleDiv);
  
  // Initially render all questions.
  renderReviewListForCurrent(false, questions, userAns);
  
  var backBtn = document.createElement('button');
  backBtn.className = "btn btn-primary mt-3";
  backBtn.textContent = "Back to Results";
  backBtn.addEventListener('click', function() {
    renderResults();  // Make sure renderResults() is updated to work with IndexedDB if needed.
  });
  content.appendChild(backBtn);
}

// Renders the review view for a specific exam attempt.
async function renderReviewForAttempt(examId, attemptNumber) {
  const db = await dbPromise; // your IndexedDB connection via idb
  // Retrieve the record for this examId.
  const record = await db.get('examResults', examId);
  if (!record || !record.results || record.results.length === 0) {
    alert("No results for this exam.");
    return;
  }
  
  // Find the attempt that matches the given attemptNumber.
  const result = record.results.find(r => r.attemptNumber === attemptNumber);
  if (!result) {
    alert("Attempt not found.");
    return;
  }
  
  var attemptData = result.attemptData;
  var questions = attemptData.questions;
  var userAns = attemptData.userAnswers;
  
  var content = document.getElementById('content');
  content.innerHTML = "<h2>Review: " + attemptData.examTitle + " (Attempt " + attemptNumber + ")</h2>";
  
  // For each question, render only if it's missed (or modify as needed)
  questions.forEach(function(question, idx) {
    let isCorrect = true;
    const savedAnswer = userAns[idx] || [];
    question.choices.forEach(function(choice, i) {
      if (choice.isCorrect !== (savedAnswer[i] || false)) {
        isCorrect = false;
      }
    });
    if (isCorrect) return; // Skip if the question was answered correctly.
    
    var card = document.createElement('div');
    card.className = "card mb-3";
    card.style.backgroundColor = "#f8d7da";
    
    var cardBody = document.createElement('div');
    cardBody.className = "card-body";
    
    // Process the question text to convert custom image markdown ![[...]] to an <img> tag.
    var imagePattern = /!\[\[([^\]]+)\]\]/g;
    var processedQuestion = question.question.replace(imagePattern, function(match, imageUrl) {
      return '<img src="' + imageUrl + '" alt="Question Image" style="max-width:100%; margin-top:1rem;">';
    });
    
    var qTitle = document.createElement('h5');
    qTitle.className = "card-title";
    // Use innerHTML so that the <img> tag renders.
    qTitle.innerHTML = "Q" + (idx + 1) + ": " + processedQuestion;
    cardBody.appendChild(qTitle);
    
    var listGroup = document.createElement('ul');
    listGroup.className = "list-group";
    question.choices.forEach(function(choice, i) {
      var li = document.createElement('li');
      li.className = "list-group-item";
      var optionText = choice.isCorrect
        ? "<strong>Correct:</strong> " + choice.text
        : "<strong>Incorrect:</strong> " + choice.text;
      if (savedAnswer[i]) {
        optionText += ' <span class="badge bg-secondary">Your selection</span>';
      }
      li.innerHTML = optionText;
      listGroup.appendChild(li);
    });
    cardBody.appendChild(listGroup);
    card.appendChild(cardBody);
    content.appendChild(card);
  });
  
  // Add a Back button to return to the Results view.
  var backBtn = document.createElement('button');
  backBtn.className = "btn btn-primary mt-3";
  backBtn.textContent = "Back to Results";
  backBtn.addEventListener('click', function() {
    renderResults();
  });
  content.appendChild(backBtn);
}

async function renderReviewListForCurrent(showMissedOnly) {
  const db = await dbPromise; // your IndexedDB connection (using idb)
  // Retrieve the record for the current exam.
  const record = await db.get('examResults', examData.examId);
  if (!record || !record.results || record.results.length === 0) {
    document.getElementById('content').innerHTML += "<p>No attempt data found.</p>";
    return;
  }
  // Use the latest attempt.
  var latestResult = record.results[record.results.length - 1];
  var questions = latestResult.attemptData.questions;
  var userAns = latestResult.attemptData.userAnswers;
  
  // Create the container for the review list.
  var reviewList = document.createElement('div');
  reviewList.id = "reviewListCurrent";
  
  questions.forEach(function(question, idx) {
    var isCorrect = true;
    var savedAnswer = userAns[idx] || [];
    question.choices.forEach(function(choice, i) {
      if (choice.isCorrect !== (savedAnswer[i] || false)) {
        isCorrect = false;
      }
    });
    if (showMissedOnly && isCorrect) return;
    
    var card = document.createElement('div');
    card.className = "card mb-3";
    if (!isCorrect) {
      card.style.backgroundColor = "#f8d7da"; // light red for missed questions
    }
    var cardBody = document.createElement('div');
    cardBody.className = "card-body";
    
    // Process image markdown in the question text.
    var imagePattern = /!\[\[([^\]]+)\]\]/g;
    var processedQuestion = question.question.replace(imagePattern, function(match, imageUrl) {
      return '<img src="' + imageUrl + '" alt="Question Image" style="max-width:100%; margin-top:1rem;">';
    });
    
    var qTitle = document.createElement('h5');
    qTitle.className = "card-title";
    qTitle.innerHTML = "Q" + (idx + 1) + ": " + processedQuestion;
    cardBody.appendChild(qTitle);
    
    var listGroup = document.createElement('ul');
    listGroup.className = "list-group";
    question.choices.forEach(function(choice, i) {
      var li = document.createElement('li');
      li.className = "list-group-item";
      var optionText = choice.isCorrect
        ? "<strong>Correct:</strong> " + choice.text
        : "<strong>Incorrect:</strong> " + choice.text;
      if (savedAnswer[i]) {
        optionText += ' <span class="badge bg-secondary">Your selection</span>';
      }
      li.innerHTML = optionText;
      listGroup.appendChild(li);
    });
    cardBody.appendChild(listGroup);
    card.appendChild(cardBody);
    reviewList.appendChild(card);
  });
  
  // Remove any existing review list and then append the new one.
  var oldList = document.getElementById('reviewListCurrent');
  if (oldList) { oldList.remove(); }
  document.getElementById('content').appendChild(reviewList);
}


// ============================
// Results View Functions
// ============================
// NEW
async function renderResults() {
  const db = await dbPromise;  // your IndexedDB connection using idb
  const allRecords = await db.getAll('examResults');
  
  //alphebetize the exam array
  allRecords.sort((a, b) => {
    return a.results[0].attemptData.examTitle.localeCompare(b.results[0].attemptData.examTitle);
  });

  const content = document.getElementById('content');
  content.innerHTML = "<h2>Results</h2>";
  
  if (allRecords.length === 0) {
    content.innerHTML += "<p>No exam results available.</p>";
    return;
  }
  
  // Loop over each exam record.
  allRecords.forEach(record => {
    const examId = record.examId;
    const results = record.results;

    // Create a container for this exam's results.
    const examContainer = document.createElement('div');
    examContainer.className = "exam-results-container";
    
    // Create header (styled like the exam item header on the Exams page)
    const headerDiv = document.createElement('div');
    headerDiv.className = "exam-item";  // reuse the same CSS that styles exam items
    headerDiv.style.display = "flex";
    headerDiv.style.justifyContent = "space-between";
    headerDiv.style.alignItems = "center";
    headerDiv.style.padding = "0.5rem";
    headerDiv.style.border = "1px solid #ddd";
    headerDiv.style.marginBottom = "0.5rem";
    
    // Create exam title span.
    const titleSpan = document.createElement('span');
    titleSpan.className = "exam-title";
    titleSpan.textContent = results[0].attemptData.examTitle;
    titleSpan.style.flexGrow = "1";
    titleSpan.style.marginRight = "1rem";
    headerDiv.appendChild(titleSpan);
    
    // Create an "Open" button to toggle the details.
    const openBtn = document.createElement('button');
    openBtn.className = "btn btn-sm btn-outline-primary";
    openBtn.textContent = "Open";
    openBtn.style.marginRight = "0.5rem";
    openBtn.addEventListener('click', function(e) {
      e.preventDefault();
      // Toggle this exam's details
      const detailsDiv = examContainer.querySelector('.results-details');
      
      // Optionally close other open exam details:
      document.querySelectorAll('.results-details.open').forEach(el => {
        if (el !== detailsDiv) {
          el.classList.remove('open');
          // Also update the corresponding button text to "Open"
          const btn = el.closest('.exam-results-container').querySelector('.exam-item button.btn-outline-primary');
          if (btn) btn.textContent = "Open";
        }
      });
      
      detailsDiv.classList.toggle('open');
      openBtn.textContent = detailsDiv.classList.contains('open') ? "Close" : "Open";
    });
    headerDiv.appendChild(openBtn);
    
      // Create "Delete All Results" button.
      const deleteAllBtn = document.createElement('button');
      deleteAllBtn.className = "btn btn-sm btn-outline-danger";
      deleteAllBtn.textContent = "❌";
      deleteAllBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        if (confirm("Are you sure you want to delete all results for this exam?")) {
          await db.delete('examResults', examId);
          renderResults();
        }
      });
      headerDiv.appendChild(deleteAllBtn);

    examContainer.appendChild(headerDiv);
    
    // Create a details container for chart and table; initially collapsed.
    const detailsDiv = document.createElement('div');
    detailsDiv.className = "results-details"; // CSS will control its collapsed state
    // --- Chart Section ---
    const chartContainer = document.createElement('div');
    chartContainer.className = "chart-container";
    const canvas = document.createElement('canvas');
    canvas.id = "chart-" + examId;
    chartContainer.appendChild(canvas);
    detailsDiv.appendChild(chartContainer);
    
    const labels = results.map(r => "Attempt " + r.attemptNumber);
    const dataPoints = results.map(r => r.scorePercent);
    
    if (typeof Chart !== "undefined") {
      // Retrieve the theme's top nav color to use as the line color.
      const topNavColor = getComputedStyle(document.documentElement)
                           .getPropertyValue('--top-nav-color').trim();
      new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Score %',
            data: dataPoints,
            fill: false,
            borderColor: topNavColor,
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              max: 100
            }
          }
        }
      });
    }
    
    // --- Table Section ---
    const table = document.createElement('table');
    table.className = "table table-striped";
    const thead = document.createElement('thead');
    thead.innerHTML = "<tr><th>Attempt #</th><th>Score (%)</th><th>Date</th><th>Review</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    
    results.forEach(result => {
      const tr = document.createElement('tr');
      const tdAttempt = document.createElement('td');
      tdAttempt.textContent = result.attemptNumber;
      const tdScore = document.createElement('td');
      tdScore.textContent = result.scorePercent + "%";
      const tdDate = document.createElement('td');
      tdDate.textContent = result.date;
      const tdReview = document.createElement('td');
      const reviewLink = document.createElement('a');
      reviewLink.href = "#";
      reviewLink.textContent = "Review";
      reviewLink.addEventListener('click', function(e) {
        e.preventDefault();
        renderReviewForAttempt(examId, result.attemptNumber);
      });
      tdReview.appendChild(reviewLink);
      
      tr.appendChild(tdAttempt);
      tr.appendChild(tdScore);
      tr.appendChild(tdDate);
      tr.appendChild(tdReview);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    detailsDiv.appendChild(table);
    
    // Append the details container (initially collapsed).
    examContainer.appendChild(detailsDiv);
    
    content.appendChild(examContainer);
  });
}

async function deleteExamResults(examId) {
  const db = await dbPromise;
  await db.delete('examResults', examId);
}


// ============================
// Timer Functions (Optional)
// ============================
function timeStringToSeconds(timeStr) {
  var parts = timeStr.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function startTimer(timeStr) {
  examTimer = timeStringToSeconds(timeStr);
  updateTimerDisplay();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(function() {
    examTimer--;
    updateTimerDisplay();
    if (examTimer <= 0) {
      clearInterval(timerInterval);
      alert('Time is up!');
      scoreExam();
    }
  }, 1000);
}

function updateTimerDisplay() {
  // (Implement timer display update if desired.)
}

// ============================
// Dark Mode Function
// ============================
function applyDarkMode(enabled) {
  if (enabled) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// ============================
// View Rendering Functions
// ============================

// renderExamList: "Exams" view - list cached exams.
function renderExamList() {
  var content = document.getElementById('content');
  content.innerHTML = `
    <h2>Exams</h2>
    <div id="cachedExamsList">
      <div id="examList"></div>
    </div>
  `;
  renderCachedExams();
}


// ============================
// Render Cached Exams Functions
// ============================
async function renderCachedExams() {
  const db = await dbPromise;
  const cachedExams = await db.getAll('exams');

  // Sort the cached exams alphabetically by title.
  cachedExams.sort((a, b) => a.title.localeCompare(b.title));

  var examList = document.getElementById('examList');
  examList.innerHTML = "";
  if (cachedExams.length === 0) {
    examList.innerHTML = "<p>No cached exams found. Please upload an exam using the ➕ <a href=\"#\" onclick=\"renderAddExam(); return false;\">Add Exam</a> option.</p><p>For more information on the usage of MDXam, please refer to the <a href=\"https://github.com/msalty/mdxam\">documentation</a>.";
    return;
  }
  
  cachedExams.forEach(function(exam) {
    var examItem = document.createElement('div');
    examItem.className = "exam-item";
    examItem.setAttribute("data-id", exam.id);
    examItem.style.display = "flex";
    examItem.style.justifyContent = "space-between";
    examItem.style.alignItems = "center";
    examItem.style.padding = "0.5rem";
    examItem.style.border = "1px solid #ddd";
    examItem.style.marginBottom = "0.5rem";
    
    var titleSpan = document.createElement('span');
    titleSpan.className = "exam-title";
    titleSpan.textContent = exam.title;
    titleSpan.style.flexGrow = "1";
    titleSpan.style.marginRight = "1rem";
    examItem.appendChild(titleSpan);
    
    var openBtn = document.createElement('button');
    openBtn.className = "btn btn-sm btn-outline-primary";
    openBtn.textContent = "Open";
    openBtn.style.marginRight = "0.5rem";
    openBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      loadExamFromCache(exam.id);
    });
    examItem.appendChild(openBtn);
    
    var deleteBtn = document.createElement('button');
    deleteBtn.className = "btn btn-sm btn-outline-danger";
    deleteBtn.textContent = "❌";
    deleteBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (confirm("Are you sure you want to delete this exam?")) {
        // For simplicity, you might want to delete just this exam.
        db.delete('exams', exam.id).then(() => renderCachedExams());
      }
    });
    examItem.appendChild(deleteBtn);
    
    examList.appendChild(examItem);
  });
}

// ============================
// Render Add Exams Functions
// ============================
function renderAddExam() {
  var content = document.getElementById('content');
  content.innerHTML = `
    <h2>Add Exam</h2>
    <form id="examUploadForm">
      <div class="mb-3">
        <label for="examFiles" class="form-label">
          Upload Exam Markdown File (*.md) and Related Images
        </label>
        <!-- Allow multiple files: the markdown file plus image files -->
        <input type="file" id="examFiles" class="form-control" multiple>
      </div>
      <button type="submit" class="btn btn-primary">Upload</button>
    </form>
  `;
  //         Removed line above
  //         <input type="file" id="examFiles" class="form-control" accept=".md,image/*" multiple>

  var form = document.getElementById('examUploadForm');
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var fileInput = document.getElementById('examFiles');
    var files = Array.from(fileInput.files);
    if (files.length === 0) {
      alert("Please select files.");
      return;
    }
    
    // Identify the Markdown file (by extension) and the image files.
    var mdFile = files.find(file => file.name.toLowerCase().endsWith('.md'));
    if (!mdFile) {
      alert("Please include a Markdown (.md) file.");
      return;
    }
    var imageFiles = files.filter(file => !file.name.toLowerCase().endsWith('.md'));
    
    // Process image files: Convert each to a data URL.
    var imagePromises = imageFiles.map(file => {
      return new Promise((resolve, reject) => {
        var reader = new FileReader();
        reader.onload = function(e) {
          // Resolve with an object mapping filename to data URL.
          resolve({ name: file.name, dataUrl: e.target.result });
        };
        reader.onerror = function(e) {
          reject(e);
        };
        reader.readAsDataURL(file);
      });
    });
    
    // Wait until all image files are processed.
    Promise.all(imagePromises).then(imageResults => {
      var imageMap = {};
      imageResults.forEach(item => {
        imageMap[item.name] = item.dataUrl;
      });
      
      // Read the Markdown file.
      var mdReader = new FileReader();
      mdReader.onload = function(e) {
        var examText = e.target.result;
        // Replace our custom image syntax ![[filename]] with an <img> tag using the data URL.
        examText = examText.replace(/!\[\[([^\]]+)\]\]/g, function(match, filename) {
          if (imageMap[filename]) {
            return '<br><img src="' + imageMap[filename] + '" alt="Question Image" style="max-width:100%; margin-top:1rem;">';
          }
          return match; // If no matching image, leave unchanged.
        });
        
        // Save the processed exam text.
        saveExamToCache(examText);
        alert("Exam uploaded and cached!");
        renderExamList();
      };
      mdReader.readAsText(mdFile);
    }).catch(error => {
      console.error("Error reading image files:", error);
      alert("Error processing image files.");
    });
  });
}

///////////////////
// Theme Selector
///////////////////
function renderSettings() {
  var content = document.getElementById('content');
  content.innerHTML = `
    <h2>Settings</h2>
    <label for="themeSelect" class="form-label">Select Theme:</label>
    <select id="themeSelect" class="form-select">
      <option value="Storm">Storm</option>
      <option value="Redshift">Redshift</option>
      <option value="Diver">Diver</option>
      <option value="SteelGray">Steel Gray</option>
    </select>
  `;

  // Set the dropdown to the saved theme or default to Storm.
  var savedTheme = localStorage.getItem('theme') || "Storm";
  var themeSelect = document.getElementById('themeSelect');
  themeSelect.value = savedTheme;

  // When the theme changes, apply the selected theme.
  themeSelect.addEventListener('change', function() {
    applyTheme(this.value);
  });
}
