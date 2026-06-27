/**
 * Piana API Layer — DeepSeek API integration for question fetching
 * Uses DeepSeek's chat/completions endpoint with web search capability
 */
const API = (() => {
  const BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

  /** Get the stored API key */
  async function getApiKey() {
    return DB.getSetting('deepseek_api_key', '');
  }

  /** Call DeepSeek API */
  async function callDeepSeek(messages, options = {}) {
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('请先在设置中配置 DeepSeek API Key');
    }

    const body = {
      model: options.model || 'deepseek-chat',
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens || 4096,
      stream: false
    };

    // DeepSeek supports web search via the top-level 'search' parameter (if enabled for account)
    // or via enabling internet access through system prompt instructions
    // The `enable_search` param is account-dependent; we pass it and fall back gracefully
    if (options.enableSearch !== false) {
      // Try the official web_search parameter (supported on some DeepSeek plans)
      body.enable_search = true;
    }

    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API 请求失败 (${response.status}): ${err}`);
    }

    return response.json();
  }

  /** Parse questions from API response text */
  function parseQuestionsFromText(text) {
    // Try to extract JSON array from the response
    // DeepSeek might return markdown-wrapped JSON or raw JSON
    let jsonStr = text;

    // Try to find JSON array in markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Try to find a JSON array directly
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    try {
      const questions = JSON.parse(jsonStr);
      if (Array.isArray(questions)) {
        return questions.map((q, i) => normalizeQuestion(q, i));
      }
    } catch (e) {
      // If JSON parsing fails, try to parse structured text
      console.warn('JSON parse failed, trying text parsing:', e.message);
      return parseQuestionsFromStructuredText(text);
    }

    return [];
  }

  /** Normalize a question object to our schema */
  function normalizeQuestion(q, index) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return {
      id: DB.uid(),
      content: q.content || q.question || q.题干 || '',
      type: q.type === 'fill' || q.type === '填空' || q.type === '填空题' ? 'fill' : 'choice',
      options: q.options || q.choices || q.选项 || ['A', 'B', 'C', 'D'],
      answer: q.answer || q.答案 || q.correctAnswer || '',
      explanation: q.explanation || q.解析 || q.reason || '',
      knowledgePoint: q.knowledgePoint || q.知识点 || '未分类',
      category: q.category || q.分类 || '教育学',
      difficulty: q.difficulty || q.难度 || 'medium',
      source: 'deepseek',
      createdAt: Date.now(),
      // Spaced Repetition fields
      srLevel: 0,
      srNextReview: now.toISOString(),
      srTotalAttempts: 0,
      srCorrectCount: 0,
      srLastResult: null
    };
  }

  /** Fallback: parse structured text format */
  function parseQuestionsFromStructuredText(text) {
    const questions = [];
    // Split by question numbers like "1." "2." or "题目1" etc.
    const blocks = text.split(/\n(?=\d+[\.\、\)]\s*)/);

    for (const block of blocks) {
      const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const q = {
        id: DB.uid(),
        content: lines[0].replace(/^\d+[\.\、\)]\s*/, '').trim(),
        type: 'choice',
        options: [],
        answer: '',
        explanation: '',
        knowledgePoint: '未分类',
        category: '教育学',
        difficulty: 'medium',
        source: 'deepseek',
        createdAt: Date.now(),
        srLevel: 0,
        srNextReview: now.toISOString(),
        srTotalAttempts: 0,
        srCorrectCount: 0,
        srLastResult: null
      };

      for (const line of lines.slice(1)) {
        const optMatch = line.match(/^([A-D])[\.\、\)]\s*(.+)/);
        if (optMatch) {
          q.options.push(`${optMatch[1]}. ${optMatch[2]}`);
        }
        const ansMatch = line.match(/^(?:答案|正确选项|Answer)[：:]\s*([A-D])/i);
        if (ansMatch) {
          q.answer = ansMatch[1];
        }
        const expMatch = line.match(/^(?:解析|Explanation)[：:]\s*(.+)/i);
        if (expMatch) {
          q.explanation = expMatch[1];
        }
      }

      if (q.content && q.options.length >= 2) {
        questions.push(q);
      }
    }

    return questions;
  }

  /**
   * Fetch questions for a specific knowledge point
   * @param {string} knowledgePoint - E.g. "教育的产生与发展"
   * @param {string} category - "教育学" | "心理学" | "美术"
   * @param {number} count - Number of questions to generate
   * @param {string} type - "choice" | "fill" | "all"
   */
  async function fetchQuestions(knowledgePoint, category, count = 10, type = 'all') {
    const typeDesc = type === 'choice' ? '选择题（4个选项A/B/C/D）'
      : type === 'fill' ? '填空题'
      : '选择题和填空题混合';

    const systemPrompt = `你是一个专业的安徽教师招聘考试（小学美术）出题专家。
请根据指定的知识点，生成${count}道高质量题目。
题目类型：${typeDesc}
考试科目分类：${category}

请联网搜索最新的安徽教招考试真题和模拟题作为参考。

返回严格的JSON数组格式，每个题目包含以下字段：
{
  "content": "题目内容（string）",
  "type": "choice或fill（string）",
  "options": ["A. 选项内容", "B. 选项内容", "C. 选项内容", "D. 选项内容"]（选择题必填，填空题为空数组[]）,
  "answer": "正确答案，选择题填写选项字母如A，填空题填写答案文字（string）",
  "explanation": "详细解析，说明为什么选这个答案，需要知识点讲解（string）",
  "knowledgePoint": "知识点名称（string）",
  "category": "${category}（string）",
  "difficulty": "easy/medium/hard（string）"
}

要求：
1. 题目要有代表性，覆盖该知识点的核心考点
2. 难度分布：30%简单 + 50%中等 + 20%困难
3. 解析要详细，包含知识点回顾
4. 选项要有干扰性，不要明显错误
5. 贴合安徽教招实际考试风格`;

    const userPrompt = `请为知识点「${knowledgePoint}」（分类：${category}）生成${count}道${typeDesc}。
请务必联网搜索最新考试资料作为参考。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await callDeepSeek(messages, {
      temperature: 0.8,
      max_tokens: 4096,
      enableSearch: true
    });

    const responseText = result.choices?.[0]?.message?.content || '';
    const questions = parseQuestionsFromText(responseText);

    // Save to database
    if (questions.length > 0) {
      await DB.putAll('questions', questions);
    }

    return questions;
  }

  /**
   * Batch fetch questions across multiple knowledge points
   */
  async function batchFetchQuestions(knowledgePoints, questionsPerPoint = 5) {
    const allQuestions = [];
    for (const kp of knowledgePoints) {
      try {
        const qs = await fetchQuestions(kp.name, kp.category, questionsPerPoint, 'all');
        allQuestions.push(...qs);
      } catch (e) {
        console.error(`Failed to fetch for ${kp.name}:`, e);
      }
    }
    return allQuestions;
  }

  /**
   * Get AI study suggestion based on error history
   */
  async function getStudySuggestion(weakPoints, recentAccuracy) {
    const weakPointsStr = weakPoints.map(wp =>
      `「${wp.name}」错误率${wp.rate}%（错${wp.wrong}/${wp.total}题）`
    ).join('\n');

    const systemPrompt = `你是一个专业的教师招聘考试备考顾问。根据用户的错题数据，给出针对性的学习建议。`;
    const userPrompt = `我最近在备考安徽教招小学美术岗位，以下是我的薄弱知识点：
${weakPointsStr || '暂无错题数据'}
近期正确率：${recentAccuracy}%

请给出3-5条具体的学习建议，包括：
1. 优先复习哪些知识点
2. 每个知识点的学习重点
3. 推荐的复习方法
4. 时间分配建议

要求建议具体可行，针对性强，字数控制在300字以内。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await callDeepSeek(messages, {
      temperature: 0.6,
      max_tokens: 1024,
      enableSearch: false
    });

    return result.choices?.[0]?.message?.content || '暂时无法生成建议，请稍后再试。';
  }

  /**
   * Judge a fill-in-the-blank answer semantically using DeepSeek.
   * @returns { isCorrect: boolean, reason: string }
   */
  async function judgeFillAnswer(userAnswer, correctAnswer, questionContent) {
    const systemPrompt = `你是一个专业的中文阅卷老师。
请判断用户的填空题答案是否与标准答案一致。
考虑语义等价、同义词、表述差异，不要因为个别字的差异就判错。
但如果核心概念错误，应该判错。

返回纯JSON格式：
{"isCorrect": true/false, "reason": "简短的判断理由（20字以内）"}`;

    const userPrompt = `题目：${questionContent}
标准答案：${correctAnswer}
用户答案：${userAnswer}

请判断用户答案是否正确。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await callDeepSeek(messages, {
      temperature: 0.1,
      max_tokens: 200,
      enableSearch: false
    });

    const text = result.choices?.[0]?.message?.content || '{"isCorrect":false,"reason":"判断失败"}';
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { isCorrect: false, reason: '解析失败' };
    } catch (e) {
      return { isCorrect: false, reason: '解析异常' };
    }
  }

  return {
    getApiKey, fetchQuestions, batchFetchQuestions, getStudySuggestion, callDeepSeek,
    judgeFillAnswer
  };
})();
