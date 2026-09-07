const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { code2Session } = require('../services/wechat');

const router = express.Router();

// POST /login - WeChat login
router.post('/login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: '缺少code参数' });
    }

    const wxData = await code2Session(code);
    const { openid } = wxData;

    const db = getDb();

    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);

    if (!user) {
      // First user ever becomes parent
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
      const role = userCount.count === 0 ? 'parent' : 'child';

      const result = db.prepare(
        'INSERT INTO users (openid, role) VALUES (?, ?)'
      ).run(openid, role);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, openid: user.openid, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          nickname: user.nickname,
          avatar_url: user.avatar_url,
          role: user.role,
          family_code: user.family_code,
        },
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, message: '登录失败: ' + err.message });
  }
});

// GET /family-code - Generate family code (parent only)
router.get('/family-code', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ success: false, message: '只有家长才能创建家庭码' });
    }

    const db = getDb();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    db.prepare('UPDATE users SET family_code = ? WHERE id = ?').run(code, req.user.id);

    res.json({ success: true, data: { familyCode: code } });
  } catch (err) {
    console.error('[Auth] Family code error:', err.message);
    res.status(500).json({ success: false, message: '生成家庭码失败' });
  }
});

// POST /join-family - Join a family
router.post('/join-family', authMiddleware, (req, res) => {
  try {
    const { familyCode } = req.body;
    if (!familyCode) {
      return res.status(400).json({ success: false, message: '请提供家庭码' });
    }

    const db = getDb();
    const parent = db.prepare(
      'SELECT * FROM users WHERE family_code = ? AND role = ?'
    ).get(familyCode.toUpperCase(), 'parent');

    if (!parent) {
      return res.status(404).json({ success: false, message: '家庭码无效或不存在' });
    }

    db.prepare('UPDATE users SET family_code = ? WHERE id = ?').run(
      familyCode.toUpperCase(),
      req.user.id
    );

    res.json({ success: true, data: { message: '加入家庭成功' } });
  } catch (err) {
    console.error('[Auth] Join family error:', err.message);
    res.status(500).json({ success: false, message: '加入家庭失败' });
  }
});

// GET /me - Get current user info
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        nickname: user.nickname,
        avatar_url: user.avatar_url,
        role: user.role,
        family_code: user.family_code,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[Auth] Get me error:', err.message);
    res.status(500).json({ success: false, message: '获取用户信息失败' });
  }
});

// PUT /me - Update user info
router.put('/me', authMiddleware, (req, res) => {
  try {
    const { nickname, avatar_url } = req.body;
    const db = getDb();

    const updates = [];
    const params = [];

    if (nickname !== undefined) {
      updates.push('nickname = ?');
      params.push(nickname);
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      params.push(avatar_url);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }

    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({
      success: true,
      data: {
        id: user.id,
        nickname: user.nickname,
        avatar_url: user.avatar_url,
        role: user.role,
        family_code: user.family_code,
      },
    });
  } catch (err) {
    console.error('[Auth] Update me error:', err.message);
    res.status(500).json({ success: false, message: '更新用户信息失败' });
  }
});

module.exports = router;
