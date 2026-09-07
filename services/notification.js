const axios = require('axios');
const config = require('../config');

async function sendNotification(title, desp) {
  if (!config.serverChanKey) {
    console.log('[Notification] Server酱Key未配置，跳过推送');
    return { success: false, message: '未配置Server酱Key' };
  }
  try {
    const url = `https://sctapi.ftqq.com/${config.serverChanKey}.send`;
    const res = await axios.post(url, { title, desp });
    return { success: true, data: res.data };
  } catch (err) {
    console.error('[Notification] 推送失败:', err.message);
    return { success: false, message: err.message };
  }
}

function formatReport(report, childName) {
  const date = report.date || new Date().toISOString().split('T')[0];
  const title = `📚 ${childName}今日作业报告 - ${date}`;
  const desp = `## ${childName}今日作业报告\n\n| 指标 | 数值 |\n|------|------|\n| 完成率 | ${report.completed_items}/${report.total_items} (${Math.round(report.completion_rate * 100)}%) |\n| 正确率 | ${Math.round(report.accuracy_rate * 100)}% |\n\n### AI老师评语\n${report.ai_summary || '暂无评语'}\n\n---\n来自「作业小助手」`;
  return { title, desp };
}

module.exports = { sendNotification, formatReport };
