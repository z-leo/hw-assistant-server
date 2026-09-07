const express = require('express');
const dayjs = require('dayjs');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Helper: get child IDs in the family
function getFamilyChildIds(db, userId) {
  const currentUser = db.prepare('SELECT family_code, role FROM users WHERE id = ?').get(userId);
  if (!currentUser || !currentUser.family_code) {
    return [userId];
  }
  const children = db
    .prepare("SELECT id FROM users WHERE family_code = ? AND role = 'child'")
    .all(currentUser.family_code);
  if (children.length === 0) {
    return [userId];
  }
  return children.map((c) => c.id);
}

// GET /stats - Overall statistics
router.get('/stats', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const childIds = getFamilyChildIds(db, req.user.id);
    const placeholders = childIds.map(() => '?').join(',');

    // Total submissions
    const totalSubmissions = db
      .prepare(
        `SELECT COUNT(*) as count FROM submissions WHERE child_id IN (${placeholders})`
      )
      .get(...childIds);

    // Graded submissions
    const gradedSubmissions = db
      .prepare(
        `SELECT COUNT(*) as count FROM submissions WHERE child_id IN (${placeholders}) AND status = 'graded'`
      )
      .get(...childIds);

    // Correct submissions
    const correctSubmissions = db
      .prepare(
        `SELECT COUNT(*) as count FROM submissions WHERE child_id IN (${placeholders}) AND is_correct = 1`
      )
      .get(...childIds);

    // Accuracy rate
    const accuracyRate = gradedSubmissions.count > 0
      ? correctSubmissions.count / gradedSubmissions.count
      : 0;

    // Get all assignment dates with submissions for streak calculation
    const submissionDates = db
      .prepare(
        `SELECT DISTINCT da.date FROM submissions s JOIN assignment_items ai ON s.item_id = ai.id JOIN daily_assignments da ON ai.assignment_id = da.id WHERE s.child_id IN (${placeholders}) AND s.status = 'graded' ORDER BY da.date DESC`
      )
      .all(...childIds);

    const dates = submissionDates.map((r) => r.date).sort().reverse();

    // Calculate current streak and longest streak
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

    // Calculate longest streak
    if (dates.length > 0) {
      const uniqueDates = [...new Set(dates)].sort();
      tempStreak = 1;
      longestStreak = 1;

      for (let i = 1; i < uniqueDates.length; i++) {
        const prev = dayjs(uniqueDates[i - 1]);
        const curr = dayjs(uniqueDates[i]);
        if (curr.diff(prev, 'day') === 1) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          tempStreak = 1;
        }
      }

      // Calculate current streak
      const lastDate = uniqueDates[uniqueDates.length - 1];
      if (lastDate === today || lastDate === yesterday) {
        currentStreak = 1;
        for (let i = uniqueDates.length - 2; i >= 0; i--) {
          const curr = dayjs(uniqueDates[i + 1]);
          const prev = dayjs(uniqueDates[i]);
          if (curr.diff(prev, 'day') === 1) {
            currentStreak++;
          } else {
            break;
          }
        }
      }
    }

    // Average score
    const avgScoreResult = db
      .prepare(
        `SELECT AVG(score) as avg_score FROM submissions WHERE child_id IN (${placeholders}) AND status = 'graded' AND score IS NOT NULL`
      )
      .get(...childIds);

    res.json({
      success: true,
      data: {
        total_submissions: totalSubmissions.count,
        graded_submissions: gradedSubmissions.count,
        correct_submissions: correctSubmissions.count,
        accuracy_rate: Math.round(accuracyRate * 100) / 100,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        average_score: avgScoreResult.avg_score ? Math.round(avgScoreResult.avg_score * 10) / 10 : 0,
      },
    });
  } catch (err) {
    console.error('[Report] Stats error:', err.message);
    res.status(500).json({ success: false, message: '获取统计信息失败' });
  }
});

// GET /list?month=YYYY-MM - Get all reports for a month
router.get('/list', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ success: false, message: '请提供月份参数 (YYYY-MM)' });
    }

    const childIds = getFamilyChildIds(db, req.user.id);
    const placeholders = childIds.map(() => '?').join(',');
    const startDate = `${month}-01`;
    const endDate = dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD');

    const reports = db
      .prepare(
        `SELECT dr.*, da.date, da.status as assignment_status, u.nickname as child_name FROM daily_reports dr JOIN daily_assignments da ON dr.assignment_id = da.id LEFT JOIN users u ON da.user_id = u.id WHERE da.user_id IN (${placeholders}) AND da.date >= ? AND da.date <= ? ORDER BY da.date DESC`
      )
      .all(...childIds, startDate, endDate);

    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('[Report] List reports error:', err.message);
    res.status(500).json({ success: false, message: '获取报告列表失败' });
  }
});

// GET /:date - Get report for specific date
router.get('/:date', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { date } = req.params;
    const childIds = getFamilyChildIds(db, req.user.id);
    const placeholders = childIds.map(() => '?').join(',');

    const reports = db
      .prepare(
        `SELECT dr.*, da.date, da.status as assignment_status, u.nickname as child_name FROM daily_reports dr JOIN daily_assignments da ON dr.assignment_id = da.id LEFT JOIN users u ON da.user_id = u.id WHERE da.user_id IN (${placeholders}) AND da.date = ? ORDER BY da.created_at DESC`
      )
      .all(...childIds, date);

    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('[Report] Get report error:', err.message);
    res.status(500).json({ success: false, message: '获取报告失败' });
  }
});

module.exports = router;
