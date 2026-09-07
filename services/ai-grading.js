const axios = require('axios');
const config = require('../config');

function buildPrompts(item) {
  const { content, item_type, correct_answer } = item;

  if (item_type === 'math') {
    const systemPrompt = '你是一位经验丰富的小学四年级数学老师，正在批改学生的作业。请仔细观察学生提交的作业图片，认真批改每一道题。';
    const userPrompt = `## 作业题目\n${content}\n## 标准答案\n${correct_answer || '无标准答案，请根据题目自行判断'}\n## 任务\n1. 识别图片中学生的所有答案\n2. 逐题对比标准答案判断对错\n3. 给出每题的批改结果\n## 输出格式(严格JSON，不要包含markdown代码块标记)\n{"items":[{"question":"第1题","student_answer":"xxx","is_correct":true,"feedback":""}],"total":10,"correct":8,"score":80,"comment":"整体不错"}`;
    return { systemPrompt, userPrompt };
  }

  if (item_type === 'practice') {
    const systemPrompt = '你是一位亲切的小学老师，正在确认学生的打卡任务。';
    const userPrompt = `## 打卡任务\n${content}\n## 任务\n查看图片，判断学生是否完成了这项任务。打卡类作业只要提交了照片即视为完成。\n## 输出格式(严格JSON)\n{"items":[{"content":"打卡确认","is_correct":true,"feedback":"已完成"}],"total":1,"correct":1,"score":100,"comment":"坚持打卡，真棒！"}`;
    return { systemPrompt, userPrompt };
  }

  // Default: text type (语文 etc.)
  const systemPrompt = '你是一位经验丰富的小学四年级语文老师，正在批改学生的作业。';
  const userPrompt = `## 作业题目\n${content}\n## 任务\n1. 识别图片中的书写内容\n2. 检查是否完成要求(字数、遍数等)\n3. 检查有无错别字\n## 输出格式(严格JSON)\n{"items":[{"content":"识别到的内容","is_correct":true,"feedback":""}],"total":1,"correct":1,"score":95,"comment":"书写工整"}`;
  return { systemPrompt, userPrompt };
}

function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try to extract JSON from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch (e2) {
        // continue to regex
      }
    }
    // Try regex extraction for JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e3) {
        // fall through
      }
    }
    throw new Error('无法解析AI返回的JSON结果');
  }
}

async function gradeSubmission(imageBase64, item) {
  const { systemPrompt, userPrompt } = buildPrompts(item);

  const requestBody = {
    model: config.dashscopeModel,
    input: {
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { image: `data:image/jpeg;base64,${imageBase64}` },
            { text: userPrompt },
          ],
        },
      ],
    },
    parameters: { result_format: 'message' },
  };

  const response = await axios.post(config.dashscopeEndpoint, requestBody, {
    headers: {
      Authorization: `Bearer ${config.dashscopeApiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  // Parse response
  const aiText = response.data.output.choices[0].message.content[0].text;
  const result = extractJSON(aiText);

  // Validate structure
  if (!result.items || !Array.isArray(result.items)) {
    throw new Error('AI返回结果格式不正确');
  }

  return {
    items: result.items,
    total: result.total || result.items.length,
    correct: result.correct || result.items.filter((i) => i.is_correct).length,
    score: result.score != null ? result.score : 0,
    comment: result.comment || '',
  };
}

async function generateSummary(results) {
  const systemPrompt = '你是一位经验丰富的小学老师，请根据以下作业批改结果，给出一段简洁、鼓励性的总结评语，适合发给家长查看。字数控制在100字以内。';

  const resultsText = results
    .map((r, i) => `第${i + 1}项: ${r.content || '作业'} - 得分${r.score || 0}分, ${r.is_correct ? '正确' : '有误'}, 反馈: ${r.feedback || '无'}`)
    .join('\n');

  const userPrompt = `## 批改结果汇总\n${resultsText}\n\n请给出总结评语。只输出评语内容，不要输出其他格式。`;

  const requestBody = {
    model: config.dashscopeModel,
    input: {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
    parameters: { result_format: 'message' },
  };

  try {
    const response = await axios.post(config.dashscopeEndpoint, requestBody, {
      headers: {
        Authorization: `Bearer ${config.dashscopeApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const text = response.data.output.choices[0].message.content[0].text;
    return text.trim();
  } catch (err) {
    console.error('[AI] Summary generation failed:', err.message);
    return '今日作业已完成，继续努力！';
  }
}

module.exports = { gradeSubmission, generateSummary };
