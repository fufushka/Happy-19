import fs from "node:fs";
import path from "node:path";

const PHOTOS_DIR = path.resolve("./photos");
const OUTPUT_FILE = path.resolve("./photoStream.generated.js");
const LABEL = "❤️";

const exts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const PROTECT_MIN = 1;
const PROTECT_MAX = 19;
const START_NUMBER = 20;

// Якщо хочеш завжди мати 2-3 цифри у назві (020.jpg), увімкни PAD.
// Якщо хочеш просто 20.jpg, 21.jpg — залиш PAD = 0.
const PAD = 0; // напр. 3 для 020,021...

function isPhoto(fileName) {
  return exts.has(path.extname(fileName).toLowerCase());
}

function parseLeadingNumber(fileName) {
  // Підтримує: 1.jpg, 01.png, 001.webp
  // НЕ підтримує: img_1.jpg, photo20.jpg
  const base = path.basename(fileName, path.extname(fileName));
  if (!/^\d+$/.test(base)) return null;
  return Number(base);
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function fmtNum(n) {
  if (!PAD) return String(n);
  return String(n).padStart(PAD, "0");
}

function exists(name) {
  return fs.existsSync(path.join(PHOTOS_DIR, name));
}

function getAllPhotoFiles() {
  return fs
    .readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter(isPhoto);
}

function getReservedNumbers(files) {
  // Резервуємо всі файли з чисто цифровою назвою: 1.jpg, 20.png тощо
  const reserved = new Set();
  for (const f of files) {
    const n = parseLeadingNumber(f);
    if (n != null) reserved.add(n);
  }
  return reserved;
}

function isProtectedFile(fileName) {
  const n = parseLeadingNumber(fileName);
  return n != null && n >= PROTECT_MIN && n <= PROTECT_MAX;
}

function isAlreadyNumbered(fileName) {
  const n = parseLeadingNumber(fileName);
  return n != null; // будь-який цифровий (включно 1–19, 20+)
}

function toTempName(original) {
  // унікальний тимчасовий префікс
  return `__tmp__${Date.now()}__${Math.random()
    .toString(16)
    .slice(2)}__${original}`;
}

function renameSafely(pairs) {
  // pairs: [{ from, to }]
  // 1) спершу все в tmp
  const tmpPairs = pairs.map((p) => ({
    from: p.from,
    tmp: toTempName(p.from),
    to: p.to,
  }));

  for (const p of tmpPairs) {
    fs.renameSync(path.join(PHOTOS_DIR, p.from), path.join(PHOTOS_DIR, p.tmp));
  }

  // 2) з tmp в final
  for (const p of tmpPairs) {
    fs.renameSync(path.join(PHOTOS_DIR, p.tmp), path.join(PHOTOS_DIR, p.to));
  }
}

function buildPhotoStream(files) {
  // Сортуємо по числу, якщо воно є, інакше naturalSort
  const numbered = [];
  const other = [];

  for (const f of files) {
    const n = parseLeadingNumber(f);
    if (n != null) numbered.push({ f, n });
    else other.push(f);
  }

  numbered.sort((a, b) => a.n - b.n);
  other.sort(naturalSort);

  const ordered = [...numbered.map((x) => x.f), ...other];

  return ordered.map((name) => ({
    src: `./photos/${name}`,
    label: LABEL,
  }));
}

// --- MAIN ---
const allFiles = getAllPhotoFiles();

// 1) Не чіпаємо 1–19
const protectedFiles = allFiles.filter(isProtectedFile);

// 2) Файли, які вже мають числове ім’я (в т.ч. 20+), можна не чіпати.
// Якщо ти хочеш ПЕРЕНУМЕРОВУВАТИ також 20+ у єдину послідовність — скажи, я зміню логіку.
const alreadyNumbered = allFiles.filter(isAlreadyNumbered);

// 3) Кандидати на перенумерацію: фото, які НЕ є чисто числовими (наприклад "IMG_1234.jpg")
const toRenumber = allFiles.filter((f) => !isAlreadyNumbered(f));

// Резервуємо всі вже зайняті числові індекси (щоб не перезаписати існуючі)
const reservedNumbers = getReservedNumbers(alreadyNumbered);

// Підбираємо нові імена з 20, 21, 22... пропускаючи зайняті
let nextNum = START_NUMBER;
const renamePairs = [];

toRenumber.sort(naturalSort);

for (const from of toRenumber) {
  while (reservedNumbers.has(nextNum)) nextNum++;

  const ext = path.extname(from).toLowerCase();
  const to = `${fmtNum(nextNum)}${ext}`;

  // додатково: якщо файл уже існує з таким ім’ям — рухаємось далі
  if (exists(to)) {
    // теоретично не має статись, бо reservedNumbers мали б це покрити, але перестрахуємось
    reservedNumbers.add(nextNum);
    nextNum++;
    continue;
  }

  renamePairs.push({ from, to });
  reservedNumbers.add(nextNum);
  nextNum++;
}

// 4) Робимо перейменування (якщо є що)
if (renamePairs.length) {
  renameSafely(renamePairs);
}

// 5) Генеруємо PHOTO_STREAM з актуального стану папки
const finalFiles = getAllPhotoFiles();
const items = buildPhotoStream(finalFiles);

const content =
  `// AUTO-GENERATED FILE. Do not edit manually.\n` +
  `// Generated at: ${new Date().toISOString()}\n` +
  `// Protected: ${PROTECT_MIN}-${PROTECT_MAX} (unchanged)\n` +
  `// Renumbered from: ${START_NUMBER} (only non-numeric names)\n\n` +
  `export const PHOTO_STREAM = ${JSON.stringify(items, null, 2)};\n`;

fs.writeFileSync(OUTPUT_FILE, content, "utf8");

// Лог для контролю
console.log(`Protected (unchanged): ${protectedFiles.length}`);
console.log(`Renamed: ${renamePairs.length}`);
if (renamePairs.length) {
  console.log("Rename map:");
  for (const p of renamePairs) console.log(`  ${p.from} -> ${p.to}`);
}
console.log(`PHOTO_STREAM items: ${items.length} -> ${OUTPUT_FILE}`);
