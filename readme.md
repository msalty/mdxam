# MDXam

MDXam turns plain Markdown study guides into private practice exams. It is an installable, offline-first web app with no runtime dependencies, accounts, or server-side data storage.

[Open MDXam](https://msalty.github.io/mdxam/)

## Highlights

- Installable PWA with an offline application shell and update notifications.
- ZIP imports, local Markdown and image imports, pasted Markdown, and public URL imports.
- Validation and preview before an exam is saved.
- Built-in Markdown editor with live validation and image replacement.
- Randomized questions and answer choices.
- Full-exam or randomized subset attempts with percentage-based result tracking.
- Timed and untimed sessions with automatic local resume.
- Multiple-choice and select-all-that-apply questions.
- Question navigator, answered state, and flags.
- Distraction-free exam mode that hides application navigation during an attempt.
- Exact-match grading, explanations, attempt review, and expandable per-exam score history.
- Portable JSON backup and restore.
- Theme selection and accessible, responsive navigation.
- Local-first IndexedDB storage. Imported content is not uploaded by MDXam.

## Install

Visit the hosted application in a modern browser and choose **Install** when MDXam offers it. You can also use the browser's **Install app** or **Add to Home Screen** command.

The first successful visit stores MDXam's application shell for offline use. Public remote images can only be shown offline after the browser has cached them; images selected alongside a Markdown file are stored locally with the exam.

## Create an exam

Use one H1 heading for the exam title, optional `Time:` metadata, H2 headings for questions, and Markdown task-list items for answer choices.

```md
# Network Fundamentals
Time: 00:20:00

## Which protocol resolves a hostname to an IP address?
- [ ] DHCP
- [x] DNS
- [ ] HTTPS
- [ ] NTP

DNS maps domain names to IP addresses.

## Which are private IPv4 ranges? Select all that apply.
- [x] 10.0.0.0/8
- [x] 172.16.0.0/12
- [ ] 172.0.0.0/8
- [x] 192.168.0.0/16

See RFC 1918 for the complete definition.
```

Rules:

- `#` defines the title.
- `Time:` accepts `MM:SS` or `HH:MM:SS`.
- Each `##` begins a question.
- `- [x]` marks a correct answer; `- [ ]` marks an incorrect answer.
- One correct choice produces radio buttons. Multiple correct choices produce checkboxes.
- Text after the choices and before the next question is shown as the explanation during review.
- Questions without a correct answer are allowed with a warning and are excluded from the score.

## Images

Select a Markdown file and its image files together, then reference an image by filename:

```md
## Which component is highlighted? ![[motherboard.png]]
- [x] CPU socket
- [ ] DIMM slot
```

MDXam stores the image once as a binary `Blob` in IndexedDB. Attempts store answer IDs rather than duplicate image data.

You can also put exactly one Markdown exam and all of its images into a `.zip` file. Image files may be inside nested folders; MDXam matches `![[image.png]]` references by filename. Duplicate image filenames, password-protected archives, unsupported compression methods, oversized archives, and archives containing multiple Markdown files are rejected before anything is saved.

For compatibility with older exams, Markdown image syntax and simple legacy `<img src="…">` markup are displayed through a restricted renderer. Arbitrary imported HTML is never executed.

## Data and privacy

Exams, images, settings, active sessions, and results remain in browser storage on the current device. Deleting site data in the browser can remove them, so use **Settings → Export backup** periodically.

Deleting an exam also removes its associated images and result history. A backup includes all exams, local images, attempts, and settings.

## Development

MDXam uses native ES modules and browser APIs. There is no bundler and no production dependency installation.

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173`. A local HTTP server is required because service workers and ES modules do not run correctly from `file://` URLs.

Run the dependency-free test suite and syntax checks with:

```sh
npm test
npm run check
```

Project layout:

```text
main.js                  Application orchestration and views
src/exam/parser.js       Markdown parsing and validation
src/exam/scoring.js      Randomization and exact-match scoring
src/import/zip.js        Safe, dependency-free ZIP inspection
src/storage/database.js  IndexedDB schema, migration, and backup
src/ui/dom.js            Safe DOM rendering and UI helpers
sw.js                    Offline shell and runtime caching
```

## Browser support

Core exam functionality works in current Chromium, Firefox, and Safari releases. Installation details vary by platform. File handling and share-target integration are progressive enhancements and are not available in every browser.

## License

MDXam is available under the [MIT License](LICENSE).
