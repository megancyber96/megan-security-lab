// Keep the footer year current automatically.
const yearLabel = document.getElementById("year");
yearLabel.textContent = new Date().getFullYear();

const PASSWORD_LIMIT = 256;
const TEXT_LIMIT = 10000;

// Count only as far as the limit, avoiding large arrays for oversized pastes.
// A Unicode code point counts as one character; a composed emoji may use several.
function exceedsLimit(text, limit) {
  let count = 0;
  for (const character of text) {
    if (++count > limit) return true;
  }
  return false;
}

// Shared navigation keeps every tool's visibility and keyboard focus consistent.
function openTool(panel, opener, focusTarget) {
  toolsSection.hidden = true;
  panel.hidden = false;
  opener.setAttribute("aria-expanded", "true");
  focusTarget.focus();
}

function closeTool(panel, opener) {
  panel.hidden = true;
  toolsSection.hidden = false;
  opener.setAttribute("aria-expanded", "false");
  opener.focus();
}

// One clipboard operation at a time, even if a value changes while copying.
// A started system clipboard write cannot be cancelled by clearing this page.
let clipboardBusy = false;
const clipboardControls = [];
function refreshCopyButtons() {
  clipboardControls.forEach(control => {
    control.button.disabled = clipboardBusy || !control.output.value;
  });
}

function connectCopyButton(button, output, status, getRevision, name) {
  clipboardControls.push({ button, output });
  button.addEventListener("click", async () => {
    if (clipboardBusy || !output.value) return;
    const revision = getRevision();
    clipboardBusy = true;
    refreshCopyButtons();
    status.textContent = "Copying to the system clipboard… Clearing the page cannot cancel this copy.";
    try {
      await navigator.clipboard.writeText(output.value);
      if (revision === getRevision()) {
        status.textContent = `${name} copied to the system clipboard. Clearing the page does not remove this copy.`;
      }
    } catch {
      if (revision === getRevision()) {
        output.focus();
        output.select();
        status.textContent = `Automatic copy is unavailable. On desktop, use Ctrl+C or Command+C. On mobile, touch and hold the ${name.toLowerCase()}, select it, and choose Copy. This places it in the system clipboard.`;
      }
    } finally {
      clipboardBusy = false;
      refreshCopyButtons();
    }
  });
  refreshCopyButtons();
}

// Cache the page elements once so the event handlers are easy to read.
const toolsSection = document.getElementById("tools");
const analyzer = document.getElementById("analyzer");
const openButton = document.getElementById("open-analyzer");
const backButton = document.getElementById("back-to-tools");
const passwordInput = document.getElementById("password");
const toggleButton = document.getElementById("toggle-password");
const strengthLabel = document.getElementById("strength-label");
const strengthMeter = document.getElementById("strength-meter");

// Each rule holds its explanation and a function that returns true or false.
// Regular expressions look for character types anywhere in the password.
const rules = [
  { id: "length", text: "At least 12 characters", test: password => Array.from(password).length >= 12 },
  { id: "uppercase", text: "An uppercase letter (A–Z)", test: password => /[A-Z]/.test(password) },
  { id: "lowercase", text: "A lowercase letter (a–z)", test: password => /[a-z]/.test(password) },
  { id: "number", text: "A number (0–9)", test: password => /[0-9]/.test(password) },
  // Unicode punctuation and symbols count; whitespace and letters do not.
  { id: "special", text: "A special character (such as !, @, or #)", test: password => /[\p{P}\p{S}]/u.test(password) }
];
const strengthNames = ["Very Weak", "Weak", "Medium", "Strong", "Very Strong"];

// This small built-in example list is public reference data, not saved user input.
// It is deliberately limited: a missing match does not prove a password is safe.
const commonPasswords = new Set([
  "password", "password123", "password1", "123456", "12345678", "123456789",
  "1234567890", "123123", "111111", "000000", "qwerty", "qwerty123",
  "qwertyuiop", "abc123", "abcdef", "letmein", "welcome", "welcome123",
  "admin", "admin123", "iloveyou", "monkey", "dragon", "football", "changeme"
]);

function hasSequence(password) {
  // Look for any four adjacent characters from a number, alphabet, or keyboard
  // row. Check backwards too, so patterns like 654321 are also detected.
  const sequences = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  return sequences.some(sequence => {
    const reverse = Array.from(sequence).reverse().join("");
    for (let index = 0; index <= sequence.length - 4; index++) {
      if (password.includes(sequence.slice(index, index + 4)) ||
          password.includes(reverse.slice(index, index + 4))) return true;
    }
    return false;
  });
}

const patternChecks = [
  { id: "common", text: "Contains a common password or obvious variation from this demo's list" },
  { id: "sequence", text: "Contains a sequence of 4+ letters, numbers, or keyboard keys" },
  { id: "repeated", text: "Contains a character 3+ times or a block of 2–128 characters twice in a row (ignoring case)" },
  { id: "password-word", text: 'Contains the word "password"' }
];

// Pure calculation: return results without changing the page or saving input.
function analyzePassword(password) {
  if (exceedsLimit(password, PASSWORD_LIMIT)) {
    throw new Error("Limit: 256 characters. Shorten the practice password; no estimate was calculated and nothing was truncated.");
  }
  const checks = rules.map(rule => rule.test(password));
  const length = Array.from(password).length;
  // Length supplies the starting estimate; character variety earns no points.
  // These teaching thresholds cannot tell how a password was actually chosen.
  let score = length === 0 ? 0 : length < 8 ? 1 : length < 12 ? 2
    : length < 16 ? 3 : length < 20 ? 4 : 5;

  // Use a temporary lowercase copy so capitalization cannot hide these patterns.
  // The original input is unchanged. No value is sent or written to storage.
  const lowercase = password.toLowerCase();
  // Catch familiar words with added years/symbols and common substitutions,
  // e.g. Welcome2026! or P@ssw0rd. This is a small local list, not breach data.
  const substitutions = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
  const simplified = lowercase.replace(/[013457@$]/g, character => substitutions[character]);
  const commonMatch = commonPasswords.has(lowercase) || Array.from(commonPasswords).some(word =>
    /^[a-z]{4,}$/.test(word) && (lowercase.includes(word) || simplified.includes(word))
  );
  const risks = [
    commonMatch,
    hasSequence(lowercase),
    /(.)\1{2,}/su.test(lowercase) || /(.{2,128})\1+/su.test(lowercase),
    lowercase.includes("password")
  ];

  // Predictability overrides character variety. Common passwords and the word
  // "password" rate Very Weak; sequences or repeated runs cap the rating at Weak.
  if (length > 0) {
    if (risks[0] || risks[3]) score = 1;
    else if (risks[1] || risks[2]) score = Math.min(score, 2);
    // Long strings with very few distinct characters are also predictable.
    if (new Set(lowercase).size < 5) score = Math.min(score, 2);
  }

  return { checks, score, risks };
}

function updateAnalyzer() {
  // Read only for this calculation. Never log, transmit, or persist the password.
  const tooLong = exceedsLimit(passwordInput.value, PASSWORD_LIMIT);
  passwordInput.setAttribute("aria-invalid", String(tooLong));
  const result = tooLong ? { checks: [], risks: [], score: 0 } : analyzePassword(passwordInput.value);
  rules.forEach((rule, index) => {
    const item = document.getElementById(`check-${rule.id}`);
    const satisfied = result.checks[index];
    item.textContent = `${tooLong ? "Not checked" : satisfied ? "Present" : "Missing"}: ${rule.text}`;
    item.classList.toggle("satisfied", satisfied);
  });

  // Never echo the entered password into the result, only describe each finding.
  patternChecks.forEach((check, index) => {
    const item = document.getElementById(`risk-${check.id}`);
    const detected = result.risks[index];
    const prefix = result.score === 0 ? "Not checked" : detected ? "Detected" : "Not detected";
    item.textContent = `${prefix}: ${check.text}`;
    item.classList.toggle("warning", result.score > 0 && detected);
  });

  const label = tooLong ? "Limit: 256 characters. Shorten the practice password; no estimate was calculated and nothing was truncated." : result.score === 0
    ? "Enter a password to see its strength."
    : `Educational estimate: ${strengthNames[result.score - 1]}`;
  strengthLabel.textContent = label;
  strengthMeter.setAttribute("aria-valuenow", String(result.score));
  strengthMeter.setAttribute("aria-valuetext", tooLong ? "Not evaluated: input exceeds limit" : result.score === 0 ? "No password entered" : label);
  strengthMeter.setAttribute("data-score", String(result.score));
  document.getElementById("strength-fill").style.width = `${result.score * 20}%`;
}

function clearPassword() {
  passwordInput.value = "";
  passwordInput.type = "password";
  toggleButton.textContent = "Show password";
  toggleButton.setAttribute("aria-pressed", "false");
  updateAnalyzer();
}

// Switching sections also moves keyboard focus to the next useful control.
openButton.addEventListener("click", () => {
  openTool(analyzer, openButton, passwordInput);
});

backButton.addEventListener("click", () => {
  clearPassword();
  closeTool(analyzer, openButton);
});

// Change only the display type; showing the password does not alter its value.
toggleButton.addEventListener("click", () => {
  const showPassword = passwordInput.type === "password";
  passwordInput.type = showPassword ? "text" : "password";
  toggleButton.textContent = showPassword ? "Hide password" : "Show password";
  toggleButton.setAttribute("aria-pressed", String(showPassword));
});

// The input event covers typing, pasting, and deleting text.
passwordInput.addEventListener("input", updateAnalyzer);
// Clear the field when leaving or restoring the page, including browser history.
window.addEventListener("pagehide", clearPassword);
window.addEventListener("pageshow", clearPassword);
clearPassword();

// Generator: passwords exist only temporarily in memory and in the result field.
const generator = document.getElementById("generator");
const generatorOpen = document.getElementById("open-generator");
const generatorBack = document.getElementById("generator-back");
const lengthInput = document.getElementById("generator-length");
const generateButton = document.getElementById("generate-password");
const generatedOutput = document.getElementById("generated-password");
const copyButton = document.getElementById("copy-password");
const generatorStatus = document.getElementById("generator-status");
const characterGroups = [
  { input: document.getElementById("include-uppercase"), characters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { input: document.getElementById("include-lowercase"), characters: "abcdefghijklmnopqrstuvwxyz" },
  { input: document.getElementById("include-numbers"), characters: "0123456789" },
  { input: document.getElementById("include-special"), characters: "!@#$%^&*()-_=+[]{};:,.?/~" }
];
// A counter prevents an old clipboard operation from changing a newer result's status.
let generatorRevision = 0;

function secureRandomIndex(size) {
  const number = new Uint32Array(1);
  // There are 2^32 possible values. Discard the small leftover range so taking
  // the remainder (%) gives every character an equal chance (no modulo bias).
  const limit = Math.floor(4294967296 / size) * size;
  do {
    globalThis.crypto.getRandomValues(number);
  } while (number[0] >= limit);
  return number[0] % size;
}

function generateSecurePassword(length, groups) {
  if (!Number.isInteger(length) || length < 12 || length > 64) {
    throw new Error("Choose a whole-number length from 12 to 64.");
  }
  if (groups.length === 0) throw new Error("Select at least one character type.");
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("Secure randomness is unavailable in this browser. Try a current browser.");
  }

  const pool = groups.join("");
  let password;
  // Choose each character securely from the combined pool. Retry the whole
  // candidate if a selected type is missing, preserving equal chances among
  // passwords that meet the options rather than forcing predictable positions.
  do {
    password = "";
    for (let index = 0; index < length; index++) {
      password += pool[secureRandomIndex(pool.length)];
    }
  } while (!groups.every(group => Array.from(password).some(character => group.includes(character))));
  return password;
}

function clearGeneratedPassword() {
  generatorRevision++;
  generatedOutput.value = "";
  copyButton.disabled = true;
  generatorStatus.textContent = "";
}

generatorOpen.addEventListener("click", () => {
  openTool(generator, generatorOpen, lengthInput);
});

generatorBack.addEventListener("click", () => {
  clearGeneratedPassword();
  closeTool(generator, generatorOpen);
});

generateButton.addEventListener("click", () => {
  clearGeneratedPassword();
  const groups = characterGroups.filter(group => group.input.checked).map(group => group.characters);
  try {
    generatedOutput.value = generateSecurePassword(Number(lengthInput.value), groups);
    refreshCopyButtons();
    generatorStatus.textContent = "Password generated. Copy it when ready.";
  } catch (error) {
    generatorStatus.textContent = error.message;
  }
});

connectCopyButton(copyButton, generatedOutput, generatorStatus, () => generatorRevision, "Password");

// Clear stale output when options change, and clear page-held secrets on exit.
lengthInput.addEventListener("input", clearGeneratedPassword);
characterGroups.forEach(group => group.input.addEventListener("change", clearGeneratedPassword));
window.addEventListener("pagehide", clearGeneratedPassword);
window.addEventListener("pageshow", clearGeneratedPassword);
clearGeneratedPassword();

// Hash Lab keeps only the current input and result in the page, with no history.
const hashLab = document.getElementById("hash-lab");
const hashOpen = document.getElementById("open-hash-lab");
const hashBack = document.getElementById("hash-back");
const hashInput = document.getElementById("hash-input");
const hashOutput = document.getElementById("hash-output");
const hashGenerate = document.getElementById("generate-hash");
const hashClear = document.getElementById("clear-hash");
const hashCopy = document.getElementById("copy-hash");
const hashStatus = document.getElementById("hash-status");
let hashRevision = 0;

async function sha256Hex(text) {
  // Includes room for a demo salt prefix; user-facing limits are checked separately.
  if (exceedsLimit(text, TEXT_LIMIT + 33)) throw new Error("Text is too long to hash in this educational tool.");
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable here. Use a current browser with HTTPS or a localhost server.");
  }
  // TextEncoder turns the exact text into UTF-8 bytes. Do not trim spaces or
  // change capitalization: even these small differences should affect the hash.
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  // SHA-256 returns 32 bytes. Two hexadecimal digits per byte give 64 digits.
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function resetHashResult() {
  // Digest is asynchronous. Invalidate older work so it cannot restore a result
  // after the user changes text, clicks Clear, or leaves the tool.
  hashRevision++;
  hashOutput.value = "";
  hashCopy.disabled = true;
  hashGenerate.disabled = false;
  hashStatus.textContent = "";
}

function clearHashLab() {
  hashInput.value = "";
  hashInput.setAttribute("aria-invalid", "false");
  resetHashResult();
  clearSaltDemo();
}

hashOpen.addEventListener("click", () => {
  openTool(hashLab, hashOpen, hashInput);
});

hashBack.addEventListener("click", () => {
  clearHashLab();
  closeTool(hashLab, hashOpen);
});

hashGenerate.addEventListener("click", async () => {
  resetHashResult();
  if (!validateHashInput()) return;
  const revision = hashRevision;
  hashGenerate.disabled = true;
  hashStatus.textContent = "Generating SHA-256 hash…";
  try {
    const hash = await sha256Hex(hashInput.value);
    if (revision !== hashRevision) return;
    // Use a text field, never HTML, to display the result.
    hashOutput.value = hash;
    refreshCopyButtons();
    hashStatus.textContent = "Hash generated. Change one character and generate again to explore the difference.";
  } catch (error) {
    if (revision === hashRevision) hashStatus.textContent = error.message;
  } finally {
    if (revision === hashRevision) hashGenerate.disabled = false;
  }
});

connectCopyButton(hashCopy, hashOutput, hashStatus, () => hashRevision, "Hash");

function validateHashInput() {
  const tooLong = exceedsLimit(hashInput.value, TEXT_LIMIT);
  hashInput.setAttribute("aria-invalid", String(tooLong));
  hashGenerate.disabled = tooLong;
  if (tooLong) hashStatus.textContent = "Limit: 10,000 characters. Shorten the practice text; nothing was hashed or truncated.";
  return !tooLong;
}
hashInput.addEventListener("input", () => {
  resetHashResult();
  validateHashInput();
});
hashClear.addEventListener("click", () => {
  clearHashLab();
  hashStatus.textContent = "Practice text and hash cleared.";
  hashInput.focus();
});
window.addEventListener("pagehide", clearHashLab);
window.addEventListener("pageshow", clearHashLab);
// Initial clearing runs below, after the salt controls have been initialized.

// Salt demonstration: only the current pair of salts/hashes is shown, never saved.
const saltPassword = document.getElementById("salt-password");
const saltGenerate = document.getElementById("generate-salt");
const saltClear = document.getElementById("clear-salt");
const saltA = document.getElementById("salt-a");
const saltB = document.getElementById("salt-b");
const saltHashA = document.getElementById("salt-hash-a");
const saltHashB = document.getElementById("salt-hash-b");
const saltStatus = document.getElementById("salt-status");
let saltRevision = 0;
// Explicit state avoids depending on visible placeholder wording.
let currentSaltA = null;
let currentSaltB = null;

function randomSaltHex() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure randomness is unavailable. Try a current browser.");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // Hex encoding preserves every random byte; no remainder (%) conversion needed.
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function resetSaltResults() {
  saltRevision++;
  currentSaltA = null;
  currentSaltB = null;
  for (const output of [saltA, saltB, saltHashA, saltHashB]) {
    output.textContent = "Not generated";
  }
  saltStatus.textContent = "";
  saltGenerate.disabled = false;
}

function clearSaltDemo() {
  saltPassword.value = "";
  resetSaltResults();
  saltPassword.setAttribute("aria-invalid", "false");
}

function validateSaltInput() {
  const tooLong = exceedsLimit(saltPassword.value, PASSWORD_LIMIT);
  saltPassword.setAttribute("aria-invalid", String(tooLong));
  saltGenerate.disabled = tooLong;
  if (tooLong) saltStatus.textContent = "Limit: 256 characters. Shorten the practice password; nothing was hashed or truncated.";
  return !tooLong;
}

saltGenerate.addEventListener("click", async () => {
  if (!validateSaltInput()) { resetSaltResults(); validateSaltInput(); return; }
  // Keep the password only in the input and this temporary calculation.
  if (saltPassword.value.length === 0) {
    resetSaltResults();
    saltStatus.textContent = "Enter a made-up practice password first.";
    saltPassword.focus();
    return;
  }
  const revision = ++saltRevision;
  saltGenerate.disabled = true;
  saltStatus.textContent = "Generating salts and hashes…";
  try {
    const firstSalt = currentSaltA ?? randomSaltHex();
    let secondSalt;
    // Collisions are extremely unlikely, but ensure the demonstration uses
    // distinct salts and that Generate New Salt really replaces Salt B.
    do {
      secondSalt = randomSaltHex();
    } while (secondSalt === firstSalt || secondSalt === currentSaltB);

    // This transparent concatenation is for teaching only, NOT password storage.
    const password = saltPassword.value;
    const hashes = await Promise.all([
      sha256Hex(firstSalt + ":" + password),
      sha256Hex(secondSalt + ":" + password)
    ]);
    // Editing, clearing, or leaving invalidates pending work so it cannot reappear.
    if (revision !== saltRevision) return;
    currentSaltA = firstSalt;
    currentSaltB = secondSalt;
    saltA.textContent = firstSalt;
    saltB.textContent = secondSalt;
    saltHashA.textContent = hashes[0];
    saltHashB.textContent = hashes[1];
    saltStatus.textContent = hashes[0] !== hashes[1]
      ? "Same practice password + different salts = different hashes. Generate again to change Salt B."
      : "The hashes matched unexpectedly. Generate new salts to repeat the experiment.";
  } catch (error) {
    if (revision === saltRevision) {
      resetSaltResults();
      saltStatus.textContent = error.message;
    }
  } finally {
    if (revision === saltRevision) saltGenerate.disabled = false;
  }
});

saltPassword.addEventListener("input", () => {
  resetSaltResults();
  validateSaltInput();
});
saltClear.addEventListener("click", () => {
  clearSaltDemo();
  saltPassword.focus();
});
// clearHashLab owns both sections, including page exit/history restoration.
clearHashLab();

// Quiz content is a local array. "correct" is the answer's zero-based index:
// 0 means the first answer, 1 means the second, and so on.
const quizQuestions = [
  {
    question: "Which password habit best protects your accounts?",
    answers: ["Reuse one complex password everywhere", "Use your birthday with an exclamation mark", "Use a long, randomly generated, unique password for each account", "Replace every letter a with @ in your name"],
    correct: 2,
    explanation: "Length and randomness make guessing harder. A unique password also keeps one breached account from exposing your other accounts."
  },
  {
    question: "What is a password manager useful for?",
    answers: ["Generating and storing unique passwords in a protected vault", "Making every website trustworthy", "Sharing all your passwords publicly", "Removing the need to protect your devices"],
    correct: 0,
    explanation: "A password manager helps you use different strong passwords without memorizing each one. Protect the manager itself with a strong master password and MFA where available."
  },
  {
    question: "What happens when SHA-256 hashes exactly the same input twice?",
    answers: ["It encrypts the input with two different keys", "It sends the input to a server", "It produces a random result each time", "It produces the same hash both times"],
    correct: 3,
    explanation: "SHA-256 follows fixed steps, so the same input bytes always produce the same hash. A hash is a one-way fingerprint, not encrypted text."
  },
  {
    question: "Why give each password a unique random salt before password hashing?",
    answers: ["To make the password recoverable by decryption", "To make identical passwords produce different hashes and reduce reuse of precomputed lists", "To replace the need for a password-hashing function", "To turn a short password into a strong password"],
    correct: 1,
    explanation: "A salt changes the input to the password-hashing function. Different salts separate identical passwords and make precomputed lists less useful. Salts are not secret; real storage still needs a dedicated password-hashing function."
  },
  {
    question: "How is encryption different from hashing?",
    answers: ["Encryption never uses keys", "A hash can always be decrypted", "Encryption can recover the original message using the correct key", "Encryption and hashing are the same process"],
    correct: 2,
    explanation: "Encryption is designed to be reversible with the correct key. Hashing produces a fingerprint and has no decryption key to recover the message."
  },
  {
    question: "An unexpected email says your bank account will close unless you sign in through its link. What should you do?",
    answers: ["Open the bank's official app or independently visit its known website to check", "Click quickly because the message is urgent", "Reply with your password", "Trust it if it contains the bank's logo"],
    correct: 0,
    explanation: "Phishing messages imitate trusted organizations to steal information. Verify the claim through a trusted route you choose yourself; urgency and logos do not prove a message is genuine."
  },
  {
    question: "Which example uses two different authentication factors?",
    answers: ["A password and another password", "A password and a memorized PIN", "A password and a security question", "A password and a physical security key"],
    correct: 3,
    explanation: "A password is something you know; a physical security key is something you have. Using different factor types adds protection if one is compromised. Two memorized secrets are still the same factor type."
  },
  {
    question: "What does HTTPS tell you about a website connection?",
    answers: ["Everything on the website is true", "The connection is encrypted, but the website could still be a scam", "The website cannot contain phishing", "You no longer need a password"],
    correct: 1,
    explanation: "HTTPS protects data in transit between your browser and the website. Scammers can also use HTTPS, so check the domain and context rather than treating HTTPS as proof of trustworthiness."
  },
  {
    question: "Someone claiming to be IT support asks for your sign-in code. What is the safest response?",
    answers: ["Share it if they know your name", "Send it if they sound confident", "Do not share it; verify the request through your organization's known support channel", "Post the code in a team chat to ask if it is real"],
    correct: 2,
    explanation: "Social engineering manipulates people into revealing secrets or taking unsafe actions. A name or confident tone is not proof of identity. Verify independently and keep sign-in codes private."
  },
  {
    question: "Why should you install software updates from trusted sources?",
    answers: ["They often fix security weaknesses as well as bugs", "They guarantee you can never be hacked", "They remove the need for backups", "They are only useful for changing colors and icons"],
    correct: 0,
    explanation: "Updates often patch known vulnerabilities that attackers could exploit. Use the app's or operating system's official update mechanism. Updates help reduce risk but do not guarantee complete security."
  }
];

const quiz = document.getElementById("quiz");
const quizOpen = document.getElementById("open-quiz");
const quizBack = document.getElementById("quiz-back");
const quizQuestionView = document.getElementById("quiz-question-view");
const quizQuestion = document.getElementById("quiz-question");
const quizAnswers = document.getElementById("quiz-answers");
const quizProgress = document.getElementById("quiz-progress");
const quizScoreLabel = document.getElementById("quiz-score");
const quizFeedback = document.getElementById("quiz-feedback");
const quizNext = document.getElementById("quiz-next");
const quizResult = document.getElementById("quiz-result");
const quizFinalScore = document.getElementById("quiz-final-score");
const quizRestart = document.getElementById("quiz-restart");

// These three values track one attempt in memory only; no browser storage is used.
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

function showQuizQuestion() {
  const question = quizQuestions[quizIndex];
  quizAnswered = false;
  quizQuestionView.hidden = false;
  quizResult.hidden = true;
  quizProgress.textContent = `Question ${quizIndex + 1} of ${quizQuestions.length}`;
  quizScoreLabel.textContent = `Score: ${quizScore} / ${quizQuestions.length}`;
  quizQuestion.textContent = question.question;
  quizFeedback.textContent = "";
  quizNext.disabled = true;
  quizNext.textContent = quizIndex === quizQuestions.length - 1 ? "See Final Score" : "Next Question";
  quizAnswers.replaceChildren();

  // Native buttons support Tab, Enter, and Space without custom keyboard code.
  question.answers.forEach((answer, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button quiz-answer";
    button.textContent = answer;
    button.addEventListener("click", () => chooseQuizAnswer(index));
    quizAnswers.append(button);
  });
  quizQuestion.focus();
}

function chooseQuizAnswer(index) {
  // Lock the question after the first choice, preventing double-click scoring.
  if (quizAnswered || quizIndex >= quizQuestions.length) return;
  quizAnswered = true;
  const question = quizQuestions[quizIndex];
  const correct = index === question.correct;
  if (correct) quizScore++;
  quizScoreLabel.textContent = `Score: ${quizScore} / ${quizQuestions.length}`;

  Array.from(quizAnswers.children).forEach((button, answerIndex) => {
    // aria-disabled leaves the focused answer readable; the guard above blocks changes.
    button.setAttribute("aria-disabled", "true");
    if (answerIndex === question.correct) {
      button.classList.add("correct-answer");
      button.textContent += " — Correct answer";
    } else if (answerIndex === index) {
      button.classList.add("incorrect-answer");
      button.textContent += " — Your answer (incorrect)";
    }
  });
  // A live region announces feedback without unexpectedly moving keyboard focus.
  quizFeedback.textContent = `${correct ? "Correct!" : "Incorrect."} Correct answer: ${question.answers[question.correct]}. ${question.explanation}`;
  quizNext.disabled = false;
}

function restartQuiz() {
  quizIndex = 0;
  quizScore = 0;
  showQuizQuestion();
}

quizOpen.addEventListener("click", () => {
  openTool(quiz, quizOpen, quizQuestion);
  restartQuiz();
});

quizNext.addEventListener("click", () => {
  if (!quizAnswered || quizIndex >= quizQuestions.length) return;
  quizIndex++;
  if (quizIndex < quizQuestions.length) {
    showQuizQuestion();
  } else {
    quizQuestionView.hidden = true;
    quizResult.hidden = false;
    quizFinalScore.textContent = `Quiz complete! Your score: ${quizScore} out of ${quizQuestions.length}.`;
    quizFinalScore.focus();
  }
});

quizRestart.addEventListener("click", restartQuiz);
quizBack.addEventListener("click", () => {
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  closeTool(quiz, quizOpen);
});
