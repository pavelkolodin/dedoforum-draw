/* nosql.ru paint + audio recorder — чистый JS, без библиотек.
   В форме ответа появляются две кнопки: «Paint» (рисовалка) и «Recorder» (запись звука с микрофона).
   Каждая открывает своё модальное окно. Итог (jpeg / ogg-opus) кладётся в
   input[type=file] «Добавить вложение» — как если бы файл выбрали на диске. */
(function () {
  'use strict';

  var BTN_ID = 'nosql_paint_button';
  var REC_BTN_ID = 'nosql_rec_button';
  var PAINT_MODAL_ID = 'nosql_paint_modal';
  var REC_MODAL_ID = 'nosql_rec_modal';

  var WIDTHS = [1, 3, 5, 10, 15, 20, 30, 50, 100, 155, 200, 300];
  var COLORS = [
    ['#ffffff', 'белый'],
    ['#000000', 'чёрный'],
    ['#ff0000', 'красный'],
    ['#0000ff', 'синий'],
    ['#00a000', 'зелёный'],
    ['#808080', 'серый'],
    ['#800080', 'фиолетовый'],
    ['#ffff00', 'жёлтый']
  ];
  var STEP = 50, MIN = 50, MAX = 2000;   // холст рисовалки
  var QUALITY = 0.95;                     // сжатие jpeg

  var HIST_W = 600, HIST_H = 200;         // гистограмма рекордера
  var BAR_MS = 100;                       // один столбик = 100 мс звука

  var MASK_CSS = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483646;' +
    'background:rgba(0,0,0,0.6);display:flex;align-items:flex-start;justify-content:center;' +
    'overflow:auto;padding:20px;box-sizing:border-box;';
  var PANEL_CSS = 'background:#f4f4f4;border:1px solid #666;padding:10px;' +
    'font:12px/1.2 Arial,sans-serif;color:#000;box-sizing:border-box;';

  var input, fileLabel;

  /* ================= общие helpers ================= */

  function el(tag, css) {
    var e = document.createElement(tag);
    if (css) e.setAttribute('style', css);
    return e;
  }

  function button(parent, label, css, handler) {
    var b = el('button', 'padding:4px 10px;cursor:default;font:12px Arial,sans-serif;' + (css || ''));
    b.type = 'button';
    b.textContent = label;
    b.onclick = handler;
    parent.appendChild(b);
    return b;
  }

  // кладём файл в поле «Добавить вложение» (как будто его выбрали на диске)
  function attachFile(file, note) {
    if (!input) return false;
    var dt = new DataTransfer();
    for (var i = 0; i < input.files.length; i++) dt.items.add(input.files[i]);
    dt.items.add(file);
    try {
      input.files = dt.files;
    } catch (err) {
      return false;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (fileLabel) {
      fileLabel.textContent = note;
    }

    window.user_marker = "" + Date.now();
    return true;
  }

  /* ================= модальные окна ================= */

  function makeModal(id, title, build, onClose) {
    var modal = el('div', MASK_CSS);
    modal.id = id;

    var panel = el('div', PANEL_CSS);
    panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;' +
      'margin:0 0 8px 2px;font-weight:bold;');
    head.appendChild(document.createTextNode(title));
    var close = el('button', 'padding:0 6px;line-height:18px;cursor:default;font:14px Arial,sans-serif;');
    close.type = 'button';
    close.title = 'Закрыть';
    close.textContent = '×';
    close.onclick = function () { onClose ? onClose() : closeModal(modal); };
    head.appendChild(close);
    panel.appendChild(head);

    var body = el('div', '');
    build(body);
    panel.appendChild(body);
    modal.appendChild(panel);

    modal.addEventListener('mousedown', function (e) {
      if (e.target === modal) onClose ? onClose() : closeModal(modal);
    });
    return modal;
  }

  function openModal(modal) {
    if (!modal.parentNode) {
      document.body.appendChild(modal);
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(modal) {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    var open = (paintModal && paintModal.parentNode) || (recModal && recModal.parentNode);
    if (!open) document.body.style.overflow = '';
  }

  /* ================= рисовалка (Paint) ================= */

  var size = 800, color = '#000000', width = 3;
  var drawing = false, prev = null, hover = null;
  var canvas, ctx, overlay, octx, statusEl, paintModal;

  function clearCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function say(text) { if (statusEl) statusEl.textContent = text || ''; }

  function applySize(newSize) {
    newSize = Math.max(MIN, Math.min(MAX, newSize));
    if (newSize === canvas.width) return;
    var old = document.createElement('canvas');
    old.width = canvas.width;
    old.height = canvas.height;
    old.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = newSize;
    canvas.height = newSize;
    canvas.style.width = newSize + 'px';
    canvas.style.height = newSize + 'px';
    overlay.width = newSize;
    overlay.height = newSize;
    overlay.style.width = newSize + 'px';
    overlay.style.height = newSize + 'px';

    clearCanvas();
    ctx.drawImage(old, 0, 0, old.width, old.height, 0, 0, newSize, newSize);
    size = newSize;
    say('Холст: ' + newSize + '×' + newSize);
  }

  function point(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * canvas.width / r.width,
      y: (e.clientY - r.top) * canvas.height / r.height
    };
  }

  function setPen() {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function dot(p) {
    setPen();
    ctx.beginPath();
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function line(a, b) {
    setPen();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawBrushCursor() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!hover) return;
    octx.beginPath();
    octx.arc(hover.x, hover.y, width / 2, 0, Math.PI * 2);
    octx.globalAlpha = 0.35;               // полупрозрачная заливка — видно, что под кистью
    octx.fillStyle = color;
    octx.fill();
    octx.globalAlpha = 1;
    octx.lineWidth = 1;
    octx.strokeStyle = 'rgba(0,0,0,0.75)'; // контур, чтобы белая кисть была видна на белом
    octx.stroke();
  }

  function sendPicture() {
    canvas.toBlob(function (blob) {
      if (!blob) { say('Не удалось получить изображение'); return; }
      var file = new File([blob], 'drawing-' + Date.now() + '.jpg', { type: 'image/jpeg' });
      if (!attachFile(file, 'прикреплено: ' + file.name)) {
        say('Браузер не дал записать файл');
        return;
      }
      closeModal(paintModal);
      say('готово: ' + file.name + ' (' + Math.round(blob.size / 1024) + ' КБ, ' +
          canvas.width + '×' + canvas.height + ')');
    }, 'image/jpeg', QUALITY);
  }

  function buildPaintModal() {
    paintModal = makeModal(PAINT_MODAL_ID, 'Рисовалка (вложение)', function (body) {
      var row = el('div', 'display:flex;align-items:flex-start;gap:8px;');

      // слева — толщина линии
      var leftCol = el('div', 'display:flex;flex-direction:column;gap:4px;');
      WIDTHS.forEach(function (w) {
        var b = el('button', 'display:flex;align-items:center;justify-content:center;gap:4px;' +
          'width:52px;height:26px;padding:0;border:1px solid #666;cursor:default;' +
          'background:' + (w === width ? '#333' : '#fff') + ';');
        b.type = 'button';
        b.title = w + ' px';
        var bar = el('span', 'display:block;width:20px;height:' + Math.min(w, 18) + 'px;' +
          'background:' + (w === width ? '#fff' : '#000') + ';');
        b.appendChild(bar);
        var num = el('span', 'font:11px Arial,sans-serif;color:' + (w === width ? '#fff' : '#000') + ';');
        num.textContent = w;
        b.appendChild(num);
        b.onclick = function () {
          width = w;
          for (var i = 0; i < leftCol.children.length; i++) {
            var k = leftCol.children[i], on = (WIDTHS[i] === width);
            k.style.background = on ? '#333' : '#fff';
            k.firstChild.style.background = on ? '#fff' : '#000';
            k.lastChild.style.color = on ? '#fff' : '#000';
          }
          drawBrushCursor();
        };
        leftCol.appendChild(b);
      });
      row.appendChild(leftCol);

      // центр — холст, поверх него слой с кругом-указателем кисти
      var wrap = el('div', 'position:relative;display:inline-block;line-height:0;');

      canvas = el('canvas', 'position:relative;z-index:0;background:#fff;border:1px solid #333;' +
        'cursor:default;touch-action:none;display:block;');
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      ctx = canvas.getContext('2d');
      clearCanvas();

      overlay = el('canvas', 'position:absolute;left:0;top:0;z-index:1;pointer-events:none;');
      overlay.width = size;
      overlay.height = size;
      overlay.style.width = size + 'px';
      overlay.style.height = size + 'px';
      octx = overlay.getContext('2d');

      canvas.addEventListener('pointerdown', function (e) {
        drawing = true;
        prev = point(e);
        hover = prev;
        dot(prev);
        drawBrushCursor();
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', function (e) {
        hover = point(e);
        if (drawing) { line(prev, hover); prev = hover; }
        drawBrushCursor();
      });
      canvas.addEventListener('pointerup', function () { drawing = false; prev = null; });
      canvas.addEventListener('pointercancel', function () { drawing = false; prev = null; });
      canvas.addEventListener('pointerleave', function () { hover = null; drawBrushCursor(); });
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      window.addEventListener('pointerup', function () { drawing = false; prev = null; });

      wrap.appendChild(canvas);
      wrap.appendChild(overlay);
      row.appendChild(wrap);

      // справа — цвета
      var rightCol = el('div', 'display:flex;flex-direction:column;gap:4px;');
      COLORS.forEach(function (c) {
        var b = el('button', 'display:block;width:26px;height:26px;padding:0;cursor:default;' +
          'background:' + c[0] + ';border:2px solid ' + (c[0] === color ? '#000' : '#999') + ';');
        b.type = 'button';
        b.title = c[1];
        b.onclick = function () {
          color = c[0];
          var kids = rightCol.children;
          for (var i = 0; i < kids.length; i++) {
            kids[i].style.border = '2px solid ' + (COLORS[i][0] === color ? '#000' : '#999');
          }
          drawBrushCursor();
        };
        rightCol.appendChild(b);
      });
      row.appendChild(rightCol);
      body.appendChild(row);

      var bottom = el('div', 'margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;');
      button(bottom, 'CLEAR', '', function () { clearCanvas(); });
      button(bottom, '----', '', function () { applySize(size - STEP); });
      button(bottom, '++++', '', function () { applySize(size + STEP); });
      button(bottom, 'SEND', 'font-weight:bold;', sendPicture);
      statusEl = el('span', 'margin-left:6px;color:#333;');
      statusEl.id = 'nosql_paint_status';
      bottom.appendChild(statusEl);
      body.appendChild(bottom);
    });
  }

  /* ================= рекордер (Recorder) ================= */

  var recModal, hist, hctx, timeEl, scaleEl, recStatus;
  var bars = [], barMs = BAR_MS;
  var recState = 'idle';                 // idle | rec | pause
  var stream = null, recorder = null, audioCtx = null, analyser = null, samples = null;
  var chunks = [], mime = '';
  var raf = 0, bucketMax = 0, bucketStart = 0, segStart = 0, elapsed = 0, recBase = 0;
  var abandon = false, srcNode = null;


  function pickMime() {
    // Список форматов от лучшего к базовым
    const list = [
      'audio/webm;codecs=opus', // Лучший выбор для Chrome (высокое качество речи, низкий битрейт)
      'audio/webm',
      'audio/mp4',              // Поддерживается в Chrome на iOS / macOS
      'audio/mpeg'              // MP3 (редко поддерживается MediaRecorder напрямую, но пусть будет как запасной)
    ];

    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      console.error("MediaRecorder API не поддерживается в этом браузере");
      return '';
    }

    for (let i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) {
        console.log("MIME choice:", list[i]);
        return list[i];
      }
    }

    return '';
  }

  function extOf(m) {
    console.log("extOf(m), ", m);
    if (m.indexOf('ogg') >= 0) return '.ogg';
    if (m.indexOf('mpeg') >= 0 || m.indexOf('mp3') >= 0) return '.mp3';
    if (m.indexOf('webm') >= 0) return '.ogg';
    return '.ogg';
  }

  function fmtTime(ms) {
    var t = ms / 1000, m = Math.floor(t / 60), s = t - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function sayR(text) { if (recStatus) recStatus.textContent = text || ''; }

  function pushBar(v) {
    bars.push(v);
    if (bars.length >= HIST_W) {          // ширина исчерпана — сужаем масштаб вдвое
      var nb = [];
      for (var i = 0; i < bars.length; i += 2) {
        nb.push(Math.max(bars[i], bars[i + 1] === undefined ? 0 : bars[i + 1]));
      }
      bars = nb;
      barMs *= 2;
    }
  }

  function drawHist() {
    hctx.fillStyle = '#ffffff';
    hctx.fillRect(0, 0, HIST_W, HIST_H);
    hctx.fillStyle = '#000000';
    for (var i = 0; i < bars.length; i++) {
      var h = Math.round(bars[i] * HIST_H);
      if (h > 0) hctx.fillRect(i, HIST_H - h, 1, h);
    }
    hctx.fillStyle = '#ff0000';           // красный курсор — текущая позиция записи
    hctx.fillRect(Math.min(bars.length, HIST_W - 1), 0, 1, HIST_H);
    if (scaleEl) {
      scaleEl.textContent = '1 bar = ' + barMs + ' ms, total sec ' +
        (HIST_W * barMs / 1000).toFixed(1);
    }
  }

  function meter() {
    raf = requestAnimationFrame(meter);
    var now = performance.now();
    elapsed = recBase + (now - segStart);
    if (timeEl) timeEl.textContent = fmtTime(elapsed);

    analyser.getFloatTimeDomainData(samples);
    var m = 0;
    for (var i = 0; i < samples.length; i++) {
      var v = samples[i] < 0 ? -samples[i] : samples[i];
      if (v > m) m = v;
    }
    if (m > bucketMax) bucketMax = m;

    while (now - bucketStart >= barMs) {
      // закрываем столбики по 100 мс (с учётом масштаба)
      pushBar(bucketMax);
      bucketMax = 0;
      bucketStart += barMs;
    }
    drawHist();
  }

  function startRec() {
    if (recState === 'rec') return;
    if (recState === 'pause') {           // продолжить запись
      recState = 'rec';
      segStart = performance.now();
      bucketStart = segStart;
      bucketMax = 0;
      recorder.resume();
      meter();
      return;
    }
    sayR('Access mic');

    const audio_settings = {
      echoCancellation: false,  // Отключаем эхоподавление
      noiseSuppression: false,  // Отключаем шумоподавление
      autoGainControl: false,   // Отключаем авторегулировку громкости (AGC)
      // Дополнительные параметры для максимального качества:
      channelCount: 1,          // Попытаться запросить стерео (если микрофон поддерживает)
      sampleRate: 48000,        // Частота дискретизации 48 кГц
      sampleSize: 16            // Разрядность
    };

    navigator.mediaDevices.getUserMedia({ audio: audio_settings }).then(function (st) {
      stream = st;
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      srcNode = audioCtx.createMediaStreamSource(st);
      srcNode.connect(analyser);
      samples = new Float32Array(analyser.fftSize);

      var m = pickMime();
      let settings = m ? { mimeType: m, audioBitsPerSecond: 65000 } : undefined;
      console.log("settings", settings);
      recorder = new MediaRecorder(st, settings);
      mime = recorder.mimeType || m || 'audio/ogg';
      console.log("mime", mime);
      chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = finishRec;
      recorder.start();

      bars = [];
      barMs = BAR_MS;
      elapsed = 0;
      recBase = 0;
      bucketMax = 0;
      segStart = bucketStart = performance.now();
      recState = 'rec';
      drawHist();
      meter();
      sayR('REC: (' + mime + ')');
    }).catch(function (err) {
      sayR('No mic: ' + (err && err.name ? err.name : err));
    });
  }

  function pauseRec() {
    if (recState !== 'rec') return;
    recorder.pause();
    cancelAnimationFrame(raf);
    raf = 0;
    recBase = elapsed;
    recState = 'pause';
    drawHist();
    sayR('Пауза: ' + fmtTime(elapsed) + ' — REC продолжит запись');
  }

  function submitRec() {
    if (!recorder || recorder.state === 'inactive') { sayR('Сначала нажмите REC'); return; }
    abandon = false;
    sayR('Сохраняю…');
    recorder.stop();                      // → finishRec
  }

  function finishRec() {
    cancelAnimationFrame(raf);
    raf = 0;
    var dur = elapsed;
    stopStream();
    recState = 'idle';
    if (abandon) { sayR(''); return; }

    var blob = new Blob(chunks, { type: mime });
    if (!blob.size) { sayR('Пустая запись — нечего прикреплять'); return; }
    var file = new File([blob], 'recording-' + Date.now() + extOf(mime), { type: mime });
    if (!attachFile(file, 'прикреплено: ' + file.name + ' (' + fmtTime(dur) + ')')) {
      sayR('Браузер не дал записать файл');
      return;
    }
    closeModal(recModal);
    sayR('');
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
    }
    analyser = null;
    srcNode = null;
  }

  function closeRec() {
    if (recorder && recorder.state !== 'inactive') {
      abandon = true;
      recorder.stop();
    }
    cancelAnimationFrame(raf);
    raf = 0;
    stopStream();
    recState = 'idle';
    closeModal(recModal);
  }

  function buildRecModal() {
    recModal = makeModal(REC_MODAL_ID, 'Рекордер (микрофон)', function (body) {
      hist = el('canvas', 'background:#fff;border:1px solid #333;display:block;');
      hist.width = HIST_W;
      hist.height = HIST_H;
      hist.style.width = HIST_W + 'px';
      hist.style.height = HIST_H + 'px';
      hctx = hist.getContext('2d');
      body.appendChild(hist);
      drawHist();

      scaleEl = el('div', 'margin:4px 0 2px 2px;color:#555;');
      body.appendChild(scaleEl);

      timeEl = el('div', 'font:22px/1.2 monospace;font-weight:bold;margin:0 0 8px 2px;');
      timeEl.id = 'nosql_rec_time';
      timeEl.textContent = '00:00.0';
      body.appendChild(timeEl);

      var bottom = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;');
      button(bottom, 'REC', '', startRec);
      button(bottom, 'PAUSE', '', pauseRec);
      button(bottom, 'SUBMIT', 'font-weight:bold;', submitRec);
      recStatus = el('span', 'margin-left:6px;color:#333;');
      recStatus.id = 'nosql_rec_status';
      bottom.appendChild(recStatus);
      body.appendChild(bottom);
    }, closeRec);
  }

  /* ================= кнопки в форме ================= */

  function attach() {
    var form = document.getElementById('post_form') ||
               document.querySelector('form[action="topic.php"]');
    if (!form) return false;
    input = form.querySelector('input#attachment[type="file"]');
    if (!input || document.getElementById(BTN_ID)) {
      console.log("cant find attachment")
      return false;
    }
   

    var box = el('div', 'margin:4px 0;display:flex;align-items:center;gap:8px;');

    var btn = el('button', 'padding:2px 10px;cursor:default;font:12px Arial,sans-serif;');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.textContent = 'Paint';
    btn.title = 'Paint a picture';
    btn.onclick = function () {
      if (!paintModal) buildPaintModal();
      openModal(paintModal);
      say('');
    };
    box.appendChild(btn);

    var rbtn = el('button', 'padding:2px 10px;cursor:default;font:12px Arial,sans-serif;');
    rbtn.type = 'button';
    rbtn.id = REC_BTN_ID;
    rbtn.textContent = 'Recorder';
    rbtn.title = 'Записать звук с микрофона и приложить его к сообщению';
    rbtn.onclick = function () {
      if (!recModal) buildRecModal();
      openModal(recModal);
      sayR('');
    };
    box.appendChild(rbtn);

    fileLabel = el('span', 'color:#333;font:11px Arial,sans-serif;');
    box.appendChild(fileLabel);

    // ставим кнопки сразу под строкой «Добавить вложение»
    var wrapper = input.closest('.paste_attachment_wrapper') || input.parentElement;
    if (wrapper.parentNode) {
      wrapper.parentNode.insertBefore(box, wrapper.nextSibling);
    } else {
      form.appendChild(box);
    }
    window.user_marker = "" + Date.now();
    return true;
  }

  function start() {
    if (attach()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (attach() || ++tries > 100) clearInterval(timer);
    }, 300);

    new MutationObserver(function () {
      if (!document.getElementById(BTN_ID)) attach();
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Esc закрывает то окно, которое открыто
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (recModal && recModal.parentNode) closeRec();
      else if (paintModal && paintModal.parentNode) closeModal(paintModal);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
