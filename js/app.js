/**
 * Piana App Controller — Main orchestration, event handling, quiz flow
 */
const app = (() => {
  // Quiz config state (set before starting)
  let _quizCount = 10;
  let _quizType = 'all';
  let _quizCat = 'all';
  let _quizMode = 'smart';
  let _quizAnswered = false; // Whether current question has been answered

  /** Initialize the application */
  async function init() {
    try {
      await DB.initPresets();

      // Load settings
      const apiKey = await DB.getSetting('deepseek_api_key', '');
      if (apiKey) {
        document.getElementById('setting-apikey').value = apiKey;
      }
      const dailyGoal = await DB.getSetting('dailyGoal', '20');
      document.getElementById('setting-daily-goal').value = dailyGoal;
      const qCount = await DB.getSetting('quizCount', '10');
      document.getElementById('setting-quiz-count').value = qCount;
      _quizCount = parseInt(qCount, 10);

      // Update dashboard
      await Report.updateDashboard();

      // Register service worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }

      console.log('Piana initialized successfully');
    } catch (e) {
      console.error('Init error:', e);
      UI.toast('初始化失败：' + e.message, 'error');
    }
  }

  /** Switch between tabs */
  async function switchTab(tabName) {
    UI.switchPage(tabName);

    if (tabName === 'dashboard') {
      await Report.updateDashboard();
    }
    if (tabName === 'bank') {
      await loadQuestionList();
    }
    if (tabName === 'quiz') {
      resetQuizView();
    }
    if (tabName === 'report') {
      await Report.updateReportPage();
    }
  }

  // ─── Quiz Configuration ─────────────────────────────

  function selectQuizCount(count, el) {
    _quizCount = count;
    updateChipGroup(el);
  }

  function selectQuizType(type, el) {
    _quizType = type;
    updateChipGroup(el);
  }

  function selectQuizCat(cat, el) {
    _quizCat = cat;
    updateChipGroup(el);
  }

  function selectQuizMode(mode, el) {
    _quizMode = mode;
    updateChipGroup(el);
  }

  function updateChipGroup(el) {
    const parent = el.parentElement;
    parent.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
  }

  /** Reset the quiz view to setup */
  function resetQuizView() {
    document.getElementById('quiz-setup').classList.remove('hidden');
    document.getElementById('quiz-active').classList.add('hidden');
    document.getElementById('quiz-result').classList.add('hidden');
    QuizEngine.reset();
  }

  /** Start a quiz from dashboard */
  async function startQuiz() {
    await switchTab('quiz');
    try {
      const allQ = await DB.getAll('questions');
      if (allQ.length > 0) {
        _quizMode = 'smart';
        await beginQuiz();
      } else {
        UI.toast('题库为空，请先获取题目', 'info');
        switchTab('bank');
      }
    } catch (e) {
      UI.toast('启动训练失败', 'error');
    }
  }

  /** One-click review: only due/wrong questions */
  async function startReview() {
    await switchTab('quiz');
    try {
      const due = await DB.getDueQuestions('all', 'all');
      if (due.length === 0) {
        UI.toast('没有待复习的题目 🎉', 'success', 3000);
        return;
      }
      _quizMode = 'review';
      _quizCount = Math.min(due.length, 20);
      await beginQuiz();
    } catch (e) {
      UI.toast('启动复习失败', 'error');
    }
  }

  /** Begin the quiz with configured settings */
  async function beginQuiz() {
    try {
      UI.showLoading('准备题目中...');

      QuizEngine.configure({
        count: _quizCount,
        type: _quizType,
        category: _quizCat,
        mode: _quizMode
      });

      await QuizEngine.startSession();

      UI.hideLoading();

      // Switch to active quiz view
      document.getElementById('quiz-setup').classList.add('hidden');
      document.getElementById('quiz-active').classList.remove('hidden');
      document.getElementById('quiz-result').classList.add('hidden');

      QuizEngine.startTimer();
      renderQuestion();
    } catch (e) {
      UI.hideLoading();
      UI.toast(e.message, 'error');
    }
  }

  /** Go back to quiz setup */
  function backToSetup() {
    resetQuizView();
  }

  // ─── Question Rendering ─────────────────────────────

  /** Render the current question */
  function renderQuestion() {
    const q = QuizEngine.getCurrentQuestion();
    if (!q) return;

    _quizAnswered = false;
    QuizEngine.startQuestionTimer();

    const progress = QuizEngine.getProgress();
    document.getElementById('quiz-counter').textContent = `${progress.current}/${progress.total}`;

    // Update progress bar
    const percent = (progress.current / progress.total) * 100;
    document.getElementById('quiz-progress-fill').style.width = percent + '%';

    const container = document.getElementById('quiz-content');
    let html = '';

    html += `<div class="quiz-question-number">第 ${progress.current} 题</div>`;
    html += `<div class="quiz-question-text">${escapeHtml(q.content)}</div>`;

    if (q.type === 'choice') {
      html += renderChoiceOptions(q);
    } else {
      html += renderFillInput(q);
    }

    container.innerHTML = html;

    // Scroll to top
    container.scrollTop = 0;
  }

  function renderChoiceOptions(q) {
    const labels = ['A', 'B', 'C', 'D'];
    const options = q.options || [];
    if (options.length === 0) {
      // Generate default A/B/C/D
      return `
        <div class="quiz-options">
          ${labels.map(l => `
            <div class="quiz-option" data-answer="${l}" onclick="app.selectChoice('${l}', this)">
              <span class="opt-letter">${l}</span>
              <span class="opt-text">选项 ${l}</span>
            </div>
          `).join('')}
        </div>
        <button class="btn-submit" id="btn-submit-answer" disabled onclick="app.confirmChoice()">
          确认答案 ✅
        </button>
        <div class="quiz-explanation hidden" id="quiz-explanation"></div>
        <button class="btn-next hidden" id="btn-next" onclick="app.goNext()">
          下一题 ➡️
        </button>
      `;
    }

    return `
      <div class="quiz-options">
        ${options.map((opt, i) => {
          const label = labels[i] || String.fromCharCode(65 + i);
          const optText = opt.replace(/^[A-D][\.\、\)]\s*/, '');
          return `
            <div class="quiz-option" data-answer="${label}" onclick="app.selectChoice('${label}', this)">
              <span class="opt-letter">${label}</span>
              <span class="opt-text">${escapeHtml(optText)}</span>
            </div>
          `;
        }).join('')}
      </div>
      <button class="btn-submit" id="btn-submit-answer" disabled onclick="app.confirmChoice()">
        确认答案 ✅
      </button>
      <div class="quiz-explanation hidden" id="quiz-explanation"></div>
      <button class="btn-next hidden" id="btn-next" onclick="app.goNext()">
        下一题 ➡️
      </button>
    `;
  }

  function renderFillInput(q) {
    // Auto-focus after render
    setTimeout(() => {
      const inp = document.getElementById('fill-answer');
      if (inp) inp.focus();
    }, 150);

    return `
      <input type="text" class="quiz-fill-input" id="fill-answer"
             placeholder="请输入你的答案..." autocomplete="off"
             onkeydown="if(event.key==='Enter')app.submitFill()">
      <button class="btn-submit" id="btn-submit-answer" onclick="app.submitFill()">
        提交答案 ✅
      </button>
      <div class="quiz-explanation hidden" id="quiz-explanation"></div>
      <button class="btn-next hidden" id="btn-next" onclick="app.goNext()">
        下一题 ➡️
      </button>
    `;
  }

  // ─── Answer Handling ────────────────────────────────

  let _selectedChoice = null;

  function selectChoice(letter, el) {
    if (_quizAnswered) return; // Already answered

    // Deselect all
    document.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
    // Select this one
    el.classList.add('selected');
    _selectedChoice = letter;

    // Enable submit button
    const btn = document.getElementById('btn-submit-answer');
    if (btn) btn.disabled = false;
  }

  async function confirmChoice() {
    if (_quizAnswered || !_selectedChoice) return;
    _quizAnswered = true;

    // Show thinking state for fill-in questions (DeepSeek API)
    const q = QuizEngine.getCurrentQuestion();
    if (q && q.type === 'fill') {
      const submitBtn = document.getElementById('btn-submit-answer');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'AI 判断中...'; }
    }

    const result = await QuizEngine.submitAnswer(_selectedChoice);
    showAnswerFeedback(result);
  }

  async function submitFill() {
    if (_quizAnswered) return;

    const input = document.getElementById('fill-answer');
    const answer = input ? input.value : '';
    if (!answer.trim()) {
      UI.toast('请输入答案', 'info');
      return;
    }

    _quizAnswered = true;
    // Show thinking state
    const submitBtn = document.getElementById('btn-submit-answer');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '🤖 AI 判断中...'; }
    if (input) input.disabled = true;

    const result = await QuizEngine.submitAnswer(answer);
    showAnswerFeedback(result);
  }

  /** Show correct/wrong feedback and explanation */
  function showAnswerFeedback(result) {
    // Disable submit button
    const submitBtn = document.getElementById('btn-submit-answer');
    if (submitBtn) submitBtn.disabled = true;

    if (result.isCorrect) {
      UI.toast('✅ 回答正确！', 'success', 1500);
    } else {
      UI.toast('❌ 回答错误', 'error', 1500);
    }

    // For choice questions, highlight correct/wrong options
    if (QuizEngine.getCurrentQuestion()?.type === 'choice') {
      const q = QuizEngine.getCurrentQuestion();
      const correctLetter = q.answer.trim().toUpperCase().charAt(0);

      document.querySelectorAll('.quiz-option').forEach(opt => {
        const letter = opt.dataset.answer;
        if (letter === correctLetter) {
          opt.classList.add('correct');
        }
        if (letter === result.userAnswer && !result.isCorrect) {
          opt.classList.add('wrong');
          opt.classList.add('shake');
        }
        if (letter === correctLetter && result.isCorrect) {
          opt.classList.add('pop');
        }
        opt.style.pointerEvents = 'none';
      });
    }

    // Show explanation
    const expEl = document.getElementById('quiz-explanation');
    if (expEl) {
      expEl.classList.remove('hidden');
      const correctAns = result.correctAnswer;
      expEl.innerHTML = `
        <strong>正确答案：${escapeHtml(correctAns)}</strong>
        ${result.judgeDetail ? `<br>🔍 判断依据：${escapeHtml(result.judgeDetail)}` : ''}
        ${result.explanation ? `<br><br>📖 ${escapeHtml(result.explanation)}` : ''}
      `;
    }

    // Show next button
    const nextBtn = document.getElementById('btn-next');
    if (nextBtn) nextBtn.classList.remove('hidden');
  }

  /** Go to next question or finish */
  function goNext() {
    const hasNext = QuizEngine.nextQuestion();

    if (hasNext) {
      _selectedChoice = null;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }

  /** Finish the quiz and show results */
  async function finishQuiz() {
    QuizEngine.stopTimer();

    try {
      const record = await QuizEngine.finishSession();

      // Switch to result view
      document.getElementById('quiz-active').classList.add('hidden');
      document.getElementById('quiz-result').classList.remove('hidden');

      // Update result UI
      document.getElementById('result-score').textContent = record.score;
      document.getElementById('result-accuracy').textContent = `正确率 ${record.accuracy}%`;
      document.getElementById('result-time').textContent = `用时 ${UI.formatTime(record.totalTime)}`;

      // Render review list
      const reviewList = document.getElementById('review-list');
      reviewList.innerHTML = record.questions.map((q, i) => `
        <div class="review-item ${q.isCorrect ? 'correct' : 'wrong'}">
          <div class="ri-status">${q.isCorrect ? '✅ 正确' : '❌ 错误'} — 第${i + 1}题</div>
          <div class="ri-question">${escapeHtml(q.questionContent || '')}</div>
          <div class="ri-answer">
            你的答案：${escapeHtml(q.userAnswer)} | 正确答案：${escapeHtml(q.correctAnswer)}
          </div>
        </div>
      `).join('');

      // Celebrate if good score
      if (record.accuracy >= 80) {
        setTimeout(() => UI.celebrate(), 500);
      }

      // Update dashboard data
      await Report.updateDashboard();
    } catch (e) {
      UI.toast('保存结果失败：' + e.message, 'error');
    }
  }

  // ─── Question Bank ──────────────────────────────────

  let _currentFilter = 'all';

  async function filterQuestions(category) {
    _currentFilter = category;
    // Update chip UI
    document.querySelectorAll('#page-bank .filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.cat === category);
    });
    await loadQuestionList();
  }

  function srBadge(q) {
    DB.initSR(q);
    const now = new Date().toISOString();
    if (q.srLevel === 0) return '<span class="q-badge sr-new">🆕 新题</span>';
    if (q.srNextReview <= now) return '<span class="q-badge sr-due">🔔 待复习</span>';
    if (q.srLevel >= 5) return '<span class="q-badge sr-mastered">⭐ 已掌握</span>';
    return `<span class="q-badge sr-level">📅 Lv${q.srLevel}</span>`;
  }

  async function loadQuestionList() {
    const allQuestions = await DB.getAll('questions');
    allQuestions.forEach(q => DB.initSR(q));
    let filtered = allQuestions;
    if (_currentFilter !== 'all') {
      filtered = allQuestions.filter(q => q.category === _currentFilter);
    }

    const container = document.getElementById('question-list');
    if (filtered.length === 0) {
      container.innerHTML = '<p class="empty-hint">题库为空，点击上方按钮获取题目</p>';
      return;
    }

    // Sort: due first, then new, then by level descending
    const now = new Date().toISOString();
    filtered.sort((a, b) => {
      const aDue = a.srNextReview <= now && a.srLevel > 0 ? 0 : 1;
      const bDue = b.srNextReview <= now && b.srLevel > 0 ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return b.srLevel - a.srLevel;
    });

    container.innerHTML = filtered.map(q => `
      <div class="question-item">
        <div class="q-header">
          <span class="q-badge ${q.type}">${q.type === 'choice' ? '选择' : '填空'}</span>
          <span class="q-badge ${q.category}">${q.category}</span>
          ${srBadge(q)}
          <span style="flex:1"></span>
          <span style="font-size:10px;color:var(--color-text-muted);margin-right:4px">${q.srTotalAttempts || 0}次</span>
          <button class="q-delete" onclick="app.deleteQuestion('${q.id}')">🗑</button>
        </div>
        <div class="q-content">${escapeHtml(q.content)}</div>
        <div class="q-answer">✅ 答案：${escapeHtml(q.answer)}</div>
        ${q.knowledgePoint ? `<div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">知识点：${escapeHtml(q.knowledgePoint)}</div>` : ''}
      </div>
    `).join('');
  }

  async function deleteQuestion(id) {
    if (confirm('确定要删除这道题目吗？')) {
      await DB.remove('questions', id);
      await loadQuestionList();
      UI.toast('已删除', 'info');
    }
  }

  // ─── Fetch Questions Modal ──────────────────────────

  function showFetchModal() {
    const html = `
      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">知识点</label>
        <select class="form-input" id="fetch-knowledge-point">
          ${DB.PRESET_KNOWLEDGE.map(kp =>
            `<option value="${kp.name}" data-cat="${kp.category}">[${kp.category}] ${kp.name}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">题目数量</label>
        <select class="form-input" id="fetch-count">
          <option value="5">5 题</option>
          <option value="10" selected>10 题</option>
          <option value="15">15 题</option>
          <option value="20">20 题</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label class="form-label">题目类型</label>
        <select class="form-input" id="fetch-type">
          <option value="all">混合（选择+填空）</option>
          <option value="choice">仅选择题</option>
          <option value="fill">仅填空题</option>
        </select>
      </div>
      <button class="btn-primary" onclick="app.executeFetch()">
        🌐 开始联网获取
      </button>
      <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-top:12px;">
        将通过 DeepSeek 联网搜索获取最新题目
      </p>
    `;

    UI.showModal('🌐 联网获取题目', html);
  }

  async function executeFetch() {
    const kpSelect = document.getElementById('fetch-knowledge-point');
    const countSelect = document.getElementById('fetch-count');
    const typeSelect = document.getElementById('fetch-type');

    const kpName = kpSelect?.value;
    const category = kpSelect?.selectedOptions[0]?.dataset?.cat || '教育学';
    const count = parseInt(countSelect?.value || '10', 10);
    const type = typeSelect?.value || 'all';

    if (!kpName) {
      UI.toast('请选择知识点', 'error');
      return;
    }

    UI.hideModal();
    UI.showLoading('正在联网搜索题目...\n这可能需要十几秒钟');

    try {
      const questions = await API.fetchQuestions(kpName, category, count, type);
      UI.hideLoading();

      if (questions.length > 0) {
        UI.toast(`成功获取 ${questions.length} 道题目！`, 'success');
        await loadQuestionList();
      } else {
        UI.toast('未能获取到题目，请检查API Key或重试', 'error');
      }
    } catch (e) {
      UI.hideLoading();
      UI.toast('获取失败：' + e.message, 'error');
    }
  }

  // ─── Add Question Modal ─────────────────────────────

  function showAddQuestionModal() {
    const html = `
      <div class="form-group" style="margin-bottom:14px;">
        <label class="form-label">题目类型</label>
        <select class="form-input" id="add-q-type" onchange="app.toggleAddQuestionType()">
          <option value="choice">选择题</option>
          <option value="fill">填空题</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:14px;">
        <label class="form-label">分类</label>
        <select class="form-input" id="add-q-category">
          <option value="教育学">教育学</option>
          <option value="心理学">心理学</option>
          <option value="美术">美术</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:14px;">
        <label class="form-label">知识点</label>
        <input type="text" class="form-input" id="add-q-kp" placeholder="例如：教育的产生与发展">
      </div>
      <div class="form-group" style="margin-bottom:14px;">
        <label class="form-label">题目内容</label>
        <textarea class="form-input" id="add-q-content" rows="3" placeholder="请输入题目内容..." style="resize:vertical;"></textarea>
      </div>
      <div id="add-options-container">
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">选项A</label>
          <input type="text" class="form-input" id="add-q-optA" placeholder="选项A内容">
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">选项B</label>
          <input type="text" class="form-input" id="add-q-optB" placeholder="选项B内容">
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">选项C</label>
          <input type="text" class="form-input" id="add-q-optC" placeholder="选项C内容">
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label">选项D</label>
          <input type="text" class="form-input" id="add-q-optD" placeholder="选项D内容">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:14px;">
        <label class="form-label">正确答案</label>
        <input type="text" class="form-input" id="add-q-answer" placeholder="选择题填A/B/C/D，填空题填答案文字">
      </div>
      <div class="form-group" style="margin-bottom:14px;">
        <label class="form-label">解析（可选）</label>
        <textarea class="form-input" id="add-q-explanation" rows="2" placeholder="题目解析..." style="resize:vertical;"></textarea>
      </div>
      <button class="btn-primary" onclick="app.executeAddQuestion()">
        ✏️ 添加题目
      </button>
    `;
    UI.showModal('✏️ 手动添加题目', html);
  }

  function toggleAddQuestionType() {
    const type = document.getElementById('add-q-type')?.value;
    const container = document.getElementById('add-options-container');
    if (container) {
      container.style.display = type === 'choice' ? 'block' : 'none';
    }
  }

  async function executeAddQuestion() {
    const type = document.getElementById('add-q-type')?.value || 'choice';
    const category = document.getElementById('add-q-category')?.value || '教育学';
    const kp = document.getElementById('add-q-kp')?.value?.trim() || '未分类';
    const content = document.getElementById('add-q-content')?.value?.trim();
    const answer = document.getElementById('add-q-answer')?.value?.trim();
    const explanation = document.getElementById('add-q-explanation')?.value?.trim();

    if (!content || !answer) {
      UI.toast('题目内容和答案为必填', 'error');
      return;
    }

    let options = [];
    if (type === 'choice') {
      options = ['A', 'B', 'C', 'D'].map(l => {
        const val = document.getElementById(`add-q-opt${l}`)?.value?.trim();
        return val ? `${l}. ${val}` : `${l}. (未填写)`;
      });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const question = {
      id: DB.uid(),
      content,
      type,
      options,
      answer,
      explanation,
      knowledgePoint: kp,
      category,
      difficulty: 'medium',
      source: 'manual',
      createdAt: Date.now(),
      srLevel: 0,
      srNextReview: now.toISOString(),
      srTotalAttempts: 0,
      srCorrectCount: 0,
      srLastResult: null
    };

    await DB.put('questions', question);
    UI.hideModal();
    UI.toast('题目添加成功！', 'success');
    await loadQuestionList();
  }

  // ─── Settings ───────────────────────────────────────

  async function saveApiKey() {
    const key = document.getElementById('setting-apikey')?.value?.trim() || '';
    await DB.setSetting('deepseek_api_key', key);
    UI.toast(key ? 'API Key 已保存' : 'API Key 已清除', 'info');
  }

  async function saveSetting(key, value) {
    await DB.setSetting(key, value);
    if (key === 'quizCount') _quizCount = parseInt(value, 10);
    UI.toast('设置已保存', 'success');
    await Report.updateDashboard();
  }

  async function clearAllData() {
    if (confirm('确定要清除所有数据吗？此操作不可撤销！')) {
      if (confirm('再次确认：清除所有题目、答题记录和设置？')) {
        await DB.deleteAll();
        await DB.initPresets();
        UI.toast('所有数据已清除', 'info');
        await loadQuestionList();
        await Report.updateDashboard();
      }
    }
  }

  // ─── AI Suggestion ──────────────────────────────────

  async function getAISuggestion() {
    const weakPoints = await DB.getWeakPoints(5);
    const stats = await Report.getOverallStats();

    if (weakPoints.length === 0 && stats.totalQuestions === 0) {
      UI.toast('请先完成一些训练', 'info');
      return;
    }

    const suggestionEl = document.getElementById('suggestion-content');
    suggestionEl.innerHTML = '<div class="spinner" style="border-color:rgba(108,92,231,0.2);border-top-color:var(--color-primary);"></div><p style="text-align:center;margin-top:8px;">AI思考中...</p>';

    try {
      const suggestion = await API.getStudySuggestion(weakPoints, stats.accuracy);
      suggestionEl.innerHTML = suggestion
        .split('\n')
        .filter(line => line.trim())
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('');
    } catch (e) {
      suggestionEl.innerHTML = `<p style="color:var(--color-danger)">生成建议失败：${escapeHtml(e.message)}</p>`;
    }
  }

  // ─── Utility ────────────────────────────────────────

  // ─── Update Question Bank ──────────────────────────

  async function showUpdateModal() {
    UI.showLoading('扫描题库覆盖情况...');
    const allQ = await DB.getAll('questions');
    const kps = DB.PRESET_KNOWLEDGE;
    UI.hideLoading();

    // Calculate coverage per knowledge point
    const coverage = kps.map(kp => {
      const count = allQ.filter(q => q.knowledgePoint === kp.name).length;
      const status = count >= 12 ? 'full' : count >= 5 ? 'partial' : count > 0 ? 'low' : 'empty';
      return { ...kp, count, status };
    });

    const emptyKPs = coverage.filter(c => c.status === 'empty');
    const lowKPs = coverage.filter(c => c.status === 'low');
    const partialKPs = coverage.filter(c => c.status === 'partial');

    const html = `
      <p style="font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;text-align:center;">
        📚 题库总计 <strong>${allQ.length}</strong> 题，覆盖 <strong>${coverage.filter(c=>c.count>0).length}/${kps.length}</strong> 个知识点
      </p>
      ${emptyKPs.length > 0 ? `
        <div style="margin-bottom:12px;">
          <strong style="color:#e74c3c;">🔴 无题目 (${emptyKPs.length}个):</strong>
          <div style="font-size:12px;color:var(--color-text-secondary);margin-top:4px;">
            ${emptyKPs.map(k => `[${k.category}] ${k.name}`).join('、')}
          </div>
        </div>
      ` : ''}
      ${lowKPs.length > 0 ? `
        <div style="margin-bottom:12px;">
          <strong style="color:#e67e22;">🟠 题目不足 (${lowKPs.length}个):</strong>
          <div style="font-size:12px;color:var(--color-text-secondary);margin-top:4px;">
            ${lowKPs.map(k => `[${k.category}] ${k.name}(${k.count}题)`).join('、')}
          </div>
        </div>
      ` : ''}
      <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-bottom:8px;">
        ✅ 已满12题的知识点: ${coverage.filter(c=>c.status==='full').length}个 |
        🟡 5-11题: ${partialKPs.length}个
      </p>
      <button class="btn-primary" onclick="app.executeUpdate(${JSON.stringify(emptyKPs.concat(lowKPs).map(k=>k.name))})">
        🔄 补充缺口 (${emptyKPs.length + lowKPs.length}个知识点)
      </button>
      <p style="font-size:11px;color:var(--color-text-muted);text-align:center;margin-top:8px;">
        将调用 DeepSeek 联网获取缺失知识点的题目，每次约需10-20秒
      </p>
    `;

    UI.showModal('🔄 更新题库', html);
  }

  async function executeUpdate(kpNames) {
    if (!kpNames || kpNames.length === 0) {
      UI.toast('题库已完整，无需更新 ✅', 'success');
      UI.hideModal();
      return;
    }

    UI.hideModal();
    UI.showLoading(`正在更新 ${kpNames.length} 个知识点...`);

    let totalAdded = 0;
    for (let i = 0; i < kpNames.length; i++) {
      const kpName = kpNames[i];
      const kp = DB.PRESET_KNOWLEDGE.find(k => k.name === kpName);
      if (!kp) continue;

      try {
        const qs = await API.fetchQuestions(kpName, kp.category, 10, 'all');
        if (qs && qs.length > 0) {
          // Dedup before saving
          const existing = await DB.getAll('questions');
          const existingContent = new Set(existing.map(q => q.content.slice(0, 30)));
          const newQs = qs.filter(q => !existingContent.has(q.content.slice(0, 30)));
          if (newQs.length > 0) {
            await DB.putAll('questions', newQs);
            totalAdded += newQs.length;
          }
        }
      } catch (e) {
        console.warn(`Update failed for ${kpName}:`, e.message);
      }

      // Update loading text
      UI.showLoading(`更新中... ${i + 1}/${kpNames.length} (已新增${totalAdded}题)`);

      // Delay between requests
      if (i < kpNames.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    UI.hideLoading();
    UI.toast(`更新完成！新增 ${totalAdded} 道题`, 'success');
    await loadQuestionList();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Public API ─────────────────────────────────────
  return {
    init,
    switchTab,

    // Quiz config
    selectQuizCount, selectQuizType, selectQuizCat, selectQuizMode,
    startQuiz, startReview, beginQuiz, backToSetup,

    // Quiz flow
    selectChoice, confirmChoice, submitFill, goNext,

    // Bank
    filterQuestions, deleteQuestion,
    showFetchModal, executeFetch,
    showUpdateModal, executeUpdate,
    showAddQuestionModal, toggleAddQuestionType, executeAddQuestion,

    // Settings
    saveApiKey, saveSetting, clearAllData,

    // AI
    getAISuggestion,

    // Utility
    escapeHtml
  };
})();

// ─── Boot ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
