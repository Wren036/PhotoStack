/*!
 * PhotoStack — WeChat-style stacked photo card for chat UIs
 * 微信式合并照片卡：堆叠 + 探边 + 跟手翻页 + 快甩
 *
 * Design spec reverse-engineered frame-by-frame from WeChat by Wren036.
 * 设计规格由 Wren036 逐帧考古自微信原版。
 *
 * Zero dependencies. Pointer Events (touch + mouse unified).
 * License: PolyForm Noncommercial 1.0.0 — commercial use requires permission.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    width: 142,        // 卡片舞台宽 stage width (px)
    height: 190,       // 卡片舞台高 stage height (px)，微信固定 3:4 不随图变形
    peek: 15,          // 第一层探边露出量 first peek offset (px)
    peekStep: 12,      // 每深一层多探出 additional offset per depth (px)
    rotStep: 2.2,      // 每层递进旋转角 rotation per depth (deg)，旋转角随层深递增
    scaleStep: 0.06,   // 每层递进缩小 scale-down per depth
    flingVel: 0.4,     // 快甩判定速度 fling velocity threshold (px/ms)
    counter: false,    // 右下角 n/N 角标（微信原版无此元素，故默认关闭）
    onTap: null,       // (index) => {} 点击当前卡
    onChange: null     // (index) => {} 翻页落账
  };

  class PhotoStack {
    constructor(container, images, options) {
      this.el = typeof container === 'string' ? document.querySelector(container) : container;
      this.images = images.slice();
      this.opt = Object.assign({}, DEFAULTS, options || {});
      this.cur = 0;
      this._anim = null;
      this._animDir = 0;
      this._build();
      this._bindGesture();
      this._apply();
    }

    /* ── DOM ── */
    _build() {
      const o = this.opt;
      this.stage = document.createElement('div');
      this.stage.className = 'pstack-stage';
      this.stage.style.width = o.width + 'px';
      this.stage.style.height = o.height + 'px';
      this.cards = this.images.map((src, i) => {
        const c = document.createElement('div');
        c.className = 'pstack-card';
        c.dataset.i = i;
        const im = document.createElement('img');
        im.src = src;
        im.draggable = false;
        c.appendChild(im);
        this.stage.appendChild(c);
        return c;
      });
      if (o.counter && this.images.length > 1) {
        this.badge = document.createElement('span');
        this.badge.className = 'pstack-badge';
        this.stage.appendChild(this.badge);
      }
      this.el.appendChild(this.stage);
    }

    /* ── 可见探边配额：常态左右各1，贴边时向另一侧借（保持"三张的样子"）── */
    _lr(cur) {
      const n = this.cards.length;
      const la = cur, ra = n - 1 - cur;
      let L = Math.min(la, 1), R = Math.min(ra, 1);
      if (L + R < 2) { L = Math.min(la, 2 - R); R = Math.min(ra, 2 - L); }
      return [L, R];
    }

    /* ── 静止摆位（也被拖拽每帧调用当复位底座，防中间态残留）── */
    _apply() {
      const o = this.opt, cur = this.cur;
      const [L, R] = this._lr(cur);
      this.cards.forEach((c, i) => {
        let t, z, op = 1;
        if (i < cur) {
          const d = cur - i;
          t = `translateX(${-o.peek - (d - 1) * o.peekStep}px) rotate(${-o.rotStep * d}deg) scale(${1 - o.scaleStep * d})`;
          z = 40 - d; op = d > L ? 0 : 1;
        } else if (i === cur) {
          t = 'translateX(0)'; z = 100;
        } else {
          const d = i - cur;
          t = `translateX(${o.peek + (d - 1) * o.peekStep}px) rotate(${o.rotStep * d}deg) scale(${1 - o.scaleStep * d})`;
          z = 100 - d; op = d > R ? 0 : 1;
        }
        c.style.transform = t; c.style.zIndex = z; c.style.opacity = op;
      });
      if (this.badge) this.badge.textContent = (cur + 1) + '/' + this.cards.length;
    }

    /* ── 手指进度：起点到屏幕边的行程做分母，两个方向统一（两边阻力一致）── */
    _progress(dx, D) { return Math.min(1, Math.abs(dx) / Math.max(120, D || 240)); }

    /* ── 擦洗帧（核心运动模型：手指位置 = 翻页动画的进度条）──
       前半程：当前卡跟手滑出到最远（峰值位移 ≈ 卡宽 × 0.52）
       后半程：当前卡自己拐回来、缩小、落进对侧探边位（山峰轨迹）
       全程由手指擦洗，天然可逆零死区 */
    _scrub(dir, p) {
      const o = this.opt, cards = this.cards, cur = this.cur;
      const w = this.stage.offsetWidth || o.width;
      const maxX = w * 0.52;
      cards.forEach(c => { c.style.transition = 'none'; });
      this._apply();
      // 边界预览：第一张能右滑最后一张能左滑，只是滑不远（探边两层轻微联动）
      if ((dir < 0 && cur >= cards.length - 1) || (dir > 0 && cur <= 0)) {
        cards[cur].style.transform = `translateX(${dir * 24 * p}px) rotate(${dir * 2.5 * p}deg)`;
        cards[cur].style.zIndex = 110;
        const n1 = cards[cur + dir], n2 = cards[cur + dir * 2];
        if (n1) n1.style.transform = `translateX(${dir * (o.peek + 8 * p)}px) rotate(${dir * o.rotStep}deg) scale(${1 - o.scaleStep})`;
        if (n2) n2.style.transform = `translateX(${dir * (o.peek + o.peekStep + 5 * p)}px) rotate(${dir * o.rotStep * 2}deg) scale(${1 - o.scaleStep * 2})`;
        return;
      }
      // 当前卡：山峰轨迹（出去→最远→拐回探边位）
      let cx, rot, sc;
      if (p <= 0.5) { const q = p / 0.5; cx = dir * maxX * q; rot = dir * 8 * q; sc = 1; }
      else { const q = (p - 0.5) / 0.5; cx = dir * (maxX - (maxX - o.peek) * q); rot = dir * (8 - (8 - o.rotStep) * q); sc = 1 - o.scaleStep * q; }
      cards[cur].style.transform = `translateX(${cx}px) rotate(${rot}deg) scale(${sc})`;
      cards[cur].style.zIndex = p < 0.5 ? 110 : 102;   // 到最远的瞬间即沉
      // 新顶：从对侧探边位插值升顶
      const nt = cards[cur - dir];
      nt.style.transform = `translateX(${-dir * o.peek * (1 - p)}px) rotate(${-dir * o.rotStep * (1 - p)}deg) scale(${1 - o.scaleStep + o.scaleStep * p})`;
      nt.style.opacity = 1; nt.style.zIndex = 105;
      // 三张守恒接力：新探边后 45% 进场、旧对侧探边前 55% 退完（0.1 重叠窗口，交接不空岗）
      const nn = cards[cur - dir * 2];
      if (nn) {
        nn.style.transform = `translateX(${-dir * (o.peek + o.peekStep - 12 * p)}px) rotate(${-dir * (o.rotStep * 2 - o.rotStep * p)}deg) scale(${1 - o.scaleStep * 2 + o.scaleStep * p})`;
        nn.style.opacity = String(Math.max(parseFloat(nn.style.opacity) || 0, Math.max(0, (p - 0.45) / 0.55)));
        nn.style.zIndex = dir < 0 ? 98 : 38;
      }
      // 边界例外：落账后仍在可见编制里的旧探边不退场（"侧边那张本来就在那"），
      // 反而提前走位到降级后的外探边位等着（"侧边直接提前等着"）
      const old2 = cards[cur + dir];
      if (old2) {
        const newCur = dir < 0 ? Math.min(cur + 1, cards.length - 1) : Math.max(cur - 1, 0);
        const [L2, R2] = this._lr(newCur);
        const oi = cur + dir;
        const stays = oi < newCur ? (newCur - oi) <= L2 : (oi - newCur) <= R2;
        if (!stays) {
          old2.style.opacity = String(Math.max(0, 1 - p / 0.55));
        } else {
          old2.style.transform = `translateX(${dir * (o.peek + o.peekStep * p)}px) rotate(${dir * (o.rotStep + o.rotStep * p)}deg) scale(${1 - o.scaleStep - o.scaleStep * p})`;
        }
      }
    }

    /* ── 完成动画：沿同一条山峰轨迹把剩余程播完（快甩也遵循轨迹到最远再回来）── */
    _finish(dir, fromP) {
      if (this._anim) cancelAnimationFrame(this._anim);
      this._animDir = dir;   // 未落账标记：动画被打断时先落账
      const dur = Math.max(140, (1 - fromP) * 340);
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        this._scrub(dir, fromP + (1 - fromP) * (1 - Math.pow(1 - k, 2)));
        if (k < 1) { this._anim = requestAnimationFrame(step); return; }
        this._anim = null; this._animDir = 0;
        const n = this.cards.length;
        this.cur = dir < 0 ? Math.min(this.cur + 1, n - 1) : Math.max(this.cur - 1, 0);
        this.cards.forEach(c => { c.style.transition = ''; });
        this._apply();   // 擦洗 p=1 态 == 落账态，零跳变
        if (this.opt.onChange) this.opt.onChange(this.cur);
      };
      this._anim = requestAnimationFrame(step);
    }

    _release(dx, D, vel) {
      const dir = dx < 0 ? -1 : 1;
      const p = this._progress(dx, D);
      const can = dir < 0 ? this.cur < this.cards.length - 1 : this.cur > 0;
      // 两条翻页判定：①慢拖过半 ②快甩（速度过阈值，位移再小也翻）
      const fling = Math.abs(vel || 0) > this.opt.flingVel && Math.sign(vel || 0) === Math.sign(dx) && p > 0.04;
      if (can && (p > 0.5 || fling)) { this._finish(dir, p); return; }
      this.cards.forEach(c => { c.style.transition = ''; });
      this._apply();   // 取消：css 过渡回弹归位
    }

    /* ── 手势（Pointer Events：触摸/鼠标统一）── */
    _bindGesture() {
      const st = this.stage;
      let sx = null, sy = 0, dragging = false, swiped = false, lastX = 0, lastT = 0, vel = 0;
      st.addEventListener('pointerdown', (e) => {
        sx = e.clientX; sy = e.clientY;
        lastX = sx; lastT = e.timeStamp; vel = 0;
        dragging = false; swiped = false;
        st.setPointerCapture(e.pointerId);
      });
      st.addEventListener('pointermove', (e) => {
        if (sx === null) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (e.timeStamp > lastT) vel = 0.7 * ((e.clientX - lastX) / (e.timeStamp - lastT)) + 0.3 * vel;
        lastX = e.clientX; lastT = e.timeStamp;
        if (!dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) dragging = true;
        if (dragging) {
          e.preventDefault();
          if (this._anim) {   // 打断完成动画先落账，连甩不鬼畜
            cancelAnimationFrame(this._anim); this._anim = null;
            if (this._animDir) {
              const n = this.cards.length;
              this.cur = this._animDir < 0 ? Math.min(this.cur + 1, n - 1) : Math.max(this.cur - 1, 0);
              this._animDir = 0;
            }
          }
          this._scrub(dx < 0 ? -1 : 1, this._progress(dx, sx));
        }
      });
      const up = (e) => {
        if (sx === null) return;
        const dx = e.clientX - sx, D = sx;
        sx = null;
        if (dragging) { swiped = true; this._release(dx, D, vel); dragging = false; }
      };
      st.addEventListener('pointerup', up);
      st.addEventListener('pointercancel', () => {
        if (dragging) { this._release(0); dragging = false; }
        sx = null;
      });
      st.addEventListener('click', () => {
        if (swiped) { swiped = false; return; }
        if (this.opt.onTap) this.opt.onTap(this.cur);
      });
      st.style.touchAction = 'pan-y';   // 垂直滚动交还给页面，横向归组件
    }

    /* ── 公开 API ── */
    get index() { return this.cur; }
    goto(i) {
      i = Math.max(0, Math.min(this.cards.length - 1, i));
      if (i === this.cur) return;
      this._finish(i > this.cur ? -1 : 1, 0);
      // 多步跳转直接落账（跨多页时逐页动画没有意义）
      if (Math.abs(i - this.cur) > 1) {
        cancelAnimationFrame(this._anim); this._anim = null; this._animDir = 0;
        this.cur = i;
        this.cards.forEach(c => { c.style.transition = ''; });
        this._apply();
        if (this.opt.onChange) this.opt.onChange(this.cur);
      }
    }
    next() { if (this.cur < this.cards.length - 1) this._finish(-1, 0); }
    prev() { if (this.cur > 0) this._finish(1, 0); }
    destroy() {
      if (this._anim) cancelAnimationFrame(this._anim);
      this.stage.remove();
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PhotoStack;
  else global.PhotoStack = PhotoStack;
})(typeof window !== 'undefined' ? window : this);
