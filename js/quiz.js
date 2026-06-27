/**
 * Piana Quiz Engine — Question selection, scoring, state management
 */
const QuizEngine = (() => {
  // Session state
  let questions = [];
  let currentIndex = 0;
  let answers = [];       // { questionId, userAnswer, isCorrect, timeSpent }
  let questionStartTime = 0;
  let sessionStartTime = 0;
  let quizConfig = {
    count: 10,
    type: 'all',      // 'choice' | 'fill' | 'all'
    category: 'all',  // 'all' | '教育学' | '心理学' | '美术'
    mode: 'smart'     // 'smart'=间隔重复 | 'review'=仅复习错题/到期 | 'random'=随机
  };
  let timerInterval = null;

  /** Configure the quiz */
  function configure(config) {
    quizConfig = { ...quizConfig, ...config };
  }

  /** Shuffle helper */
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /** Filter pool by config */
  function filterPool(pool) {
    if (quizConfig.category !== 'all') {
      pool = pool.filter(q => q.category === quizConfig.category);
    }
    if (quizConfig.type === 'choice') {
      pool = pool.filter(q => q.type === 'choice');
    } else if (quizConfig.type === 'fill') {
      pool = pool.filter(q => q.type === 'fill');
    }
    return pool;
  }

  /**
   * Select questions using Spaced Repetition priority algorithm.
   * Priority: ① Due for review → ② New/unseen → ③ Weak points → ④ Random fill
   *
   * Ratios (smart mode): ~50% due + ~20% new + ~20% weak + ~10% random
   * Review mode: 100% due (wrong answers + expired reviews)
   * Random mode: original random selection
   */
  async function selectQuestions() {
    const allQuestions = await DB.getAll('questions');
    // Ensure SR fields are initialized
    allQuestions.forEach(q => DB.initSR(q));

    let pool = filterPool(allQuestions);
    if (pool.length === 0) {
      throw new Error('题库中没有符合条件的题目，请先获取题目！');
    }

    const target = Math.min(quizConfig.count, pool.length);

    // ── Random mode: original behavior ──
    if (quizConfig.mode === 'random') {
      return shuffle(pool).slice(0, target);
    }

    // ── Review mode: only due questions ──
    if (quizConfig.mode === 'review') {
      const now = new Date().toISOString();
      const due = pool.filter(q => q.srNextReview <= now && q.srLevel > 0);
      if (due.length === 0) {
        throw new Error('没有待复习的题目，太棒了！🎉');
      }
      return shuffle(due).slice(0, target);
    }

    // ── Smart mode: SR priority queue ──
    const now = new Date().toISOString();

    // Tier 1: Due for review (srNextReview <= now AND has been seen before)
    const due = pool.filter(q => q.srNextReview <= now && q.srLevel > 0);

    // Tier 2: New / never seen
    const newQ = pool.filter(q => q.srLevel === 0);

    // Tier 3: Weak points (high error rate knowledge points)
    const weakPoints = await DB.getWeakPoints(10);
    const weakNames = new Set(weakPoints.map(wp => wp.name));
    const weak = pool.filter(q =>
      weakNames.has(q.knowledgePoint) &&
      !due.find(d => d.id === q.id) &&
      !newQ.find(n => n.id === q.id)
    );

    // Tier 4: Everything else (already seen, not due, not weak)
    const rest = pool.filter(q =>
      !due.find(d => d.id === q.id) &&
      !newQ.find(n => n.id === q.id) &&
      !weak.find(w => w.id === q.id)
    );

    // Assemble with priority ratios
    const selected = [];
    const dedupe = new Set();

    function add(arr, maxCount) {
      const shuffled = shuffle(arr);
      for (const q of shuffled) {
        if (selected.length >= target) break;
        if (!dedupe.has(q.id) && maxCount > 0) {
          selected.push(q);
          dedupe.add(q.id);
        }
      }
    }

    const dueTarget = Math.ceil(target * 0.50);
    const newTarget = Math.ceil(target * 0.20);
    const weakTarget = Math.ceil(target * 0.20);
    // rest fills whatever remains

    add(due, dueTarget);
    add(newQ, newTarget);
    add(weak, weakTarget);
    add(rest, target); // fill remaining

    // If still short, pad with any unused from the pool
    if (selected.length < target) {
      const remaining = pool.filter(q => !dedupe.has(q.id));
      add(remaining, target - selected.length);
    }

    return shuffle(selected).slice(0, target);
  }

  /** Start a new quiz session */
  async function startSession() {
    questions = await selectQuestions();
    currentIndex = 0;
    answers = [];
    sessionStartTime = Date.now();

    if (questions.length === 0) {
      throw new Error('没有可用的题目');
    }

    return questions;
  }

  /** Get current question */
  function getCurrentQuestion() {
    return questions[currentIndex] || null;
  }

  /** Get progress */
  function getProgress() {
    return {
      current: currentIndex + 1,
      total: questions.length,
      answered: answers.length
    };
  }

  /** Start timing a question */
  function startQuestionTimer() {
    questionStartTime = Date.now();
  }

  /** Check answer and record result (async for fill-in DeepSeek judging) */
  async function submitAnswer(userAnswer) {
    const q = getCurrentQuestion();
    if (!q) return null;

    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000);
    let isCorrect = false;
    let judgeDetail = '';

    if (q.type === 'choice') {
      // For choice, compare the option letter
      const userLetter = userAnswer.trim().toUpperCase().charAt(0);
      const correctLetter = q.answer.trim().toUpperCase().charAt(0);
      isCorrect = userLetter === correctLetter;
    } else {
      // For fill-in, use smart judge (local + optional DeepSeek)
      const judge = await smartFillJudge(userAnswer.trim(), q);
      isCorrect = judge.isCorrect;
      judgeDetail = judge.detail || judge.method || '';
    }

    const result = {
      questionId: q.id,
      userAnswer: userAnswer.trim(),
      isCorrect,
      timeSpent,
      knowledgePoint: q.knowledgePoint || '未分类',
      category: q.category || '未分类',
      questionContent: q.content,
      correctAnswer: q.answer,
      explanation: q.explanation,
      judgeDetail
    };

    answers.push(result);

    // Update SR state for this question
    DB.updateQuestionSR(q.id, isCorrect);

    return result;
  }

  /**
   * Smart fill-in-the-blank judging — two-tier system.
   *
   * Tier 1 (local, fast):
   *   - Exact match after normalization
   *   - Contains/keyword overlap
   *   - Levenshtein distance for typos
   *   Returns: { isCorrect, confidence, method }
   *
   * Tier 2 (DeepSeek API, for borderline cases):
   *   - Called when local confidence is 'medium'
   *   - Semantic comparison of user answer vs correct answer
   *   - Skips if question.fillMode === 'exact'
   */
  const FILL_LOCAL_CONFIDENCE_HIGH = 'high';
  const FILL_LOCAL_CONFIDENCE_MEDIUM = 'medium';
  const FILL_LOCAL_CONFIDENCE_LOW = 'low';

  function localFillJudge(userAns, correctAns, keywords) {
    // Normalize: remove punctuation, extra spaces
    const norm = (s) => (s || '').replace(/[，,。\.\s、；;：:！!？?""''「」『』【】（）\(\)\n\r\t]/g, '').toLowerCase().trim();
    const u = norm(userAns);
    const c = norm(correctAns);

    // Empty answer
    if (!u) return { isCorrect: false, confidence: FILL_LOCAL_CONFIDENCE_LOW, method: 'empty' };

    // Exact match after normalization
    if (u === c) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'exact' };

    // For very short answers (1-2 chars), require exact match
    if (c.length <= 2) return { isCorrect: false, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'short-exact' };

    // Contains match: user answer is a substring of correct or vice versa
    if (c.includes(u) && u.length >= c.length * 0.5) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'contains' };
    if (u.includes(c) && c.length >= u.length * 0.5) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'contains' };

    // Keyword overlap check
    if (keywords && keywords.length > 0) {
      const matched = keywords.filter(kw => u.includes(norm(kw)));
      const matchRatio = matched.length / keywords.length;
      if (matchRatio >= 0.6) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'keywords' };
      if (matchRatio >= 0.4) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_MEDIUM, method: 'keywords-partial' };
    }

    // Levenshtein distance check
    const distance = levenshteinDistance(u, c);
    const ratio = 1 - distance / Math.max(c.length, 1);
    if (ratio >= 0.85) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'levenshtein' };
    if (ratio >= 0.65) return { isCorrect: true, confidence: FILL_LOCAL_CONFIDENCE_MEDIUM, method: 'levenshtein-fuzzy' };

    // Clearly wrong
    return { isCorrect: false, confidence: FILL_LOCAL_CONFIDENCE_HIGH, method: 'mismatch' };
  }

  /**
   * Full fill judging — local + optional DeepSeek semantic check.
   * @returns { isCorrect, confidence, method, detail }
   */
  async function smartFillJudge(userAns, question) {
    const keywords = question.keywords || extractKeywords(question.answer);
    const fillMode = question.fillMode || 'semantic'; // 'semantic' | 'exact'

    const local = localFillJudge(userAns, question.answer, keywords);

    // Exact mode: trust local result, no API call
    if (fillMode === 'exact') {
      return { ...local, detail: '答案需要一字不差' };
    }

    // High confidence local result: use it directly
    if (local.confidence === FILL_LOCAL_CONFIDENCE_HIGH) {
      return local;
    }

    // Medium confidence: try DeepSeek semantic check
    if (local.confidence === FILL_LOCAL_CONFIDENCE_MEDIUM && local.isCorrect) {
      // Locally thinks it's correct but not 100% sure — accept it
      return { ...local, detail: '近似匹配通过' };
    }

    // Low confidence or medium+wrong: try DeepSeek
    try {
      const semantic = await API.judgeFillAnswer(userAns, question.answer, question.content);
      if (semantic && semantic.isCorrect !== undefined) {
        return {
          isCorrect: semantic.isCorrect,
          confidence: FILL_LOCAL_CONFIDENCE_HIGH,
          method: 'deepseek',
          detail: semantic.reason || 'AI 语义判断'
        };
      }
    } catch (e) {
      console.warn('DeepSeek fill judge failed, falling back to local:', e.message);
    }

    // Fallback to local result
    return local;
  }

  /** Extract potential keywords from a correct answer */
  function extractKeywords(answer) {
    const cleaned = (answer || '').replace(/[，,。\.\s、；;：:！!？?""''「」『』【】（）\(\)\n]/g, ' ').trim();
    const words = cleaned.split(/\s+/).filter(w => w.length >= 2);
    // Filter out common stop words
    const stopWords = new Set(['的', '了', '是', '在', '和', '与', '或', '对', '从', '到', '等', '及', '为', '被', '把']);
    return words.filter(w => !stopWords.has(w) && w.length >= 2);
  }

  function levenshteinDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  /** Move to next question, returns false if quiz is complete */
  function nextQuestion() {
    currentIndex++;
    if (currentIndex >= questions.length) {
      return false; // Quiz complete
    }
    return true;
  }

  /** Finish quiz and save results */
  async function finishSession() {
    const totalTime = Math.round((Date.now() - sessionStartTime) / 1000);
    const correctCount = answers.filter(a => a.isCorrect).length;
    const accuracy = answers.length > 0
      ? Math.round((correctCount / answers.length) * 100)
      : 0;

    // Calculate score (100 points scale, weighted by difficulty)
    const score = Math.round((correctCount / Math.max(answers.length, 1)) * 100);

    const record = {
      questions: answers,
      score,
      accuracy,
      totalTime,
      totalQuestions: answers.length,
      correctCount,
      category: quizConfig.category
    };

    await DB.saveQuizRecord(record);
    return record;
  }

  /** Get current session summary */
  function getSessionSummary() {
    const correctCount = answers.filter(a => a.isCorrect).length;
    return {
      total: answers.length,
      correct: correctCount,
      wrong: answers.length - correctCount,
      accuracy: answers.length > 0
        ? Math.round((correctCount / answers.length) * 100)
        : 0,
      totalTime: Math.round((Date.now() - sessionStartTime) / 1000)
    };
  }

  /** Start the quiz timer (updates DOM) */
  function startTimer() {
    stopTimer();
    const elapsed = () => Math.round((Date.now() - sessionStartTime) / 1000);
    const timerEl = document.getElementById('quiz-timer');
    timerInterval = setInterval(() => {
      if (timerEl) {
        timerEl.textContent = '⏱ ' + UI.formatTime(elapsed());
      }
    }, 1000);
  }

  /** Stop the quiz timer */
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /** Reset state */
  function reset() {
    stopTimer();
    questions = [];
    currentIndex = 0;
    answers = [];
    sessionStartTime = 0;
    questionStartTime = 0;
  }

  return {
    configure, startSession, getCurrentQuestion, getProgress,
    startQuestionTimer, submitAnswer, nextQuestion, finishSession,
    getSessionSummary, startTimer, stopTimer, reset,
    get questions() { return questions; },
    get currentIndex() { return currentIndex; },
    get answers() { return answers; }
  };
})();
