# MDXam - Markdown Exam Simulator PWA

MDXam is a mobile-first application that allows users to upload, take, and review exams written in Markdown language. The application is designed to work offline, using browser-based cache. It offers customizable themes, real-time exam simulation with progress tracking, randomized questions and answers, and detailed result review on missed questions with charts.

## Table of Contents

- [Features](#features)
- [Architecture & Technologies](#architecture--technologies)
- [Installation & Setup](#installation--setup)
- [Usage](#usage)
  - [Uploading an Exam](#uploading-an-exam)
  - [Taking an Exam](#taking-an-exam)
  - [Reviewing Results](#reviewing-results)
  - [Theming](#theming)
- [Service Worker & Offline Support](#service-worker--offline-support)
- [Storage](#storage)
- [Customization](#customization)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- **Offline Functionality:**  
  Utilizes a Service Worker to cache assets (HTML, CSS, JS, icons, etc.) so the app works reliably offline.
  
- **Exam Upload & Parsing:**  
  - Exams are uploaded as Markdown files.  
  - The parser supports custom image syntax (e.g., `![[banana.jpg]]`), with images converted to data URLs for offline use.
  - The app randomizes the order of exam questions and, optionally, answer choices.

- **Exam Simulation:**  
  - A progress bar tracks the exam’s progress.
  - Navigation buttons allow users to move between questions.
  - The progress bar displays text over the entire bar regardless of fill.

- **Results & Review:**  
  - Exam results (score, date, attempt details) are stored in IndexedDB.
  - A results view displays a chart (using Chart.js) of past attempts.
  - Users can review each exam attempt, with incorrect questions highlighted.
  - A header for each exam in the Results view mimics the styling of the Exams page, including “Open” and “Delete All Results” controls.
  - Exams in both the Exams and Results views are alphabetized.

- **Theming:**  
  Users can select a theme from a drop-down menu in the settings. Themes change the color of the top navigation bar, left navigation bar, and main content area. Example themes include:
  - **Storm:**  
    - Top Nav Bar: `rgba(27, 38, 59, 0.8)` (with blur effect)  
    - Left Nav Bar: `#415a77`  
    - Main Content Area: `#e0e1dd`
  - **Redshift:**  
    - Top Nav Bar: `rgba(102, 7, 8, 0.8)` (with blur effect)  
    - Left Nav Bar: `#ba181b`  
    - Main Content Area: `#f5f3f4`

## Architecture & Technologies

- **Progressive Web App (PWA):**  
  Works offline with Service Workers and caching.
  
- **Service Worker:**  
  Caches essential files (HTML, CSS, JS, icons) for offline usage.
  
- **IndexedDB (using idb):**  
  Stores uploaded exams and exam results persistently with a larger quota than localStorage.
  
- **Chart.js:**  
  Displays results charts (line charts) to track exam scores over multiple attempts.
  
- **Bootstrap:**  
  Provides base styling for buttons, forms, and layouts.
  
- **Custom CSS & JavaScript:**  
  Handle theme switching, dynamic rendering of exam questions, answers, progress bars, and review views.

## Installation & Setup

1. **Clone the Repository:**
   ```bash
   git clone ==NEEDS UPDATE==
   cd MDXam
   ```
2. Serve the Application:
   - Since this is a PWA, it’s recommended to run it on a local server.
   - For example, using [http-server](https://www.npmjs.com/package/http-server):
     ```bash
     npm install -g http-server
     http-server -p 9000
     ```
   - Then, open your browser to `http://127.0.0.1:9000`.

3. Configure Your Service Worker & Manifest:
   - Ensure that the `sw.js` and `manifest.json` files list the correct asset paths.
   - Update the cache version in `sw.js` when you make changes.

## Usage

### Uploading an Exam

1. Navigate to the **Add Exam** section via the left navigation bar.
2. Select your exam file (a Markdown file) along with any associated image files.
3. The app processes the Markdown, converting custom image syntax to embedded images (using data URLs).
4. After upload, you see a confirmation and are automatically redirected to the **Exams** list.

### Taking an Exam

1. On the **Exams** page, click on an exam to open it.
2. The exam simulation begins:
   - Questions are presented in a randomized order.
   - Answer choices are also randomized.
   - A progress bar at the top shows your progress, with the current question number centered over the entire bar.
3. You can navigate between questions using **Previous** and **Next** buttons, then **Submit Exam** when finished.

### Reviewing Results

1. After submitting an exam, your results (score, date, attempt details) are stored in IndexedDB.
2. Navigate to the **Results** section to view a summary:
   - Each exam’s results are displayed with a header styled like the Exams page (including exam name, an "Open" button, and delete controls).
   - A chart shows your exam score over multiple attempts.
   - A table lists each attempt.
   - You can click on **Review** to view missed questions, with the option to filter to only missed questions.
3. You can also delete all results for an exam from this page.

### Theming

1. Go to **Settings**.
2. Select a theme from the dropdown (e.g., Storm or Redshift).
3. The top nav bar, left nav bar, main content, and even the body background will update to match the chosen theme.
4. The selected theme is stored and applied on subsequent visits.

## Service Worker & Offline Support

- **Installation:**  
  The service worker defined in `sw.js` caches all essential files (HTML, CSS, JS, icons, etc.) for offline use.
  
- **Update Cycle:**  
  The service worker version is managed via the `CACHE_NAME` variable. When updated, the worker cleans up old caches.
  
- **Cache Strategy:**  
  The service worker uses a cache-first strategy. This ensures that when offline, the app will load from cache.

## Storage

- **Exams:**  
  Uploaded exams are stored in IndexedDB under an object store named `exams` (keyed by `id`).

- **Exam Results:**  
  Results are stored in IndexedDB under the `examResults` object store, with each record using an inline key (`examId`) and an array of result attempts.

- **Quota:**  
  IndexedDB has a much larger quota than localStorage, making it suitable for storing larger files (including images).

## Customization

- **Randomization:**  
  Exams are randomized (both questions and answer choices) each time they are loaded.
- **Styling:**  
  You can modify `style.css` to change the appearance of the navigation bars, progress bars, and other UI elements.
- **Themes:**  
  Edit the `applyTheme()` function in `main.js` to add more themes or modify the existing color schemes.

## Troubleshooting

- **Service Worker:**  
  If you update your assets, remember to update the cache version in `sw.js` to force a refresh.
- **Caching Issues:**  
  Clear your browser cache or use incognito mode if changes aren’t reflected.
- **Storage Quota:**  
  If you encounter quota errors, check the size of the uploaded files (especially images). Consider using data URL conversion for offline persistence.

## License

This project is licensed under the MIT License – see the [LICENSE](LICENSE) file for details.
