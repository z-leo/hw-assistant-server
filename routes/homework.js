const express = require('express');
const dayjs = require('dayjs');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Helper: get all user IDs in the same family
function getFamilyUserIds(db, userId) {
  const currentUser = db.prepare('SELECT family_code FROM users WHERE id = ?').get(userId);
  if (!currentUser || !currentUser.family_code) {
    return [userId];
  }
  const familyUsers = db
    .prepare('SELECT id FROM users WHERE family_code = ?')
    .all(currentUser.family_code);
  return familyUsers.map((u) => u.id);
}

// Helper: get child IDs in the family
function getFamilyChildIds(db, userId) {
  const currentUser = db.prepare('SELECT family_code, role FROM users WHERE id = ?').get(userId);
  if (!currentUser || !currentUser.family_code) {
    return userId;
  }
  const children = db
    .prepare("SELECT id FROM users WHERE family_code = ? AND role = 'child'")
    .all(currentUser.family_code);
  if (children.length === 0) {
    // If no children found, return the current user's id (they might be both parent and only user)
    return [userId];
  }
  return children.map((c) => c.id);
}

// ==================== Templates ====================

// GET /templates - List all templates
router.get('/templates', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const familyUserIds = getFamilyUserIds(db, req.user.id);
    const placeholders = familyUserIds.map(() => '?').join(',');

    const templates = db
      .prepare(
        `SELECT * FROM homework_templates WHERE user_id IN (${placeholders}) AND is_active = 1 ORDER BY created_at DESC`
      )
      .all(...familyUserIds);

    // Attach items to each template
    const result = templates.map((template) => {
      const items = db
        .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
        .all(template.id);
      return { ...template, items };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Homework] List templates error:', err.message);
    res.status(500).json({ success: false, message: '获取模板列表失败' });
  }
});

// POST /templates - Create template with items
router.post('/templates', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { name, subject, icon, color, items } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }

    const createTemplate = db.transaction(() => {
      const result = db
        .prepare(
          'INSERT INTO homework_templates (user_id, name, subject, icon, color) VALUES (?, ?, ?, ?, ?)'
        )
        .run(req.user.id, name, subject || 'other', icon || '📌', color || '#98D8C8');

      const templateId = result.lastInsertRowid;

      if (items && Array.isArray(items) && items.length > 0) {
        const insertItem = db.prepare(
          'INSERT INTO template_items (template_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        items.forEach((item, index) => {
          insertItem.run(
            templateId,
            item.content || '',
            item.item_type || 'text',
            item.correct_answer || '',
            item.sort_order != null ? item.sort_order : index
          );
        });
      }

      return templateId;
    });

    const templateId = createTemplate();
    const template = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(templateId);
    const templateItems = db
      .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
      .all(templateId);

    res.json({ success: true, data: { ...template, items: templateItems } });
  } catch (err) {
    console.error('[Homework] Create template error:', err.message);
    res.status(500).json({ success: false, message: '创建模板失败' });
  }
});

// PUT /templates/:id - Update template and its items
router.put('/templates/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, subject, icon, color, items } = req.body;

    const template = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(id);
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }

    const updateTemplate = db.transaction(() => {
      db.prepare(
        'UPDATE homework_templates SET name = COALESCE(?, name), subject = COALESCE(?, subject), icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?'
      ).run(name, subject, icon, color, id);

      if (items && Array.isArray(items)) {
        // Delete old items and re-insert
        db.prepare('DELETE FROM template_items WHERE template_id = ?').run(id);

        const insertItem = db.prepare(
          'INSERT INTO template_items (template_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        items.forEach((item, index) => {
          insertItem.run(
            id,
            item.content || '',
            item.item_type || 'text',
            item.correct_answer || '',
            item.sort_order != null ? item.sort_order : index
          );
        });
      }
    });

    updateTemplate();

    const updated = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(id);
    const updatedItems = db
      .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
      .all(id);

    res.json({ success: true, data: { ...updated, items: updatedItems } });
  } catch (err) {
    console.error('[Homework] Update template error:', err.message);
    res.status(500).json({ success: false, message: '更新模板失败' });
  }
});

// DELETE /templates/:id - Soft delete template
router.delete('/templates/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const template = db.prepare('SELECT * FROM homework_templates WHERE id = ?').get(id);
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }

    db.prepare('UPDATE homework_templates SET is_active = 0 WHERE id = ?').run(id);
    res.json({ success: true, data: { message: '模板已删除' } });
  } catch (err) {
    console.error('[Homework] Delete template error:', err.message);
    res.status(500).json({ success: false, message: '删除模板失败' });
  }
});

// ==================== Daily Assignments ====================

// GET /assignments/today - Get today's assignment
router.get('/assignments/today', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const today = dayjs().format('YYYY-MM-DD');
    const childIds = getFamilyChildIds(db, req.user.id);
    const placeholders = childIds.map(() => '?').join(',');

    const assignments = db
      .prepare(
        `SELECT da.*, u.nickname as child_name FROM daily_assignments da LEFT JOIN users u ON da.user_id = u.id WHERE da.user_id IN (${placeholders}) AND da.date = ? ORDER BY da.created_at DESC`
      )
      .all(...childIds, today);

    // Attach items and submission info
    const result = assignments.map((assignment) => {
      const items = db
        .prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order ASC')
        .all(assignment.id);

      const itemsWithSubmissions = items.map((item) => {
        const submission = db
          .prepare(
            'SELECT * FROM submissions WHERE item_id = ? ORDER BY submitted_at DESC LIMIT 1'
          )
          .get(item.id);
        return { ...item, submission: submission || null };
      });

      return { ...assignment, items: itemsWithSubmissions };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Homework] Get today assignments error:', err.message);
    res.status(500).json({ success: false, message: '获取今日作业失败' });
  }
});

// GET /assignments/list?month=2026-09 - Get assignments for a month
router.get('/assignments/list', authMiddleware, (req, res) => {
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

    const assignments = db
      .prepare(
        `SELECT da.*, u.nickname as child_name FROM daily_assignments da LEFT JOIN users u ON da.user_id = u.id WHERE da.user_id IN (${placeholders}) AND da.date >= ? AND da.date <= ? ORDER BY da.date DESC, da.created_at DESC`
      )
      .all(...childIds, startDate, endDate);

    const result = assignments.map((assignment) => {
      const items = db
        .prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order ASC')
        .all(assignment.id);

      const itemsWithSubmissions = items.map((item) => {
        const submission = db
          .prepare(
            'SELECT * FROM submissions WHERE item_id = ? ORDER BY submitted_at DESC LIMIT 1'
          )
          .get(item.id);
        return { ...item, submission: submission || null };
      });

      return { ...assignment, items: itemsWithSubmissions };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Homework] List assignments error:', err.message);
    res.status(500).json({ success: false, message: '获取作业列表失败' });
  }
});

// GET /assignments/:date - Get assignment for specific date
router.get('/assignments/:date', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { date } = req.params;
    const childIds = getFamilyChildIds(db, req.user.id);
    const placeholders = childIds.map(() => '?').join(',');

    const assignments = db
      .prepare(
        `SELECT da.*, u.nickname as child_name FROM daily_assignments da LEFT JOIN users u ON da.user_id = u.id WHERE da.user_id IN (${placeholders}) AND da.date = ? ORDER BY da.created_at DESC`
      )
      .all(...childIds, date);

    const result = assignments.map((assignment) => {
      const items = db
        .prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order ASC')
        .all(assignment.id);

      const itemsWithSubmissions = items.map((item) => {
        const submission = db
          .prepare(
            'SELECT * FROM submissions WHERE item_id = ? ORDER BY submitted_at DESC LIMIT 1'
          )
          .get(item.id);
        return { ...item, submission: submission || null };
      });

      return { ...assignment, items: itemsWithSubmissions };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Homework] Get assignment by date error:', err.message);
    res.status(500).json({ success: false, message: '获取作业失败' });
  }
});

// POST /assignments - Create daily assignment
router.post('/assignments', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { child_id, template_id, date, items } = req.body;

    if (!child_id) {
      return res.status(400).json({ success: false, message: '请指定孩子' });
    }

    const assignmentDate = date || dayjs().format('YYYY-MM-DD');

    const createAssignment = db.transaction(() => {
      const result = db
        .prepare(
          'INSERT INTO daily_assignments (user_id, template_id, date) VALUES (?, ?, ?)'
        )
        .run(child_id, template_id || null, assignmentDate);

      const assignmentId = result.lastInsertRowid;

      // If template_id is provided, copy items from template
      if (template_id) {
        const templateItems = db
          .prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order ASC')
          .all(template_id);

        const insertItem = db.prepare(
          'INSERT INTO assignment_items (assignment_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        templateItems.forEach((item) => {
          insertItem.run(assignmentId, item.content, item.item_type, item.correct_answer, item.sort_order);
        });
      }

      // Also add any manually provided items
      if (items && Array.isArray(items) && items.length > 0) {
        const insertItem = db.prepare(
          'INSERT INTO assignment_items (assignment_id, content, item_type, correct_answer, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        items.forEach((item, index) => {
          insertItem.run(
            assignmentId,
            item.content || '',
            item.item_type || 'text',
            item.correct_answer || '',
            item.sort_order != null ? item.sort_order : index
          );
        });
      }

      return assignmentId;
    });

    const assignmentId = createAssignment();
    const assignment = db.prepare('SELECT * FROM daily_assignments WHERE id = ?').get(assignmentId);
    const assignmentItems = db
      .prepare('SELECT * FROM assignment_items WHERE assignment_id = ? ORDER BY sort_order ASC')
      .all(assignmentId);

    res.json({ success: true, data: { ...assignment, items: assignmentItems } });
  } catch (err) {
    console.error('[Homework] Create assignment error:', err.message);
    res.status(500).json({ success: false, message: '创建作业失败' });
  }
});

module.exports = router;
