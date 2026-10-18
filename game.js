/**
 * 土城學府公園・小騎士公路車水岸破風小遊戲
 * 純 HTML5 Canvas + Web Audio API 實現，零外部依賴
 */

class RiversideBikeGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // 遊戲狀態
    this.state = 'MENU'; // 'MENU', 'PLAYING', 'GAMEOVER', 'VICTORY'
    this.selectedRoute = 'xinyue'; // 'xinyue', 'yingge', 'tamsui'
    
    // 玩家小騎士狀態
    this.player = {
      x: 0,
      y: 0,
      targetX: 0,
      width: 44,
      height: 70,
      speed: 16, // 當前車速 (km/h)
      maxSpeed: 32,
      minSpeed: 8,
      cadence: 80, // 踏頻 RPM
      energy: 100, // 體力
      water: 100, // 水分
      score: 0,
      distanceTraveledKm: 0,
      targetDistanceKm: 15.0,
      isSprinting: false,
      sprintTimer: 0
    };

    // 道路與障礙物
    this.roadWidth = 320;
    this.roadLeft = 0;
    this.roadRight = 0;
    this.entities = []; // 道具與障礙物
    this.particles = [];
    this.bgOffset = 0;
    this.lastSpawnTime = 0;
    this.gameStartTime = 0;
    this.elapsedSeconds = 0;

    // 音效合成 (Web Audio API)
    this.audioCtx = null;

    // 鍵盤狀態
    this.keys = {
      left: false,
      right: false,
      up: false,
      down: false,
      space: false
    };

    this.initCanvasSize();
    this.bindEvents();
    this.startLoop();
  }

  initCanvasSize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.min(rect.width, 700);
    this.canvas.height = 480;
    this.roadLeft = (this.canvas.width - this.roadWidth) / 2;
    this.roadRight = this.roadLeft + this.roadWidth;
    this.player.x = this.canvas.width / 2;
    this.player.targetX = this.player.x;
    this.player.y = this.canvas.height - 110;
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // 播放合成音效
  playSound(type) {
    if (!this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'bell') {
        // 單車清脆鈴聲 (雙音丁鈴)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1760, now); // A6
        osc.frequency.setValueAtTime(2093, now + 0.08); // C7
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'item') {
        // 拾取道具水滴聲
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523, now); // C5
        osc.frequency.exponentialRampToValueAtTime(1046, now + 0.15); // C6
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'sprint') {
        // 破風加速風聲
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'hit') {
        // 碰到減速坡/障礙低頻聲
        osc.type = 'square';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'victory') {
        // 勝利小號三連音
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = freq;
          o.connect(g);
          g.connect(ctx.destination);
          const t = now + i * 0.12;
          g.gain.setValueAtTime(0.25, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
          o.start(t);
          o.stop(t + 0.25);
        });
      }
    } catch (e) {
      // 靜音回退
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.initCanvasSize());

    // 鍵盤事件
    window.addEventListener('keydown', (e) => {
      this.initAudio();
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.left = true;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.right = true;
      if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.up = true;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.down = true;
      if (['Space'].includes(e.code)) {
        this.keys.space = true;
        this.triggerSprint();
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.left = false;
      if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.right = false;
      if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.up = false;
      if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.down = false;
      if (['Space'].includes(e.code)) this.keys.space = false;
    });

    // 鈴鐺按鈕
    const bellBtn = document.getElementById('game-bell-btn');
    if (bellBtn) {
      bellBtn.addEventListener('click', () => {
        this.initAudio();
        this.playSound('bell');
        this.clearNearbyObstacles();
      });
    }

    // 手機觸控虛擬按鍵
    const bindTouch = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.initAudio();
        this.keys[key] = true;
        if (key === 'space') this.triggerSprint();
      });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.keys[key] = false;
      });
    };

    bindTouch('touch-left', 'left');
    bindTouch('touch-right', 'right');
    bindTouch('touch-up', 'up');
    bindTouch('touch-down', 'down');
    bindTouch('touch-sprint', 'space');
  }

  // 按車鈴清除前方50碼內的散步路人（減速慢行）
  clearNearbyObstacles() {
    this.entities.forEach(ent => {
      if (ent.type === 'dog_walker' && ent.y < this.player.y && ent.y > this.player.y - 180) {
        ent.cleared = true;
        this.createFloatingText('叮鈴！行人靠邊牽行', ent.x, ent.y, '#10b981');
      }
    });
  }

  triggerSprint() {
    if (this.state !== 'PLAYING') return;
    if (this.player.energy >= 30 && !this.player.isSprinting) {
      this.player.isSprinting = true;
      this.player.sprintTimer = 180; // 約3秒 (60fps)
      this.player.energy -= 25;
      this.playSound('sprint');
      this.createFloatingText('⚡ 下把破風衝刺！', this.player.x, this.player.y - 30, '#38bdf8');
    }
  }

  startGame(routeKey = 'xinyue') {
    this.initAudio();
    this.selectedRoute = routeKey;

    let targetDist = 15.0; // 預設新月橋 15km
    let routeTitle = '新月橋天空步道線 (15km)';
    if (routeKey === 'yingge') {
      targetDist = 27.0;
      routeTitle = '鶯歌陶瓷老街線 (27km)';
    } else if (routeKey === 'dadaocheng') {
      targetDist = 37.0;
      routeTitle = '大稻埕貨櫃市集線 (37km)';
    } else if (routeKey === 'tamsui') {
      targetDist = 73.0;
      routeTitle = '淡水老街金色水岸挑戰 (73km)';
    }

    this.player = {
      x: this.canvas.width / 2,
      targetX: this.canvas.width / 2,
      y: this.canvas.height - 110,
      width: 44,
      height: 70,
      speed: 16,
      maxSpeed: 30,
      minSpeed: 8,
      cadence: 80,
      energy: 100,
      water: 100,
      score: 0,
      distanceTraveledKm: 0,
      targetDistanceKm: targetDist,
      isSprinting: false,
      sprintTimer: 0
    };

    this.entities = [];
    this.particles = [];
    this.gameStartTime = Date.now();
    this.lastSpawnTime = Date.now();
    this.state = 'PLAYING';

    document.getElementById('game-route-name-display').textContent = routeTitle;
  }

  spawnEntity() {
    const laneWidth = this.roadWidth / 4;
    const lane = Math.floor(Math.random() * 4);
    const x = this.roadLeft + lane * laneWidth + laneWidth / 2;

    const r = Math.random();
    let entity = null;

    if (r < 0.35) {
      // 道具：水壺補水
      entity = {
        type: 'water',
        name: '水壺補水',
        x: x,
        y: -40,
        width: 30,
        height: 30,
        speed: 0
      };
    } else if (r < 0.60) {
      // 道具：特色美食 (阿婆壽司 / 豆花 / 雙胞胎)
      entity = {
        type: 'food',
        name: '老街補給',
        x: x,
        y: -40,
        width: 32,
        height: 32,
        speed: 0
      };
    } else if (r < 0.80) {
      // 障礙：碎石減速區 (細胎需避開)
      entity = {
        type: 'gravel',
        name: '路面碎石減速條',
        x: x,
        y: -40,
        width: 48,
        height: 24,
        speed: 0
      };
    } else {
      // 障礙：牽狗路人（可按鈴鈴鐺）
      entity = {
        type: 'dog_walker',
        name: '牽狗散步行人',
        x: x,
        y: -40,
        width: 38,
        height: 38,
        speed: 1,
        cleared: false
      };
    }

    if (entity) this.entities.push(entity);
  }

  createFloatingText(text, x, y, color) {
    this.particles.push({
      type: 'text',
      text: text,
      x: x,
      y: y,
      color: color,
      alpha: 1.0,
      vy: -1.2,
      life: 60
    });
  }

  update() {
    if (this.state !== 'PLAYING') return;

    this.elapsedSeconds = Math.floor((Date.now() - this.gameStartTime) / 1000);

    // 處理左右移動 (流暢平滑加速)
    const moveSpeed = 4.5;
    if (this.keys.left) this.player.targetX -= moveSpeed;
    if (this.keys.right) this.player.targetX += moveSpeed;

    // 邊界限制 (必須在自行車道內)
    const margin = 25;
    this.player.targetX = Math.max(this.roadLeft + margin, Math.min(this.roadRight - margin, this.player.targetX));
    this.player.x += (this.player.targetX - this.player.x) * 0.25;

    // 破風衝刺倒數
    if (this.player.isSprinting) {
      this.player.sprintTimer--;
      this.player.speed = 28;
      this.player.cadence = 105;
      if (this.player.sprintTimer <= 0) {
        this.player.isSprinting = false;
        this.player.speed = 16;
      }
    } else {
      // 上下鍵加速/煞車
      if (this.keys.up) {
        this.player.speed = Math.min(this.player.maxSpeed, this.player.speed + 0.15);
        this.player.cadence = Math.min(100, this.player.cadence + 0.4);
      } else if (this.keys.down) {
        this.player.speed = Math.max(this.player.minSpeed, this.player.speed - 0.25);
        this.player.cadence = Math.max(50, this.player.cadence - 0.6);
      } else {
        // 自然回到巡航 16 km/h
        if (this.player.speed > 16.5) this.player.speed -= 0.05;
        if (this.player.speed < 15.5) this.player.speed += 0.05;
        if (this.player.cadence > 82) this.player.cadence -= 0.2;
        if (this.player.cadence < 78) this.player.cadence += 0.2;
      }
    }

    // 隨時間微幅消耗水分與體力
    this.player.water = Math.max(0, this.player.water - 0.015);
    this.player.energy = Math.max(0, this.player.energy - 0.01);

    // 計算累計里程 (以遊戲時間縮尺，約 1.5 ~ 2 分鐘跑完全程)
    const distScale = (this.player.speed / 3600) * 18; // 遊戲內加速縮尺
    this.player.distanceTraveledKm = Math.min(
      this.player.targetDistanceKm,
      this.player.distanceTraveledKm + distScale
    );

    // 勝利判定
    if (this.player.distanceTraveledKm >= this.player.targetDistanceKm) {
      this.state = 'VICTORY';
      this.playSound('victory');
      if (typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } });
      }
      return;
    }

    // 水分或體力耗盡判定
    if (this.player.water <= 0 || this.player.energy <= 0) {
      this.state = 'GAMEOVER';
      this.playSound('hit');
      return;
    }

    // 生成道具與障礙物 (依車速決定下落速度)
    const scrollSpeed = (this.player.speed / 16) * 4.2;
    this.bgOffset = (this.bgOffset + scrollSpeed) % 40;

    const now = Date.now();
    if (now - this.lastSpawnTime > 1200) {
      this.spawnEntity();
      this.lastSpawnTime = now;
    }

    // 更新實體位置與碰撞判定
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const ent = this.entities[i];
      ent.y += scrollSpeed + ent.speed;

      // 檢查與玩家小騎士碰撞
      const dx = Math.abs(ent.x - this.player.x);
      const dy = Math.abs(ent.y - this.player.y);

      if (dx < (ent.width + this.player.width) / 2 && dy < (ent.height + this.player.height) / 2) {
        if (ent.type === 'water') {
          this.player.water = Math.min(100, this.player.water + 25);
          this.player.score += 200;
          this.playSound('item');
          this.createFloatingText('+水壺補水 💧', ent.x, ent.y, '#38bdf8');
          this.entities.splice(i, 1);
          continue;
        } else if (ent.type === 'food') {
          this.player.energy = Math.min(100, this.player.energy + 30);
          this.player.score += 350;
          this.playSound('item');
          this.createFloatingText('+吃美食點心 🍣', ent.x, ent.y, '#fbbf24');
          this.entities.splice(i, 1);
          continue;
        } else if (ent.type === 'gravel') {
          // 公路車細胎撞上碎石，車速頓挫減速
          this.player.speed = Math.max(8, this.player.speed - 6);
          this.player.energy = Math.max(0, this.player.energy - 8);
          this.playSound('hit');
          this.createFloatingText('⚠️ 細胎震動！減速慢行', ent.x, ent.y, '#f87171');
          this.entities.splice(i, 1);
          continue;
        } else if (ent.type === 'dog_walker') {
          if (!ent.cleared) {
            this.player.speed = Math.max(6, this.player.speed - 7);
            this.player.energy = Math.max(0, this.player.energy - 10);
            this.playSound('hit');
            this.createFloatingText('🐕 遇行人牽行慢過', ent.x, ent.y, '#fb7185');
            this.entities.splice(i, 1);
            continue;
          }
        }
      }

      // 超出畫布底部清除
      if (ent.y > this.canvas.height + 60) {
        this.entities.splice(i, 1);
      }
    }

    // 更新飄浮文字粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.y += p.vy;
      p.life--;
      p.alpha = p.life / 60;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. 背景：雙北河濱草地與淡水河水面
    // 左側：綠色河濱公園草坪
    ctx.fillStyle = '#86efac';
    ctx.fillRect(0, 0, this.roadLeft, h);

    // 右側：淡水河/大漢溪蔚藍水面
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(this.roadRight, 0, w - this.roadRight, h);

    // 河水水波紋
    ctx.fillStyle = '#93c5fd';
    for (let y = (this.bgOffset * 2) % 60; y < h; y += 60) {
      ctx.fillRect(this.roadRight + 20, y, w - this.roadRight - 40, 4);
      ctx.fillRect(this.roadRight + 50, y + 30, w - this.roadRight - 100, 3);
    }

    // 2. 自行車專用道 (柏油深灰)
    ctx.fillStyle = '#334155';
    ctx.fillRect(this.roadLeft, 0, this.roadWidth, h);

    // 自行車道路緣紅磚
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(this.roadLeft - 6, 0, 6, h);
    ctx.fillStyle = '#f87171';
    ctx.fillRect(this.roadRight, 0, 6, h);

    // 中央白色虛線 (自行車雙向標線)
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 20]);
    ctx.lineDashOffset = -this.bgOffset;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.setLineDash([]); // 重置

    // 3. 繪製道具與障礙物
    this.entities.forEach(ent => {
      ctx.save();
      ctx.translate(ent.x, ent.y);

      if (ent.type === 'water') {
        // 運動水壺
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.roundRect(-10, -14, 20, 28, 4);
        ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-6, -18, 12, 6);
        // 水滴圖案
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💧', 0, 5);
      } else if (ent.type === 'food') {
        // 美食壽司/點心盤
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🍣', 0, 5);
      } else if (ent.type === 'gravel') {
        // 減速碎石區
        ctx.fillStyle = '#94a3b8';
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#475569';
        for (let i = -16; i <= 16; i += 8) {
          ctx.fillRect(i, -2, 3, 3);
        }
      } else if (ent.type === 'dog_walker') {
        // 散步牽狗行人
        ctx.fillStyle = ent.cleared ? '#10b981' : '#f43f5e';
        ctx.beginPath();
        ctx.arc(0, -6, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ent.cleared ? '🚶' : '🐕', 0, -2);
      }

      ctx.restore();
    });

    // 4. 繪製主角：六年級公路車小騎士 (俯視視角)
    this.drawCyclist(ctx, this.player.x, this.player.y);

    // 5. 飄浮文字粒子
    this.particles.forEach(p => {
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    });

    // 6. 遊戲中頂部儀表板 HUD
    if (this.state === 'PLAYING') {
      this.drawHUD(ctx, w, h);
    } else if (this.state === 'MENU') {
      this.drawMenu(ctx, w, h);
    } else if (this.state === 'GAMEOVER') {
      this.drawGameOver(ctx, w, h);
    } else if (this.state === 'VICTORY') {
      this.drawVictory(ctx, w, h);
    }
  }

  // 繪製專業公路車與小騎士
  drawCyclist(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);

    // 破風衝刺時的動態光環
    if (this.player.isSprinting) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 5, 24, 38, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 公路車細胎前後輪 (黑色高壓窄胎)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-2, -35, 4, 18); // 前輪
    ctx.fillRect(-2, 22, 4, 18);  // 後輪

    // 車架 (亮藍色塗裝公路車)
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 20);
    ctx.stroke();

    // 彎把 (Drop Handlebar)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-16, -20);
    ctx.lineTo(16, -20);
    ctx.stroke();

    // 騎乘者安全帽 (安全第一！亮黃色專業安全帽)
    ctx.fillStyle = '#eab308';
    ctx.beginPath();
    ctx.ellipse(0, -6, 11, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // 騎士肩膀與車衣 (紅色騎行風衣)
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(-14, 3, 28, 14);

    // 左右腳踩踏動畫 (依踏頻旋轉)
    const pedalAngle = (Date.now() / 60) * (this.player.cadence / 80);
    const legOffset = Math.sin(pedalAngle) * 8;
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(-12, 14 + legOffset, 6, 12);
    ctx.fillRect(6, 14 - legOffset, 6, 12);

    ctx.restore();
  }

  drawHUD(ctx, w, h) {
    // 頂部儀表板半透明背底
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.roundRect(10, 10, w - 20, 48, 10);
    ctx.fill();

    // 車速 (km/h)
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`⚡ ${this.player.speed.toFixed(1)} km/h`, 22, 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`踏頻: ${Math.round(this.player.cadence)} RPM`, 24, 46);

    // 里程進度條 (土城學府公園 -> 折返點)
    const barWidth = 140;
    const barX = (w - barWidth) / 2;
    const progress = Math.min(1.0, this.player.distanceTraveledKm / this.player.targetDistanceKm);

    ctx.fillStyle = '#334155';
    ctx.fillRect(barX, 22, barWidth, 10);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(barX, 22, barWidth * progress, 10);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.player.distanceTraveledKm.toFixed(1)} / ${this.player.targetDistanceKm} km`, w / 2, 44);

    // 水分與體力指示器
    const barRightX = w - 130;
    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`💧 水分 ${Math.round(this.player.water)}%`, barRightX, 26);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`⚡ 體力 ${Math.round(this.player.energy)}%`, barRightX, 42);
  }

  drawMenu(ctx, w, h) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚴 小騎士破風挑戰賽', w / 2, h / 2 - 40);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText('點選下方按鈕，挑選一條路線開始出發！', w / 2, h / 2);
    ctx.fillText('← → 轉向 | ↑ 加速 | ↓ 煞車 | 空白鍵 破風衝刺', w / 2, h / 2 + 25);
  }

  drawGameOver(ctx, w, h) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💧 水分或體力耗盡！', w / 2, h / 2 - 30);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText('公路車小騎士叮嚀：出發要帶足兩瓶水，隨時補給吃點心！', w / 2, h / 2);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('點擊下方路線重新挑戰！', w / 2, h / 2 + 35);
  }

  drawVictory(ctx, w, h) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏆 挑戰成功！平安抵達折返點！', w / 2, h / 2 - 40);

    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.fillText(`總得分：${this.player.score} 分 | 用時：${this.elapsedSeconds} 秒`, w / 2, h / 2 - 10);

    ctx.fillStyle = '#a7f3d0';
    ctx.font = '13px sans-serif';
    ctx.fillText('小學六年級公路車水岸完賽認證！準備原路折返學府公園囉！', w / 2, h / 2 + 15);

    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('點擊下方按鈕可挑選其他路線繼續挑戰！', w / 2, h / 2 + 45);
  }

  startLoop() {
    const loop = () => {
      this.update();
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// 註冊全域初始化函式
window.initRiversideBikeGame = function(canvasId) {
  return new RiversideBikeGame(canvasId);
};
