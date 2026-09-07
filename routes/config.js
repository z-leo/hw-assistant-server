const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { sendNotification } = require('../services/notification');

const router = express.Router();

// GET / - Get all config
router.get('/', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ success: false, message: '只有家长才能查看配置' });
    }

    const db = getDb();
    const configs = db.prepare('SELECT * FROM app_config').all();

    const configMap = {};
    configs.forEach((c) => {
      configMap[c.key] = c.value;
    });

    res.json({
      success: true,
      data: {
        serverChanKey: configMap.serverChanKey || '',
      },
    });
  } catch (err) {
    console.error('[Config] Get config error:', err.message);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

// PUT / - Update config
router.put('/', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ success: false, message: '只有家长才能修改配置' });
    }

    const db = getDb();
    const { serverChanKey } = req.body;

    const updateConfig = db.transaction(() => {
      if (serverChanKey !== undefined) {
        db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(
          'serverChanKey',
          serverChanKey
        );
      }
    });

    updateConfig();

    res.json({ success: true, data: { message: '配置已更新' } });
  } catch (err) {
    console.error('[Config] Update config error:', err.message);
    res.status(500).json({ success: false, message: '更新配置失败' });
  }
});

// POST /test-notification - Send test notification
router.post('/test-notification', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'parent') {
      return res.status(403).json({ success: false, message: '只有家长才能测试通知' });
    }

    const db = getDb();
    const configRow = db.prepare("SELECT value FROM app_config WHERE key = 'serverChanKey'").get();

    if (!configRow || !configRow.value) {
      return res.status(400).json({ success: false, message: '请先配置Server酱Key' });
    }

    // Temporarily set the key for this request
    const originalKey = require('../config').serverChanKey;
    require('../config').serverChanKey = configRow.value;

    const result = await sendNotification(
      '作业小助手 - 测试通知',
      '## 测试通知\n\n恭喜！Server酱通知配置成功。\n\n当您孩子的作业批改完成后，您将收到每日作业报告推送。\n\n---\n来自「作业小助手」'
    );

    // Restore original key
    require('../config').serverChanKey = originalKey;

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Config] Test notification error:', err.message);
    res.status(500).json({ success: false, message: '测试通知失败' });
  }
});

module.exports = router;
