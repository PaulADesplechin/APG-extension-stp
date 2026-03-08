const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('crypto');
const router = express.Router();

// Simple JSON file database
const DB_PATH = path.join(__dirname, '..', 'storage', 'db.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) return { jobs: [] };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Upload config
const upload = multer({
  dest: path.join(__dirname, '..', 'storage', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const exts = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, exts.includes(ext));
  }
});

// POST /api/jobs - Create job (upload file or send results)
router.post('/', express.json(), (req, res) => {
  const db = readDB();
  const job = {
    id: generateId(),
    fileName: req.body.fileName || 'unknown',
    date: req.body.date || new Date().toISOString(),
    totalRows: req.body.totalRows || 0,
    results: req.body.results || [],
    status: 'completed'
  };

  // Compute summary
  job.summary = {
    found: job.results.filter(r => r.lookupStatus === 'found').length,
    notFound: job.results.filter(r => r.lookupStatus === 'not_found').length,
    enabled: job.results.filter(r => r.ticketingAuthority === 'Enabled').length,
    disabled: job.results.filter(r => r.ticketingAuthority === 'Disabled').length
  };

  db.jobs.push(job);
  writeDB(db);

  res.status(201).json({ id: job.id, status: job.status, summary: job.summary });
});

// POST /api/jobs/upload - Upload Excel file
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

  // Parse to get row count
  try {
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    job.totalRows = data.length;
  } catch (e) {
    // Non-critical, just log
    console.warn('Could not parse uploaded file:', e.message);
  }

  db.jobs.push(job);
  writeDB(db);

  res.status(201).json({ id: job.id, fileName: job.fileName, totalRows: job.totalRows });
});

// GET /api/jobs - List all jobs
router.get('/', (req, res) => {
  const db = readDB();
  // Return jobs without full results array (too large)
  const jobs = db.jobs.map(({ results, ...rest }) => ({
    ...rest,
    resultCount: results?.length || 0
  }));
  res.json({ jobs: jobs.reverse() });
});

// GET /api/jobs/:id - Get specific job
router.get('/:id', (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// PUT /api/jobs/:id/results - Update job with results
router.put('/:id/results', (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.results = req.body.results || [];
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.summary = {
    found: job.results.filter(r => r.lookupStatus === 'found').length,
    notFound: job.results.filter(r => r.lookupStatus === 'not_found').length,
    enabled: job.results.filter(r => r.ticketingAuthority === 'Enabled').length,
    disabled: job.results.filter(r => r.ticketingAuthority === 'Disabled').length
  };

  writeDB(db);
  res.json({ id: job.id, status: job.status, summary: job.summary });
});

// GET /api/jobs/:id/download - Download enriched Excel
router.get('/:id/download', (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.results || job.results.length === 0) {
    return res.status(400).json({ error: 'No results available' });
  }

  // Build Excel from results
  const ws = XLSX.utils.json_to_sheet(job.results);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Results');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `BSP_Results_${job.id}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

module.exports = router;
