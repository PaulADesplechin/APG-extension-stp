const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jobsRouter = require('./routes/jobs');
const ebulletinRouter = require('./routes/ebulletin');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure storage directories exist
const dirs = ['storage/uploads', 'storage/results'];
dirs.forEach(d => {
  const dir = path.join(__dirname, d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.use('/api/jobs', jobsRouter);
app.use('/api/ebulletin', ebulletinRouter);

// Static files for results download
app.use('/files', express.static(path.join(__dirname, 'storage/results')));

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`APG BSP Link Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
