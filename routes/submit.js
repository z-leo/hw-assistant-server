const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const config = require('../config');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { gradeSubmission, generateSummary } = require('../services/ai-grading');
const { sendNotification, formatReport } = require('../services/notification');

const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', config.uploadDir);
    const monthDir = dayjs().format('YYYY-MM');
    const fullDir = path.join(uploadDir, monthDir);

    // Ensure directory exists
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }
    cb(null, fullDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `${Date.now()}_${random}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|heic|heif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname || mimetype) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  },
});

// Async grading function
async function performGrading(submissionId) {
  const db = getDb();
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
  if (!submission) {
    console.error('[Grading] Submission not found:', submissionId);
    return;
  }

  const item = db.prepare('SELECT * FROM assignment_items WHERE id = ?').get(submission.item_id);
  if (!item) {
    console.error('[Grading] Assignment item not found:', submission.item_id);
    db.prepare("UPDATE submissions SET status = 'failed', feedback = ? WHERE id = ?").run(
      '作业项目不存在',
      submissionId
    );
    return;
  }

  try {
    const imageUrls = JSON.parse(submission.image_urls || '[]');
    if (imageUrls.length === 0) {
      throw new Error('没有上传图片');
    }

    // Read first image and convert to base64
    const imagePath = path.join(__dirname, '..', imageUrls[0]);
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    const result = await gradeSubmission(imageBase64, {
      content: item.content,
      item_type: item.item_type,
      correct_answer: item.correct_answer,
    });

    db.prepare(
      "UPDATE submissions SET status = 'graded', ai_result = ?, is_correct = ?, score = ?, feedback = ?, graded_at = datetime('now') WHERE id = ?"
    ).run(
      JSON.stringify(result),
      result.items.every((i) => i.is_correct) ? 1 : 0,
      result.score,
      result.comment,
      submissionId
    );

    console.log('[Grading] Submission graded successfully:', submissionId);
  } catch (err) {
    console.error('[Grading] Grading failed for submission', submissionId, ':', err.message);
    db.prepare("UPDATE submissions SET status = 'failed', feedback = ? WHERE id = ?").run(
      '批改失败，请重试: ' + err.message,
      submissionId
    );
  }
}

// POST /upload - Upload image
router.post('/upload', authMiddleware, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片' });
    }

    const monthDir = dayjs().format('YYYY-MM');
    const url = `/uploads/${monthDir}/${req.file.filename}`;

    res.json({ success: true, data: { url } });
  } catch (err) {
    console.error('[Submit] Upload error:', err.message);
    res.status(500).json({ success: false, message: '上传失败' });
  }
});

// POST /:itemId - Submit homework item
router.post('/:itemId', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { itemId } = req.params;
    const { image_urls } = req.body;

    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({ success: false, message: '请上传图片' });
    }

    // Verify item exists
    const item = db.prepare('SELECT * FROM assignment_items WHERE id = ?').get(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: '作业项目不存在' });
    }

    // Create submission record
    const result = db
      .prepare(
        'INSERT INTO submissions (item_id, child_id, image_urls, status) VALUES (?, ?, ?, ?)'
      )
      .run(itemId, req.user.id, JSON.stringify(image_urls), 'pending');

    const submissionId = result.lastInsertRowid;

    // Update assignment status to in_progress
    db.prepare(
      "UPDATE daily_assignments SET status = 'in_progress' WHERE id = ? AND status = 'pending'"
    ).run(item.assignment_id);

    // Trigger async grading (fire and forget)
    performGrading(submissionId).catch((err) => {
      console.error('[Submit] Async grading error:', err.message);
    });

    res.json({ success: true, data: { submission_id: submissionId, status: 'pending' } });
  } catch (err) {
    console.error('[Submit] Submit error:', err.message);
    res.status(500).json({ success: false, message: '提交失败' });
  }
});

// GET /:itemId/result - Get grading result
router.get('/:itemId/result', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { itemId } = req.params;

    // Get the latest submission for this item by the current user
    const submission = db
      .prepare(
        'SELECT * FROM submissions WHERE item_id = ? AND child_id = ? ORDER BY submitted_at DESC LIMIT 1'
      )
      .get(itemId, req.user.id);

    if (!submission) {
      return res.status(404).json({ success: false, message: '未找到提交记录' });
    }

    let aiResult = null;
    if (submission.ai_result) {
      try {
        aiResult = JSON.parse(submission.ai_result);
      } catch (e) {
        aiResult = submission.ai_result;
      }
    }

    res.json({
      success: true,
      data: {
        id: submission.id,
        status: submission.status,
        is_correct: submission.is_correct,
        score: submission.score,
        feedback: submission.feedback,
        ai_result: aiResult,
        image_urls: JSON.parse(submission.image_urls || '[]'),
        submitted_at: submission.submitted_at,
        graded_at: submission.graded_at,
      },
    });
  } catch (err) {
    console.error('[Submit] Get result error:', err.message);
    res.status(500).json({ success: false, message: '获取批改结果失败' });
  }
});

// POST /report/:assignmentId/generate - Generate daily report
router.post('/report/:assignmentId/generate', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const { assignmentId } = req.params;

    const assignment = db.prepare('SELECT * FROM daily_assignments WHERE id = ?').get(assignmentId);
    if (!assignment) {
      return res.status(404).json({ success: false, message: '作业不存在' });
    }

    // Get all items for this assignment
    const items = db
      .prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order ASC')
      .all(assignmentId);

    if (items.length === 0) {
      return res.status(400).json({ success: false, message: '该作业没有项目' });
    }

    // Get all submissions for these items
    const itemIds = items.map((i) => i.id);
    const placeholders = itemIds.map(() => '?').join(',');

    const submissions = db
      .prepare(
        `SELECT s.*, ai.content, ai.item_type FROM submissions s JOIN assignment_items ai ON s.item_id = ai.id WHERE s.item_id IN (${placeholders}) ORDER BY s.item_id, s.submitted_at DESC`
      )
      .all(...itemIds);

    // Get latest submission per item
    const latestSubmissions = {};
    for (const sub of submissions) {
      if (!latestSubmissions[sub.item_id]) {
        latestSubmissions[sub.item_id] = sub;
      }
    }

    const totalItems = items.length;
    const completedItems = Object.keys(latestSubmissions).length;
    const correctItems = Object.values(latestSubmissions).filter((s) => s.is_correct === 1).length;
    const completionRate = totalItems > 0 ? completedItems / totalItems : 0;
    const accuracyRate = completedItems > 0 ? correctItems / completedItems : 0;

    // Generate AI summary
    const summaryResults = Object.values(latestSubmissions).map((s) => ({
      content: s.content,
      score: s.score || 0,
      is_correct: s.is_correct === 1,
      feedback: s.feedback || '',
    }));

    let aiSummary = '';
    if (summaryResults.length > 0) {
      aiSummary = await generateSummary(summaryResults);
    }

    // Save or update report
    const existingReport = db
      .prepare('SELECT * FROM daily_reports WHERE assignment_id = ?')
      .get(assignmentId);

    if (existingReport) {
      db.prepare(
        'UPDATE daily_reports SET total_items = ?, completed_items = ?, correct_items = ?, completion_rate = ?, accuracy_rate = ?, ai_summary = ? WHERE assignment_id = ?'
      ).run(totalItems, completedItems, correctItems, completionRate, accuracyRate, aiSummary, assignmentId);
    } else {
      db.prepare(
        'INSERT INTO daily_reports (assignment_id, total_items, completed_items, correct_items, completion_rate, accuracy_rate, ai_summary) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(assignmentId, totalItems, completedItems, correctItems, completionRate, accuracyRate, aiSummary);
    }

    // Update assignment status to completed
    db.prepare("UPDATE daily_assignments SET status = 'completed' WHERE id = ?").run(assignmentId);

    // Get the saved report
    const report = db.prepare('SELECT * FROM daily_reports WHERE assignment_id = ?').get(assignmentId);

    // Trigger notification (async)
    const child = db.prepare('SELECT nickname FROM users WHERE id = ?').get(assignment.user_id);
    const childName = child ? (child.nickname || '孩子') : '孩子';

    const { title, desp } = formatReport({ ...report, date: assignment.date }, childName);
    sendNotification(title, desp).catch((err) => {
      console.error('[Report] Notification error:', err.message);
    });

    res.json({
      success: true,
      data: {
        ...report,
        date: assignment.date,
        child_name: childName,
      },
    });
  } catch (err) {
    console.error('[Report] Generate report error:', err.message);
    res.status(500).json({ success: false, message: '生成报告失败' });
  }
});

module.exports = router;
