/**
 * Batch fetch script — calls DeepSeek API for ALL knowledge points
 * Generates a comprehensive question bank JSON for offline use.
 *
 * Usage: node scripts/fetch-all-questions.js
 * Output: questions-seed.json (gitignored, imported by app on first load)
 *
 * Spaced repetition fields are initialized for each question:
 *   srLevel: 0, srNextReview: today, srTotalAttempts: 0, srCorrectCount: 0
 */

const API_KEY = 'sk-9c4292aea42b46eeab0e818acae4d43b';
const BASE_URL = 'https://api.deepseek.com/v1/chat/completions';
const QUESTIONS_PER_KP = 12; // Questions to request per knowledge point

const KNOWLEDGE_POINTS = [
  // 教育学 (13)
  { name: '教育的产生与发展', category: '教育学' },
  { name: '教育学的产生与发展', category: '教育学' },
  { name: '教育与社会发展', category: '教育学' },
  { name: '教育与人的发展', category: '教育学' },
  { name: '教育目的', category: '教育学' },
  { name: '教育制度', category: '教育学' },
  { name: '课程', category: '教育学' },
  { name: '教学（上）', category: '教育学' },
  { name: '教学（下）', category: '教育学' },
  { name: '德育', category: '教育学' },
  { name: '班级管理', category: '教育学' },
  { name: '教师与学生', category: '教育学' },
  { name: '新课程改革', category: '教育学' },
  // 心理学 (11)
  { name: '心理学概述', category: '心理学' },
  { name: '认知过程', category: '心理学' },
  { name: '情绪情感与意志', category: '心理学' },
  { name: '个性心理', category: '心理学' },
  { name: '学习理论', category: '心理学' },
  { name: '学习动机', category: '心理学' },
  { name: '学习迁移', category: '心理学' },
  { name: '知识与技能的学习', category: '心理学' },
  { name: '问题解决与创造性', category: '心理学' },
  { name: '学生心理发展', category: '心理学' },
  { name: '教师心理', category: '心理学' },
  // 美术 (7)
  { name: '美术基础知识', category: '美术' },
  { name: '中国美术史', category: '美术' },
  { name: '外国美术史', category: '美术' },
  { name: '美术课程标准', category: '美术' },
  { name: '美术教学设计', category: '美术' },
  { name: '美术教学评价', category: '美术' },
  { name: '儿童美术心理', category: '美术' },
];

// Simple UID generator
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 5);
}

async function callDeepSeek(messages, options = {}) {
  const body = {
    model: 'deepseek-chat',
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens || 4096,
    stream: false,
    enable_search: options.enableSearch !== false
  };

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }

  return response.json();
}

function parseQuestions(text, knowledgePoint, category) {
  let jsonStr = text;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) jsonStr = codeBlock[1].trim();
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) jsonStr = arrayMatch[0];

  try {
    const questions = JSON.parse(jsonStr);
    if (Array.isArray(questions)) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return questions.map(q => ({
        id: uid(),
        content: q.content || q.question || q.题干 || '',
        type: (q.type === 'fill' || q.type === '填空' || q.type === '填空题') ? 'fill' : 'choice',
        options: Array.isArray(q.options) ? q.options : (q.choices || q.选项 || []),
        answer: q.answer || q.答案 || q.correctAnswer || '',
        explanation: q.explanation || q.解析 || q.reason || '',
        knowledgePoint: knowledgePoint,
        category: category,
        difficulty: q.difficulty || q.难度 || 'medium',
        fillMode: q.fillMode || (q.type === 'fill' ? 'semantic' : undefined),
        keywords: q.keywords || [],
        source: 'deepseek-seed',
        createdAt: Date.now(),
        srLevel: 0,
        srNextReview: now.toISOString(),
        srTotalAttempts: 0,
        srCorrectCount: 0,
        srLastResult: null
      }));
    }
  } catch (e) {
    console.warn(`  ⚠ JSON parse failed for ${knowledgePoint}: ${e.message}`);
  }
  return [];
}

async function fetchForKnowledgePoint(kp, index, total) {
  const type = Math.random() < 0.3 ? 'fill' : 'choice';
  const typeDesc = type === 'choice' ? '选择题（4个选项A/B/C/D）' : '填空题';

  const systemPrompt = `你是一个专业的安徽教师招聘考试（小学美术）出题专家。
请根据知识点生成${QUESTIONS_PER_KP}道高质量题目。
题目类型：${typeDesc}
分类：${kp.category}

请联网搜索最新的安徽教招考试真题作为参考。

返回严格的JSON数组，每个题目包含：
{
  "content": "题目内容",
  "type": "${type}",
  "options": ["A. xx", "B. xx", "C. xx", "D. xx"]（选择=4个选项数组，填空=[]）,
  "answer": "正确答案（选择填A/B/C/D，填空填完整答案）",
  "explanation": "详细解析（100字以上，含知识点讲解）",
  "difficulty": "easy/medium/hard",
  "keywords": ["关键词1", "关键词2"]（填空=关键采分点，选择=[]）
}
难度分布：3道简单 + 6道中等 + 3道困难`;

  const userPrompt = `请为知识点「${kp.name}」（分类：${kp.category}）生成${QUESTIONS_PER_KP}道${typeDesc}。请联网搜索最新资料。`;

  const result = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { temperature: 0.8, max_tokens: 4096, enableSearch: true });

  const text = result.choices?.[0]?.message?.content || '';
  const questions = parseQuestions(text, kp.name, kp.category);

  const typeLabel = type === 'choice' ? '选择' : '填空';
  console.log(`  [${index}/${total}] ${kp.category}/${kp.name} → ${questions.length}道${typeLabel}题`);
  return questions;
}

async function main() {
  console.log('🚀 Piana 批量题库生成器');
  console.log(`📚 知识点总数: ${KNOWLEDGE_POINTS.length}`);
  console.log(`📝 每个知识点目标: ${QUESTIONS_PER_KP}题`);
  console.log(`🎯 预计总量: ~${KNOWLEDGE_POINTS.length * QUESTIONS_PER_KP}题\n`);

  const allQuestions = [];
  const seen = new Set();
  let totalFetched = 0;

  for (let i = 0; i < KNOWLEDGE_POINTS.length; i++) {
    const kp = KNOWLEDGE_POINTS[i];
    process.stdout.write(`⏳ [${i + 1}/${KNOWLEDGE_POINTS.length}] 正在获取: ${kp.category}/${kp.name}...`);

    try {
      const qs = await fetchForKnowledgePoint(kp, i + 1, KNOWLEDGE_POINTS.length);
      let added = 0;
      for (const q of qs) {
        // Deduplicate by content similarity
        const key = q.content.slice(0, 30);
        if (!seen.has(key)) {
          seen.add(key);
          allQuestions.push(q);
          added++;
        }
      }
      totalFetched += added;
      console.log(` ✅ +${added}题 (累计${allQuestions.length})`);

      // Small delay to avoid rate limiting
      if (i < KNOWLEDGE_POINTS.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
  }

  // Save
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', 'questions-seed.json');
  const output = {
    generatedAt: new Date().toISOString(),
    totalQuestions: allQuestions.length,
    knowledgePointsCovered: [...new Set(allQuestions.map(q => q.knowledgePoint))].length,
    questions: allQuestions
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✨ 完成！${allQuestions.length} 道题 → ${outPath}`);
  console.log(`   选择题: ${allQuestions.filter(q => q.type === 'choice').length}`);
  console.log(`   填空题: ${allQuestions.filter(q => q.type === 'fill').length}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
