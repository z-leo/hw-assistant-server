const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { initDB } = require('./db/init');

// Initialize database
initDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/homework', require('./routes/homework'));
app.use('/api/submit', require('./routes/submit'));
app.use('/api/report', require('./routes/report'));
app.use('/api/config', require('./routes/config'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: '文件大小超过限制(最大10MB)' });
  }

  // Multer other errors
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: '文件上传错误: ' + err.message });
  }

  res.status(500).json({ success: false, message: '服务器内部错误: ' + err.message });
});

// Start server
app.listen(config.port, () => {
  console.log(`[Server] 作业小助手后端服务已启动`);
  console.log(`[Server] 端口: ${config.port}`);
  console.log(`[Server] 地址: http://localhost:${config.port}`);
  console.log(`[Server] 环境: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
