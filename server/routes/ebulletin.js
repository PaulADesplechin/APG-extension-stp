const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const router = express.Router();

// ---------------------------------------------------------------------------
// Database helpers (lowdb-style JSON file)
// ---------------------------------------------------------------------------
const DB_PATH = path.join(__dirname, '..', 'storage', 'ebulletin-jobs.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) return { jobs: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { jobs: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ---------------------------------------------------------------------------
// Multer upload configuration
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, '..', 'storage', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `ebulletin-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only .xlsx, .xls and .csv files are accepted'));
    }
    cb(null, true);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ebulletin/upload
// Upload and store an eBulletin Excel file, create a new job record.
// ---------------------------------------------------------------------------
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const db = readDB();

  const job = {
    id: generateId(),
    fileName: req.file.originalname,
    filePath: req.file.path,
    date: new Date().toISOString(),
    status: 'uploaded',
    totalRows: 0,
    results: [],
    summary: {}
  };

  // Attempt to parse the file to extract row count & sheet info
  try {
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    job.totalRows = data.length;
    job.sheetNames = wb.SheetNames;
  } catch (err) {
    console.warn('[eBulletin] Could not parse uploaded file:', err.message);
  }

  db.jobs.push(job);
  writeDB(db);

  res.status(201).json({
    id: job.id,
    fileName: job.fileName,
    totalRows: job.totalRows,
    status: job.status
  });
});

// ---------------------------------------------------------------------------
// POST /api/ebulletin/clean
// Accept a job ID, read the stored file, run server-side cleaning operations,
// and return cleaning stats. Heavy SheetJS processing happens client-side;
// this endpoint handles structural validation and basic sanitization.
// ---------------------------------------------------------------------------
router.post('/clean', (req, res) => {
  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const db = readDB();
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(400).json({ error: 'Source file not found on disk' });
  }

  try {
    const wb = XLSX.readFile(job.filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // --- Cleaning operations ---
    const stats = {
      totalRows: rows.length,
      emptyRowsRemoved: 0,
      duplicatesRemoved: 0,
      trimmedCells: 0,
      cleanedRows: 0
    };

    // 1. Remove completely empty rows
    const nonEmpty = rows.filter(row => {
      const isEmpty = Object.values(row).every(v => String(v).trim() === '');
      if (isEmpty) stats.emptyRowsRemoved++;
      return !isEmpty;
    });

    // 2. Trim whitespace from all cell values
    const trimmed = nonEmpty.map(row => {
      const clean = {};
      for (const [key, value] of Object.entries(row)) {
        const original = String(value);
        const trimmedVal = original.trim();
        if (trimmedVal !== original) stats.trimmedCells++;
        clean[key.trim()] = trimmedVal;
      }
      return clean;
    });

    // 3. Remove duplicate rows (by JSON serialization)
    const seen = new Set();
    const deduped = trimmed.filter(row => {
      const key = JSON.stringify(row);
      if (seen.has(key)) {
        stats.duplicatesRemoved++;
        return false;
      }
      seen.add(key);
      return true;
    });

    stats.cleanedRows = deduped.length;

    // Update job
    job.status = 'cleaned';
    job.cleanedAt = new Date().toISOString();
    job.cleanStats = stats;
    job.totalRows = stats.cleanedRows;

    writeDB(db);

    res.json({
      id: job.id,
      status: job.status,
      stats
    });
  } catch (err) {
    console.error('[eBulletin] Cleaning error:', err.message);
    res.status(500).json({ error: 'Failed to clean file', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ebulletin/jobs
// List all eBulletin processing jobs (without full results payload).
// ---------------------------------------------------------------------------
router.get('/jobs', (_req, res) => {
  const db = readDB();
  const jobs = db.jobs.map(({ results, filePath, ...rest }) => ({
    ...rest,
    resultCount: results?.length || 0
  }));
  res.json({ jobs: jobs.reverse() });
});

// ---------------------------------------------------------------------------
// GET /api/ebulletin/jobs/:id
// Get a specific job with its full results.
// ---------------------------------------------------------------------------
router.get('/jobs/:id', (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Omit internal filePath from response
  const { filePath, ...safeJob } = job;
  res.json(safeJob);
});

// ---------------------------------------------------------------------------
// PUT /api/ebulletin/jobs/:id/results
// Update a job with enriched results sent from the extension after processing.
// ---------------------------------------------------------------------------
router.put('/jobs/:id/results', (req, res) => {
  const { results } = req.body;
  if (!Array.isArray(results)) {
    return res.status(400).json({ error: 'results must be an array' });
  }

  const db = readDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.results = results;
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.summary = {
    totalRows: results.length,
    processed: results.filter(r => r.status === 'processed').length,
    errors: results.filter(r => r.status === 'error').length,
    skipped: results.filter(r => r.status === 'skipped').length
  };

  writeDB(db);

  res.json({
    id: job.id,
    status: job.status,
    summary: job.summary
  });
});

// ---------------------------------------------------------------------------
// GET /api/ebulletin/jobs/:id/download
// Download the enriched Excel file for a completed job.
// ---------------------------------------------------------------------------
router.get('/jobs/:id/download', (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (!job.results || job.results.length === 0) {
    return res.status(400).json({ error: 'No results available for download' });
  }

  try {
    const ws = XLSX.utils.json_to_sheet(job.results);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'eBulletin Results');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeName = job.fileName
      ? path.parse(job.fileName).name.replace(/[^a-zA-Z0-9_-]/g, '_')
      : 'ebulletin';
    const filename = `${safeName}_enriched_${job.id}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('[eBulletin] Download generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate Excel file' });
  }
});

module.exports = router;
