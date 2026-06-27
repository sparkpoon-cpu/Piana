/**
 * Piana Report Engine — Analytics, charts, data visualization
 */
const Report = (() => {

  /** Calculate overall stats */
  async function getOverallStats() {
    const allRecords = await DB.getAll('quiz_records');
    const totalQuestions = allRecords.reduce((sum, r) => sum + (r.totalQuestions || 0), 0);
    const totalCorrect = allRecords.reduce((sum, r) => sum + (r.correctCount || 0), 0);
    const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    // Streak calculation
    const streak = await calculateStreak(allRecords);

    return { totalQuestions, totalCorrect, accuracy, streak };
  }

  /** Calculate consecutive days streak */
  async function calculateStreak(allRecords) {
    const dates = [...new Set(allRecords.map(r => r.date))].sort().reverse();
    if (dates.length === 0) return 0;

    const today = new Date().toISOString().split('T')[0];
    let streak = 0;

    // Check if studied today
    if (dates[0] !== today && dates[0] !== getYesterday()) {
      return 0; // Streak broken
    }

    // Count consecutive days going backwards
    let checkDate = new Date(today);
    for (const dateStr of dates) {
      const expectedDate = checkDate.toISOString().split('T')[0];
      if (dateStr === expectedDate) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateStr < expectedDate) {
        break; // Gap found
      }
    }

    return streak;
  }

  function getYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  /** Get today's progress percentage */
  async function getTodayProgress() {
    const dailyGoal = parseInt(await DB.getSetting('dailyGoal', '20'), 10);
    const todayRecords = await DB.getTodayRecords();
    const todayTotal = todayRecords.reduce((sum, r) => sum + (r.totalQuestions || 0), 0);
    return {
      completed: todayTotal,
      goal: dailyGoal,
      percent: Math.min(100, Math.round((todayTotal / dailyGoal) * 100))
    };
  }

  /** Get accuracy trend for last N days */
  async function getAccuracyTrend(days = 7) {
    const records = await DB.getRecentRecords(days);
    const dailyMap = {};

    records.forEach(r => {
      if (!dailyMap[r.date]) dailyMap[r.date] = { total: 0, correct: 0 };
      dailyMap[r.date].total += r.totalQuestions || 0;
      dailyMap[r.date].correct += r.correctCount || 0;
    });

    // Fill in all days
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const data = dailyMap[dateStr];
      result.push({
        date: dateStr,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        accuracy: data && data.total > 0 ? Math.round((data.correct / data.total) * 100) : null,
        total: data ? data.total : 0
      });
    }

    return result;
  }

  /** Get accuracy by category */
  async function getCategoryAccuracy() {
    const allRecords = await DB.getAll('quiz_records');
    const catMap = {};

    allRecords.forEach(r => {
      (r.questions || []).forEach(q => {
        const cat = q.category || '未分类';
        if (!catMap[cat]) catMap[cat] = { total: 0, correct: 0 };
        catMap[cat].total++;
        if (q.isCorrect) catMap[cat].correct++;
      });
    });

    return Object.entries(catMap).map(([name, stats]) => ({
      name,
      total: stats.total,
      correct: stats.correct,
      accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
    }));
  }

  /** Draw trend line chart on canvas */
  function drawTrendChart(canvasId, trendData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padding = { top: 20, right: 20, bottom: 36, left: 40 };
    const plotW = W - padding.left - padding.right;
    const plotH = H - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Filter valid data points
    const validData = trendData.filter(d => d.accuracy !== null);
    if (validData.length < 2) {
      ctx.fillStyle = '#b2bec3';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('数据不足，需要至少2天有答题记录', W / 2, H / 2);
      return;
    }

    const maxY = 100;
    const minY = 0;

    const xScale = (i) => padding.left + (i / (trendData.length - 1)) * plotW;
    const yScale = (v) => padding.top + plotH - ((v - minY) / (maxY - minY)) * plotH;

    // Grid lines
    ctx.strokeStyle = 'rgba(108, 92, 231, 0.08)';
    ctx.lineWidth = 1;
    for (let v = 0; v <= 100; v += 25) {
      const y = yScale(v);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(W - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      ctx.fillStyle = '#b2bec3';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(v + '%', padding.left - 8, y + 4);
    }

    // X-axis labels
    ctx.textAlign = 'center';
    trendData.forEach((d, i) => {
      ctx.fillStyle = '#b2bec3';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText(d.label, xScale(i), H - 8);
    });

    // Draw gradient area
    const grad = ctx.createLinearGradient(0, padding.top, 0, H - padding.bottom);
    grad.addColorStop(0, 'rgba(108, 92, 231, 0.25)');
    grad.addColorStop(1, 'rgba(108, 92, 231, 0.02)');

    ctx.beginPath();
    let firstValid = true;
    trendData.forEach((d, i) => {
      if (d.accuracy === null) return;
      const x = xScale(i);
      const y = yScale(d.accuracy);
      if (firstValid) {
        ctx.moveTo(x, y);
        firstValid = false;
      } else {
        ctx.lineTo(x, y);
      }
    });
    // Close the area
    const lastIdx = trendData.map(d => d.accuracy).lastIndexOf(trendData.find(d => d.accuracy !== null)?.accuracy);
    // Actually close properly
    const validPoints = trendData.map((d, i) => ({ x: xScale(i), y: d.accuracy !== null ? yScale(d.accuracy) : null }));
    const lastY = validPoints.filter(p => p.y !== null).pop();
    const firstY = validPoints.filter(p => p.y !== null)[0];
    if (lastY && firstY) {
      ctx.lineTo(lastY.x, H - padding.bottom);
      ctx.lineTo(firstY.x, H - padding.bottom);
    }
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    let started = false;
    trendData.forEach((d, i) => {
      if (d.accuracy === null) return;
      const x = xScale(i);
      const y = yScale(d.accuracy);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw dots
    trendData.forEach((d, i) => {
      if (d.accuracy === null) return;
      const x = xScale(i);
      const y = yScale(d.accuracy);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#6c5ce7';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
    });
  }

  /** Render category bar chart (DOM-based) */
  function renderCategoryBars(data) {
    const container = document.getElementById('category-bars');
    if (!container) return;

    if (data.length === 0 || data.every(d => d.total === 0)) {
      container.innerHTML = '<p class="empty-hint">暂无数据</p>';
      return;
    }

    container.innerHTML = data.map(d => `
      <div class="cat-bar-row">
        <span class="cat-bar-label">${d.name}</span>
        <div class="cat-bar-track">
          <div class="cat-bar-fill ${d.name}"
               style="width: ${d.accuracy}%">
            ${d.accuracy > 15 ? d.accuracy + '%' : ''}
          </div>
        </div>
        <span class="cat-bar-value">${d.accuracy}%</span>
      </div>
    `).join('');
  }

  /** Render weak points ranking */
  function renderWeakRank(weakPoints) {
    const container = document.getElementById('weak-rank');
    if (!container) return;

    if (weakPoints.length === 0) {
      container.innerHTML = '<p class="empty-hint">🎉 暂无薄弱知识点，继续保持！</p>';
      return;
    }

    container.innerHTML = weakPoints.map((wp, i) => `
      <div class="weak-rank-item">
        <span class="rank-num">${i + 1}</span>
        <div class="rank-info">
          <div class="rank-name">${wp.name}</div>
          <div class="rank-count">错${wp.wrong}题 / 共${wp.total}题</div>
        </div>
        <span class="rank-rate">${wp.rate}%</span>
      </div>
    `).join('');
  }

  /** Update the dashboard UI */
  async function updateDashboard() {
    const stats = await getOverallStats();
    const progress = await getTodayProgress();
    const weakPoints = await DB.getWeakPoints(3);
    const srStats = await DB.getSRStats();

    // Update progress ring
    const circle = document.getElementById('progress-circle');
    if (circle) {
      const circumference = 2 * Math.PI * 85; // r=85
      const dash = (progress.percent / 100) * circumference;
      circle.setAttribute('stroke-dasharray', `${dash} ${circumference}`);
      document.getElementById('today-progress').textContent = progress.percent + '%';
    }

    // Update stats
    document.getElementById('streak-days').textContent = stats.streak;
    document.getElementById('total-questions').textContent = stats.totalQuestions;
    document.getElementById('total-accuracy').textContent = stats.accuracy + '%';

    // Update weak points
    const wpList = document.getElementById('weak-points-list');
    if (wpList) {
      if (weakPoints.length === 0 && srStats.dueCount === 0) {
        wpList.innerHTML = '<p class="empty-hint">还没有答题数据，开始训练吧~</p>';
      } else {
        let html = '';
        if (srStats.dueCount > 0) {
          html += `<div class="weak-point-item" style="background:rgba(230,81,0,0.06);">
            <span class="wp-category" style="background:#fff3e0;color:#e65100;">🔔 待复习</span>
            <span class="wp-name">${srStats.dueCount} 道题等待复习</span>
            <span class="wp-rate" style="color:#e65100;" onclick="app.startReview()">去复习→</span>
          </div>`;
        }
        if (srStats.newCount > 0) {
          html += `<div class="weak-point-item" style="background:rgba(21,101,192,0.04);">
            <span class="wp-category" style="background:#e3f2fd;color:#1565c0;">🆕 新题</span>
            <span class="wp-name">${srStats.newCount} 道未做过</span>
          </div>`;
        }
        if (srStats.masteredCount > 0) {
          html += `<div class="weak-point-item" style="background:rgba(46,125,50,0.04);">
            <span class="wp-category" style="background:#e8f5e9;color:#2e7d32;">⭐ 已掌握</span>
            <span class="wp-name">${srStats.masteredCount} 道已精通</span>
          </div>`;
        }
        wpList.innerHTML = html || '<p class="empty-hint">还没有答题数据</p>';
      }
    }
  }

  /** Update report page */
  async function updateReportPage() {
    // Trend chart
    const trendData = await getAccuracyTrend(7);
    const validCount = trendData.filter(d => d.accuracy !== null).length;
    const trendEmpty = document.getElementById('trend-empty');
    const chartCanvas = document.getElementById('chart-trend');

    if (validCount < 2) {
      if (trendEmpty) trendEmpty.classList.remove('hidden');
      if (chartCanvas) chartCanvas.classList.add('hidden');
    } else {
      if (trendEmpty) trendEmpty.classList.add('hidden');
      if (chartCanvas) {
        chartCanvas.classList.remove('hidden');
        drawTrendChart('chart-trend', trendData);
      }
    }

    // Category bars
    const catData = await getCategoryAccuracy();
    renderCategoryBars(catData);

    // Memory distribution
    const srStats = await DB.getSRStats();
    renderMemoryDistribution(srStats);

    // Weak points ranking
    const weakPoints = await DB.getWeakPoints(5);
    renderWeakRank(weakPoints);
  }

  /** Render the memory distribution bar chart */
  function renderMemoryDistribution(srStats) {
    const container = document.getElementById('memory-distribution');
    if (!container) return;
    const levels = [
      { level: 0, label: '🆕 新题', color: '#1565c0', bg: '#e3f2fd' },
      { level: 1, label: '🔴 Lv1 (1天)', color: '#e65100', bg: '#fff3e0' },
      { level: 2, label: '🟠 Lv2 (3天)', color: '#ef6c00', bg: '#fff8e1' },
      { level: 3, label: '🟡 Lv3 (7天)', color: '#f9a825', bg: '#fffde7' },
      { level: 4, label: '🟢 Lv4 (14天)', color: '#2e7d32', bg: '#e8f5e9' },
      { level: 5, label: '⭐ Lv5 (30天)', color: '#1b5e20', bg: '#c8e6c9' }
    ];
    const total = Object.values(srStats.byLevel).reduce((s, c) => s + c, 0);
    if (total === 0) {
      container.innerHTML = '<p class="empty-hint">暂无题目数据</p>';
      return;
    }
    container.innerHTML = levels.map(l => {
      const count = srStats.byLevel[l.level] || 0;
      const pct = Math.round((count / total) * 100);
      return `
        <div class="memory-bar-row">
          <span class="memory-bar-label">${l.label}</span>
          <div class="memory-bar-track" style="background:${l.bg}">
            <div class="memory-bar-fill" style="width:${pct}%;background:${l.color}"></div>
          </div>
          <span class="memory-bar-value">${count}题 (${pct}%)</span>
        </div>
      `;
    }).join('');
  }

  return {
    getOverallStats, getTodayProgress, getAccuracyTrend,
    getCategoryAccuracy, drawTrendChart, renderCategoryBars,
    renderWeakRank, updateDashboard, updateReportPage
  };
})();
