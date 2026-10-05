/* nosql.ru paint and audio recorder. Adds Paint and Recorder controls to the reply form.
   Images and final Ogg/Opus recordings are attached through the file input. */
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
  var STEP = 50, MIN = 50, MAX = 2000;   // Canvas size limits.
  var QUALITY = 0.95;                     // JPEG quality.

  var HIST_W = 600, HIST_H = 200;         // Recorder meter size.
  var BAR_MS = 100;                       // Initial meter bucket duration.

  var MASK_CSS = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483646;' +
    'background:rgba(0,0,0,0.6);display:flex;align-items:flex-start;justify-content:center;' +
    'overflow:auto;padding:20px;box-sizing:border-box;';
  var PANEL_CSS = 'background:#f4f4f4;border:1px solid #666;padding:10px;' +
    'font:12px/1.2 Arial,sans-serif;color:#000;box-sizing:border-box;';

  var input, fileLabel;

  /* Shared helpers */

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

  // Attach a file through the reply form input.
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

  /* Modal helpers */

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

  /* Paint tool */

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
    octx.globalAlpha = 0.35;               // Translucent brush preview.
    octx.fillStyle = color;
    octx.fill();
    octx.globalAlpha = 1;
    octx.lineWidth = 1;
    octx.strokeStyle = 'rgba(0,0,0,0.75)'; // Keep white brushes visible.
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

      // Line width controls.
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

      // Drawing canvas and brush cursor.
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

      // Color controls.
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

  /* ================= Audio recorder ================= */

  var recModal, hist, hctx, trackCanvas, trackCtx, timeEl, scaleEl, recStatus;
  var bars = [], barMs = BAR_MS;
  var recState = 'idle';                 // idle | requesting | rec | pause
  var stream = null, audioCtx = null, analyser = null, meterSamples = null;
  var srcNode = null, captureNode = null, silentNode = null;
  var pcmChunks = [], pcmLength = 0, pcmSamples = null, resampler = null;
  var raf = 0, bucketMax = 0, bucketStart = 0, segStart = 0, elapsed = 0, recBase = 0;
  var captureEpoch = 0, effectEpoch = 0, sendEpoch = 0;
  var effectBusy = false, encodingBusy = false, encodeCancel = null;
  var recButtons = {};

  var PCM_RATE = 48000;
  var TRACK_H = 96;

  function fmtTime(ms) {
    var t = ms / 1000, m = Math.floor(t / 60), s = t - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function sayR(text) { if (recStatus) recStatus.textContent = text || ''; }

  function setRecControls() {
    var busy = effectBusy || encodingBusy;
    var hasSamples = (pcmSamples && pcmSamples.length > 0) || pcmLength > 0;
    if (!recButtons.rec) return;

    recButtons.rec.textContent = recState === 'pause' ? 'RESUME' : 'REC';
    recButtons.rec.disabled = busy || recState === 'rec' || recState === 'requesting';
    recButtons.pause.disabled = busy || recState !== 'rec';
    recButtons.stop.disabled = busy ||
      (recState !== 'rec' && recState !== 'pause' && recState !== 'requesting');
    recButtons.send.disabled = busy || recState === 'requesting' ||
      (!hasSamples && recState === 'idle');
    recButtons.reverb.disabled = busy || recState !== 'idle' || !pcmSamples || !pcmSamples.length;
    recButtons.normalize.disabled = busy || recState !== 'idle' || !pcmSamples || !pcmSamples.length;
  }

  function pushBar(value) {
    bars.push(value);
    if (bars.length >= HIST_W) {
      var reduced = [];
      for (var i = 0; i < bars.length; i += 2) {
        reduced.push(Math.max(bars[i], bars[i + 1] === undefined ? 0 : bars[i + 1]));
      }
      bars = reduced;
      barMs *= 2;
    }
  }

  function drawHist() {
    if (!hctx) return;
    hctx.fillStyle = '#fff';
    hctx.fillRect(0, 0, HIST_W, HIST_H);
    hctx.fillStyle = '#000';
    for (var i = 0; i < bars.length; i++) {
      var height = Math.round(bars[i] * HIST_H);
      if (height > 0) hctx.fillRect(i, HIST_H - height, 1, height);
    }
    hctx.fillStyle = '#e22';
    hctx.fillRect(Math.min(bars.length, HIST_W - 1), 0, 1, HIST_H);
    if (scaleEl) {
      scaleEl.textContent = '1 bar = ' + barMs + ' ms, total sec ' +
        (HIST_W * barMs / 1000).toFixed(1);
    }
  }

  function drawTrack() {
    if (!trackCtx) return;
    trackCtx.fillStyle = '#fff';
    trackCtx.fillRect(0, 0, HIST_W, TRACK_H);
    trackCtx.strokeStyle = '#ddd';
    trackCtx.beginPath();
    trackCtx.moveTo(0, TRACK_H / 2);
    trackCtx.lineTo(HIST_W, TRACK_H / 2);
    trackCtx.stroke();

    if (!pcmSamples || !pcmSamples.length) {
      trackCtx.fillStyle = '#777';
      trackCtx.font = '12px Arial,sans-serif';
      trackCtx.fillText('Waveform appears after STOP', 8, 16);
      return;
    }

    var length = pcmSamples.length;
    var center = TRACK_H / 2;
    var scale = center - 4;
    trackCtx.fillStyle = '#174f8a';
    for (var x = 0; x < HIST_W; x++) {
      var start = Math.floor(x * length / HIST_W);
      if (start >= length) break;
      var end = Math.max(start + 1, Math.floor((x + 1) * length / HIST_W));
      if (end > length) end = length;
      var min = 1, max = -1;
      for (var i = start; i < end; i++) {
        var value = pcmSamples[i] / 32768;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      var top = center - max * scale;
      var bottom = center - min * scale;
      trackCtx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }

  function meter() {
    if (recState !== 'rec' || !analyser) { raf = 0; return; }
    raf = requestAnimationFrame(meter);
    var now = performance.now();
    elapsed = recBase + (now - segStart);
    if (timeEl) timeEl.textContent = fmtTime(elapsed);

    analyser.getFloatTimeDomainData(meterSamples);
    var peak = 0;
    for (var i = 0; i < meterSamples.length; i++) {
      var value = Math.abs(meterSamples[i]);
      if (value > peak) peak = value;
    }
    if (peak > bucketMax) bucketMax = peak;

    while (now - bucketStart >= barMs) {
      pushBar(bucketMax);
      bucketMax = 0;
      bucketStart += barMs;
    }
    drawHist();
  }

  function makeResampler(inputRate, outputRate) {
    if (inputRate === outputRate) {
      return { push: function (block) { return block; } };
    }

    var step = inputRate / outputRate;
    var inputIndex = 0;
    var nextOutput = 0;
    var previous = 0;
    var hasPrevious = false;

    return {
      push: function (block) {
        var output = [];
        for (var i = 0; i < block.length; i++) {
          var current = block[i];
          var index = inputIndex++;
          if (!hasPrevious) {
            output.push(current);
            nextOutput = step;
            previous = current;
            hasPrevious = true;
            continue;
          }
          while (nextOutput <= index) {
            var lower = Math.floor(nextOutput);
            var fraction = nextOutput - lower;
            var value = lower === index ? current : previous + (current - previous) * fraction;
            output.push(value);
            nextOutput += step;
          }
          previous = current;
        }
        return new Float32Array(output);
      }
    };
  }

  function floatToInt16(value) {
    if (!isFinite(value)) value = 0;
    value = Math.max(-1, Math.min(1, value));
    var scaled = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
    return Math.max(-32768, Math.min(32767, scaled));
  }

  function appendPcm(block) {
    if (!block || !block.length) return;
    var converted = new Int16Array(block.length);
    for (var i = 0; i < block.length; i++) converted[i] = floatToInt16(block[i]);
    pcmChunks.push(converted);
    pcmLength += converted.length;
  }

  function collectPcm() {
    var output = new Int16Array(pcmLength);
    var offset = 0;
    for (var i = 0; i < pcmChunks.length; i++) {
      output.set(pcmChunks[i], offset);
      offset += pcmChunks[i].length;
    }
    pcmChunks = [];
    pcmLength = 0;
    pcmSamples = output;
    return output;
  }

  function stopAudioInput() {
    if (captureNode) {
      captureNode.onaudioprocess = null;
      try { captureNode.disconnect(); } catch (e) {}
      captureNode = null;
    }
    if (srcNode) {
      try { srcNode.disconnect(); } catch (e) {}
      srcNode = null;
    }
    if (analyser) {
      try { analyser.disconnect(); } catch (e) {}
      analyser = null;
    }
    if (silentNode) {
      try { silentNode.disconnect(); } catch (e) {}
      silentNode = null;
    }
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    if (audioCtx) {
      var oldContext = audioCtx;
      audioCtx = null;
      try {
        var closing = oldContext.close();
        if (closing && closing.catch) closing.catch(function () {});
      } catch (e) {}
    }
    resampler = null;
    meterSamples = null;
  }

  function failCapture(error, token) {
    if (token !== captureEpoch) return;
    cancelAnimationFrame(raf);
    raf = 0;
    stopAudioInput();
    recState = 'idle';
    var message = error && (error.name || error.message) ? (error.name || error.message) : error;
    sayR('Microphone error: ' + message);
    setRecControls();
  }

  function resumeCapture() {
    if (recState !== 'pause') return;
    var token = captureEpoch;
    var resume = function () {
      if (token !== captureEpoch || recState !== 'pause') return;
      recState = 'rec';
      segStart = performance.now();
      bucketStart = segStart;
      bucketMax = 0;
      setRecControls();
      meter();
      sayR('Recording');
    };
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(resume).catch(function (error) { failCapture(error, token); });
    } else {
      resume();
    }
  }

  function startRec() {
    if (recState === 'rec' || recState === 'requesting' || effectBusy || encodingBusy) return;
    if (recState === 'pause') { resumeCapture(); return; }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      sayR('Microphone capture is not available in this browser');
      return;
    }

    captureEpoch++;
    var token = captureEpoch;
    pcmChunks = [];
    pcmLength = 0;
    pcmSamples = null;
    bars = [];
    barMs = BAR_MS;
    elapsed = 0;
    recBase = 0;
    bucketMax = 0;
    drawHist();
    drawTrack();

    recState = 'requesting';
    sayR('Requesting microphone access…');
    setRecControls();

    var constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: PCM_RATE },
        sampleSize: { ideal: 16 }
      }
    };

    navigator.mediaDevices.getUserMedia(constraints).then(function (mediaStream) {
      if (token !== captureEpoch || !recModal || !recModal.parentNode) {
        mediaStream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = mediaStream;
      try {
        var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) throw new Error('Web Audio API is not available');
        try {
          audioCtx = new AudioContextCtor({ sampleRate: PCM_RATE, latencyHint: 'interactive' });
        } catch (e) {
          audioCtx = new AudioContextCtor();
        }
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        srcNode = audioCtx.createMediaStreamSource(mediaStream);
        captureNode = audioCtx.createScriptProcessor(1024, 1, 1);
        silentNode = audioCtx.createGain();
        silentNode.gain.value = 0;
        meterSamples = new Float32Array(analyser.fftSize);
        resampler = makeResampler(audioCtx.sampleRate, PCM_RATE);

        captureNode.onaudioprocess = function (event) {
          var outputBuffer = event.outputBuffer;
          for (var outChannel = 0; outChannel < outputBuffer.numberOfChannels; outChannel++) {
            outputBuffer.getChannelData(outChannel).fill(0);
          }
          if (recState !== 'rec') return;

          var inputBuffer = event.inputBuffer;
          var channelCount = Math.max(1, inputBuffer.numberOfChannels);
          var mono;
          if (channelCount === 1) {
            mono = inputBuffer.getChannelData(0);
          } else {
            mono = new Float32Array(inputBuffer.length);
            for (var channel = 0; channel < channelCount; channel++) {
              var channelData = inputBuffer.getChannelData(channel);
              for (var sample = 0; sample < mono.length; sample++) {
                mono[sample] += channelData[sample] / channelCount;
              }
            }
          }
          appendPcm(resampler.push(mono));
        };

        srcNode.connect(analyser);
        analyser.connect(silentNode);
        srcNode.connect(captureNode);
        captureNode.connect(silentNode);
        silentNode.connect(audioCtx.destination);
      } catch (error) {
        failCapture(error, token);
        return;
      }

      audioCtx.resume().then(function () {
        if (token !== captureEpoch || recState !== 'requesting') return;
        recState = 'rec';
        segStart = bucketStart = performance.now();
        bucketMax = 0;
        setRecControls();
        drawHist();
        meter();
        sayR('Recording · PCM 48 kHz / 16-bit / mono');
      }).catch(function (error) { failCapture(error, token); });
    }).catch(function (error) { failCapture(error, token); });
  }

  function pauseRec() {
    if (recState !== 'rec') return;
    cancelAnimationFrame(raf);
    raf = 0;
    recBase = elapsed;
    recState = 'pause';
    drawHist();
    setRecControls();
    sayR('Paused · press RESUME to continue');
  }

  function stopRec() {
    if (recState === 'requesting') {
      captureEpoch++;
      recState = 'idle';
      sayR('Microphone request cancelled');
      setRecControls();
      return;
    }
    if (recState !== 'rec' && recState !== 'pause') return;

    recState = 'idle';
    cancelAnimationFrame(raf);
    raf = 0;
    stopAudioInput();
    collectPcm();
    elapsed = pcmSamples.length * 1000 / PCM_RATE;
    if (timeEl) timeEl.textContent = fmtTime(elapsed);
    drawHist();
    drawTrack();
    setRecControls();
    sayR(pcmSamples.length ? 'Stopped · raw PCM is ready for effects or SEND' : 'Empty recording');
  }

  function pcmToFloat(value) {
    return value < 0 ? value / 32768 : value / 32767;
  }

  function smoothLimit(value) {
    var magnitude = Math.abs(value);
    if (magnitude <= 0.90) return value;
    var limited = 0.90 + 0.08 * (1 - Math.exp(-(magnitude - 0.90) / 0.08));
    return (value < 0 ? -1 : 1) * Math.min(0.98, limited);
  }

  function reverbPcmAsync(input, isCurrent, onProgress, onDone) {
    var sampleRate = PCM_RATE;
    var tailLength = Math.round(sampleRate * 0.75);
    var output = new Int16Array(input.length + tailLength);
    var earlyDelaysMs = [11, 17, 23, 31, 41, 53, 67, 83];
    var earlyDelays = earlyDelaysMs.map(function (ms) { return Math.round(sampleRate * ms / 1000); });
    var earlyGains = [0.18, 0.15, 0.13, 0.11, 0.09, 0.07, 0.055, 0.04];
    var combDelaysMs = [29.7, 37.1, 41.1, 43.7];
    var combs = [];
    var dryFadeLength = Math.min(Math.round(sampleRate * 0.01), input.length);
    var tailFadeStart = tailLength - Math.round(sampleRate * 0.05);
    var allpassA = { buffer: new Float32Array(Math.round(sampleRate * 0.0051)), pos: 0 };
    var allpassB = { buffer: new Float32Array(Math.round(sampleRate * 0.0017)), pos: 0 };

    for (var c = 0; c < combDelaysMs.length; c++) {
      var delay = Math.round(sampleRate * combDelaysMs[c] / 1000);
      combs.push({
        buffer: new Float32Array(delay),
        pos: 0,
        feedback: Math.pow(10, -3 * (delay / sampleRate) / 0.42)
      });
    }

    function diffuse(value, state, coefficient) {
      var delayed = state.buffer[state.pos];
      var result = delayed - coefficient * value;
      state.buffer[state.pos] = value + coefficient * result;
      state.pos++;
      if (state.pos >= state.buffer.length) state.pos = 0;
      return result;
    }

    var index = 0;
    var chunkSize = 24000;
    function step() {
      if (!isCurrent()) return;
      var end = Math.min(output.length, index + chunkSize);
      for (; index < end; index++) {
        var dry = index < input.length ? pcmToFloat(input[index]) : 0;
        var early = 0;
        for (var tap = 0; tap < earlyDelays.length; tap++) {
          var sourceIndex = index - earlyDelays[tap];
          if (sourceIndex >= 0 && sourceIndex < input.length) {
            early += pcmToFloat(input[sourceIndex]) * earlyGains[tap];
          }
        }

        var late = 0;
        for (var combIndex = 0; combIndex < combs.length; combIndex++) {
          var comb = combs[combIndex];
          var delayed = comb.buffer[comb.pos];
          comb.buffer[comb.pos] = dry + delayed * comb.feedback;
          comb.pos++;
          if (comb.pos >= comb.buffer.length) comb.pos = 0;
          late += delayed;
        }
        late /= combs.length;
        late = diffuse(late, allpassA, 0.5);
        late = diffuse(late, allpassB, 0.5);

        var dryGain = 1;
        if (index < input.length && dryFadeLength && index >= input.length - dryFadeLength) {
          dryGain = Math.max(0, (input.length - 1 - index) / dryFadeLength);
        }
        var mixed = smoothLimit(dry * dryGain * 0.78 + early * 0.30 + late * 0.42);
        if (index >= input.length) {
          var tailPosition = index - input.length;
          if (tailPosition >= tailFadeStart) {
            mixed *= Math.max(0, (tailLength - 1 - tailPosition) / (tailLength - tailFadeStart));
          }
        }
        output[index] = floatToInt16(mixed);
      }
      onProgress(index / output.length);
      if (index < output.length) setTimeout(step, 0);
      else onDone(output);
    }
    step();
  }

  function normalizePcmAsync(input, isCurrent, onProgress, onDone) {
    var output = new Int16Array(input.length);
    var targetPeak = 0.90;
    var maxGain = 256;
    var silenceFloor = 0.00035;
    var envRelease = Math.exp(-1 / (0.30 * PCM_RATE));
    var gainAttack = 1 - Math.exp(-1 / (0.04 * PCM_RATE));
    var gainRelease = 1 - Math.exp(-1 / (0.18 * PCM_RATE));
    var windowLength = Math.min(input.length, Math.round(0.30 * PCM_RATE));
    var initialPeak = 0;

    for (var i = 0; i < windowLength; i++) {
      var firstLevel = Math.abs(pcmToFloat(input[i]));
      if (firstLevel > initialPeak) initialPeak = firstLevel;
    }

    var envelope = initialPeak;
    var gain = initialPeak > silenceFloor ?
      Math.min(maxGain, targetPeak / initialPeak) : 1;
    var index = 0;
    var chunkSize = 24000;

    function step() {
      if (!isCurrent()) return;
      var end = Math.min(input.length, index + chunkSize);
      for (; index < end; index++) {
        var sample = pcmToFloat(input[index]);
        var level = Math.abs(sample);
        if (level >= envelope) envelope = level;
        else envelope *= envRelease;

        var desiredGain = envelope > silenceFloor ?
          Math.min(maxGain, targetPeak / Math.max(envelope, silenceFloor)) : 1;
        var coefficient = desiredGain < gain ? gainAttack : gainRelease;
        gain += (desiredGain - gain) * coefficient;
        output[index] = floatToInt16(smoothLimit(sample * gain));
      }
      onProgress(index / input.length);
      if (index < input.length) setTimeout(step, 0);
      else onDone(output);
    }
    if (!input.length) onDone(output);
    else step();
  }

  function runPcmEffect(label, worker) {
    if (recState !== 'idle' || effectBusy || encodingBusy || !pcmSamples || !pcmSamples.length) return;
    effectBusy = true;
    var token = ++effectEpoch;
    setRecControls();
    sayR(label + ' · processing raw PCM…');

    try {
      worker(pcmSamples, function () { return token === effectEpoch; }, function (progress) {
        if (token === effectEpoch) sayR(label + ' · ' + Math.round(progress * 100) + '%');
      }, function (result) {
        if (token !== effectEpoch) return;
        pcmSamples = result;
        effectBusy = false;
        if (timeEl) timeEl.textContent = fmtTime(pcmSamples.length * 1000 / PCM_RATE);
        drawTrack();
        setRecControls();
        sayR(label + ' applied · ' + fmtTime(pcmSamples.length * 1000 / PCM_RATE));
      });
    } catch (error) {
      if (token !== effectEpoch) return;
      effectBusy = false;
      setRecControls();
      sayR(label + ' failed: ' + (error && error.message ? error.message : error));
    }
  }

  function reverbRec() { runPcmEffect('REVERB', reverbPcmAsync); }
  function normalizeRec() { runPcmEffect('NORMALIZE', normalizePcmAsync); }

  function chooseOpusMime() {
    if (!window.MediaRecorder || !window.MediaRecorder.isTypeSupported) {
      throw new Error('MediaRecorder is not available');
    }
    var candidates = [
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm'
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (window.MediaRecorder.isTypeSupported(candidates[i])) {
          return { mime: candidates[i], webm: candidates[i].indexOf('webm') >= 0 };
        }
      } catch (e) {}
    }
    throw new Error('This browser has no Ogg/Opus or WebM/Opus encoder');
  }

  function resamplePcmForContext(pcm, contextRate, padSamples) {
    var sourceLength = pcm.length + padSamples;
    var outputLength = Math.ceil(sourceLength * contextRate / PCM_RATE);
    var output = new Float32Array(outputLength);
    if (contextRate === PCM_RATE) {
      for (var i = 0; i < pcm.length; i++) output[i] = pcmToFloat(pcm[i]);
      return output;
    }
    var step = PCM_RATE / contextRate;
    for (var j = 0; j < outputLength; j++) {
      var position = j * step;
      var lower = Math.floor(position);
      if (lower >= pcm.length) break;
      var fraction = position - lower;
      var a = pcmToFloat(pcm[lower]);
      var b = lower + 1 < pcm.length ? pcmToFloat(pcm[lower + 1]) : 0;
      output[j] = a + (b - a) * fraction;
    }
    return output;
  }

  function recordPcmWithMediaRecorder(pcm, mime, webmPadding) {
    return new Promise(function (resolve, reject) {
      var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) { reject(new Error('Web Audio API is not available')); return; }

      var context, destination, source, recorder, watchdog;
      var chunks = [];
      var settled = false;
      var errorOnStop = null;

      function cleanup() {
        if (watchdog) clearTimeout(watchdog);
        if (source) {
          try { source.disconnect(); } catch (e) {}
        }
        if (recorder && recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (e) {}
        }
        if (destination && destination.stream) {
          destination.stream.getTracks().forEach(function (track) { track.stop(); });
        }
        if (context) {
          try {
            var closing = context.close();
            if (closing && closing.catch) closing.catch(function () {});
          } catch (e) {}
        }
      }

      function finish(error, blob) {
        if (settled) return;
        settled = true;
        if (encodeCancel === cancel) encodeCancel = null;
        cleanup();
        if (error) reject(error);
        else resolve(blob);
      }

      function cancel() {
        finish(new Error('Encoding cancelled'));
      }
      encodeCancel = cancel;

      try {
        try {
          context = new AudioContextCtor({ sampleRate: PCM_RATE, latencyHint: 'playback' });
        } catch (e) {
          context = new AudioContextCtor();
        }
        destination = context.createMediaStreamDestination();
        try {
          destination.channelCount = 1;
          destination.channelCountMode = 'explicit';
        } catch (e) {}
        var padding = webmPadding ? Math.round(PCM_RATE * 0.5) : 0;
        var floatPcm = resamplePcmForContext(pcm, context.sampleRate, padding);
        var audioBuffer = context.createBuffer(1, floatPcm.length, context.sampleRate);
        audioBuffer.getChannelData(0).set(floatPcm);
        source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(destination);

        try {
          recorder = new window.MediaRecorder(destination.stream, {
            mimeType: mime,
            audioBitsPerSecond: 64000
          });
        } catch (e) {
          recorder = new window.MediaRecorder(destination.stream, { mimeType: mime });
        }
        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = function (event) {
          errorOnStop = event && event.error ? event.error : new Error('Opus encoding failed');
          finish(errorOnStop);
        };
        recorder.onstop = function () {
          if (errorOnStop) { finish(errorOnStop); return; }
          finish(null, new Blob(chunks, { type: recorder.mimeType || mime }));
        };
        source.onended = function () {
          if (watchdog) clearTimeout(watchdog);
          if (recorder && recorder.state !== 'inactive') {
            try { recorder.stop(); } catch (e) { finish(e); }
          }
        };

        context.resume().then(function () {
          if (settled) return;
          recorder.start();
          source.start(0);
          watchdog = setTimeout(function () {
            if (source) {
              try { source.stop(); } catch (e) {}
            }
            if (recorder && recorder.state !== 'inactive') {
              try { recorder.stop(); } catch (e) { finish(e); }
            }
          }, audioBuffer.duration * 1000 + 30000);
        }).catch(function (error) { finish(error); });
      } catch (error) {
        finish(error);
      }
    });
  }

  function readEbmlVint(bytes, position, removeMarker) {
    if (position >= bytes.length) return null;
    var first = bytes[position];
    var mask = 0x80;
    var length = 1;
    while (length <= 8 && !(first & mask)) { mask >>= 1; length++; }
    if (length > 8 || position + length > bytes.length) return null;

    var firstValue = removeMarker ? (first & (mask - 1)) : first;
    var value = firstValue;
    var unknown = false;
    if (removeMarker) {
      unknown = firstValue === mask - 1;
      for (var u = 1; u < length; u++) {
        if (bytes[position + u] !== 255) unknown = false;
      }
      if (length === 1 && firstValue !== mask - 1) unknown = false;
    }
    for (var i = 1; i < length; i++) value = value * 256 + bytes[position + i];
    return { value: value, length: length, unknown: unknown };
  }

  function readEbmlElement(bytes, position) {
    var id = readEbmlVint(bytes, position, false);
    if (!id) return null;
    var size = readEbmlVint(bytes, position + id.length, true);
    if (!size) return null;
    var dataStart = position + id.length + size.length;
    var end = size.unknown ? null : dataStart + size.value;
    if (end !== null && (end > bytes.length || end < dataStart)) return null;
    return { id: id.value, dataStart: dataStart, end: end, size: size.value, unknown: size.unknown };
  }

  function readEbmlUInt(bytes, start, end) {
    var value = 0;
    for (var i = start; i < end; i++) value = value * 256 + bytes[i];
    return value;
  }

  function readEbmlText(bytes, start, end) {
    var result = '';
    for (var i = start; i < end; i++) result += String.fromCharCode(bytes[i]);
    return result;
  }

  function parseOpusTrack(bytes, start, end, state) {
    var position = start;
    var number = null, codec = '', codecPrivate = null, codecDelay = 0;
    while (position < end) {
      var element = readEbmlElement(bytes, position);
      if (!element || element.end === null) break;
      if (element.id === 0xD7) number = readEbmlUInt(bytes, element.dataStart, element.end);
      else if (element.id === 0x86) codec = readEbmlText(bytes, element.dataStart, element.end);
      else if (element.id === 0x63A2) codecPrivate = bytes.slice(element.dataStart, element.end);
      else if (element.id === 0x56AA) codecDelay = readEbmlUInt(bytes, element.dataStart, element.end);
      position = element.end;
    }
    if (codec === 'A_OPUS') {
      state.trackNumber = number === null ? 1 : number;
      state.codecPrivate = codecPrivate;
      state.codecDelay = codecDelay;
    }
  }

  function parseWebMTracks(bytes, start, end, state) {
    var position = start;
    while (position < end) {
      var element = readEbmlElement(bytes, position);
      if (!element || element.end === null) break;
      if (element.id === 0xAE) parseOpusTrack(bytes, element.dataStart, element.end, state);
      position = element.end;
    }
  }

  function parseWebMBlock(bytes, start, end, state) {
    var track = readEbmlVint(bytes, start, true);
    if (!track) return;
    var position = start + track.length;
    if (position + 3 > end) return;
    var trackNumber = track.value;
    position += 2;
    var flags = bytes[position++];
    if (state.trackNumber === null) state.trackNumber = trackNumber;
    if (trackNumber !== state.trackNumber) return;

    var lace = (flags >> 1) & 3;
    if (lace === 0) {
      if (position < end) state.packets.push(bytes.slice(position, end));
      return;
    }
    if (position >= end) return;
    var frameCount = bytes[position++] + 1;
    var sizes = [];

    if (lace === 1) {
      var total = 0;
      for (var x = 0; x < frameCount - 1; x++) {
        var frameSize = 0, part;
        do {
          if (position >= end) return;
          part = bytes[position++];
          frameSize += part;
        } while (part === 255);
        sizes.push(frameSize);
        total += frameSize;
      }
      sizes.push(end - position - total);
    } else if (lace === 2) {
      var remaining = end - position;
      if (remaining % frameCount !== 0) return;
      var fixedSize = remaining / frameCount;
      for (var f = 0; f < frameCount; f++) sizes.push(fixedSize);
    } else {
      var firstSize = readEbmlVint(bytes, position, true);
      if (!firstSize) return;
      position += firstSize.length;
      sizes.push(firstSize.value);
      var sum = firstSize.value;
      var previousSize = firstSize.value;
      for (var d = 1; d < frameCount - 1; d++) {
        var deltaVint = readEbmlVint(bytes, position, true);
        if (!deltaVint) return;
        position += deltaVint.length;
        var bias = Math.pow(2, 7 * deltaVint.length - 1) - 1;
        var nextSize = previousSize + deltaVint.value - bias;
        if (nextSize < 0) return;
        sizes.push(nextSize);
        sum += nextSize;
        previousSize = nextSize;
      }
      sizes.push(end - position - sum);
    }

    var dataPosition = position;
    for (var i = 0; i < sizes.length; i++) {
      var size = sizes[i];
      if (size < 0 || dataPosition + size > end) return;
      if (size > 0) state.packets.push(bytes.slice(dataPosition, dataPosition + size));
      dataPosition += size;
    }
  }

  function parseWebMBlockGroup(bytes, start, end, state) {
    var position = start;
    while (position < end) {
      var element = readEbmlElement(bytes, position);
      if (!element || element.end === null) break;
      if (element.id === 0xA1) parseWebMBlock(bytes, element.dataStart, element.end, state);
      position = element.end;
    }
  }

  function isSegmentLevelElement(id) {
    return id === 0x114D9B74 || id === 0x1549A966 || id === 0x1654AE6B ||
      id === 0x1F43B675 || id === 0x1C53BB6B || id === 0x1254C367 ||
      id === 0x1941A469 || id === 0x1043A770;
  }

  function parseWebMCluster(bytes, start, limit, unknownSize, state) {
    var position = start;
    while (position < limit) {
      var element = readEbmlElement(bytes, position);
      if (!element) break;
      if (unknownSize && isSegmentLevelElement(element.id)) return position;
      if (element.end === null) break;
      if (element.id === 0xA3) parseWebMBlock(bytes, element.dataStart, element.end, state);
      else if (element.id === 0xA0) parseWebMBlockGroup(bytes, element.dataStart, element.end, state);
      position = element.end;
    }
    return position;
  }

  function parseWebMSegment(bytes, start, limit, state) {
    var position = start;
    while (position < limit) {
      var element = readEbmlElement(bytes, position);
      if (!element) break;
      if (element.id === 0x1654AE6B && element.end !== null) {
        parseWebMTracks(bytes, element.dataStart, element.end, state);
      } else if (element.id === 0x1F43B675) {
        var clusterLimit = element.end === null ? limit : element.end;
        position = parseWebMCluster(bytes, element.dataStart, clusterLimit, element.end === null, state);
        continue;
      }
      if (element.end === null) break;
      position = element.end;
    }
  }

  function parseWebMOpus(bytes) {
    var state = { trackNumber: null, codecPrivate: null, codecDelay: 0, packets: [] };
    var position = 0;
    while (position < bytes.length) {
      var element = readEbmlElement(bytes, position);
      if (!element) { position++; continue; }
      if (element.id === 0x18538067) {
        parseWebMSegment(bytes, element.dataStart, element.end === null ? bytes.length : element.end, state);
        break;
      }
      if (element.end === null) break;
      position = element.end;
    }
    if (!state.packets.length) throw new Error('Could not read Opus packets from WebM');

    var preSkip = 0;
    if (state.codecPrivate && state.codecPrivate.length >= 12 &&
        readEbmlText(state.codecPrivate, 0, 8) === 'OpusHead') {
      preSkip = state.codecPrivate[10] | (state.codecPrivate[11] << 8);
    }
    if (!preSkip && state.codecDelay) preSkip = Math.round(state.codecDelay * PCM_RATE / 1000000000);
    if (!preSkip) preSkip = 312;
    return { packets: state.packets, preSkip: preSkip };
  }

  function opusPacketSamples(packet) {
    if (!packet || !packet.length) return 960;
    var config = packet[0] >> 3;
    var frameSamples;
    if (config < 12) {
      var silkDurations = [480, 960, 1920, 2880];
      frameSamples = silkDurations[config & 3];
    } else if (config < 16) {
      frameSamples = (config & 1) ? 960 : 480;
    } else {
      var celtDurations = [120, 240, 480, 960];
      frameSamples = celtDurations[config & 3];
    }
    var code = packet[0] & 3;
    var frameCount = code === 0 ? 1 : 2;
    if (code === 3 && packet.length > 1) frameCount = packet[1] & 0x3F;
    if (frameCount < 1) frameCount = 1;
    return Math.min(5760, frameSamples * frameCount);
  }

  function writeU32LE(bytes, offset, value) {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >>> 8) & 255;
    bytes[offset + 2] = (value >>> 16) & 255;
    bytes[offset + 3] = (value >>> 24) & 255;
  }

  function writeU64LE(bytes, offset, value) {
    var low = value >>> 0;
    var high = Math.floor(value / 4294967296) >>> 0;
    writeU32LE(bytes, offset, low);
    writeU32LE(bytes, offset + 4, high);
  }

  function oggCrc(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc ^ (bytes[i] << 24)) >>> 0;
      for (var bit = 0; bit < 8; bit++) {
        crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04C11DB7) >>> 0 : (crc << 1) >>> 0;
      }
    }
    return crc >>> 0;
  }

  function makeOggPage(packets, granule, flags, serial, sequence) {
    var lacing = [];
    var bodyLength = 0;
    for (var i = 0; i < packets.length; i++) {
      var packet = packets[i];
      for (var position = 0; position < packet.length; position += 255) {
        var part = Math.min(255, packet.length - position);
        lacing.push(part);
        bodyLength += part;
      }
      if (packet.length % 255 === 0) lacing.push(0);
    }
    if (lacing.length > 255) throw new Error('Too many Opus frames on one Ogg page');

    var page = new Uint8Array(27 + lacing.length + bodyLength);
    page[0] = 79; page[1] = 103; page[2] = 103; page[3] = 83;
    page[4] = 0;
    page[5] = flags;
    writeU64LE(page, 6, granule);
    writeU32LE(page, 14, serial);
    writeU32LE(page, 18, sequence);
    page[26] = lacing.length;
    for (var s = 0; s < lacing.length; s++) page[27 + s] = lacing[s];

    var bodyOffset = 27 + lacing.length;
    var writeOffset = bodyOffset;
    for (var p = 0; p < packets.length; p++) {
      page.set(packets[p], writeOffset);
      writeOffset += packets[p].length;
    }
    writeU32LE(page, 22, oggCrc(page));
    return page;
  }

  function asciiBytes(text) {
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
    return bytes;
  }

  function buildOpusHead(preSkip) {
    var head = new Uint8Array(19);
    head.set(asciiBytes('OpusHead'), 0);
    head[8] = 1;
    head[9] = 1;
    head[10] = preSkip & 255;
    head[11] = (preSkip >> 8) & 255;
    writeU32LE(head, 12, PCM_RATE);
    head[16] = 0;
    head[17] = 0;
    head[18] = 0;
    return head;
  }

  function buildOpusTags() {
    var vendor = asciiBytes('dedoforum-draw');
    var tags = new Uint8Array(8 + 4 + vendor.length + 4);
    tags.set(asciiBytes('OpusTags'), 0);
    writeU32LE(tags, 8, vendor.length);
    tags.set(vendor, 12);
    writeU32LE(tags, 12 + vendor.length, 0);
    return tags;
  }

  function remuxWebMOpusToOgg(bytes, targetSamples) {
    var parsed = parseWebMOpus(bytes);
    var packets = parsed.packets;
    var preSkip = parsed.preSkip;
    var durations = new Array(packets.length);
    var decodedSamples = 0;
    for (var i = 0; i < packets.length; i++) {
      durations[i] = opusPacketSamples(packets[i]);
      decodedSamples += durations[i];
    }

    var finalGranule = preSkip + targetSamples;
    if (finalGranule > decodedSamples) {
      throw new Error('The Opus encoder returned an incomplete stream');
    }
    var packetLimit = 0;
    var samplesBeforeLimit = 0;
    while (packetLimit < packets.length && samplesBeforeLimit < finalGranule) {
      samplesBeforeLimit += durations[packetLimit];
      packetLimit++;
    }

    var serial = new Uint32Array(1);
    try { window.crypto.getRandomValues(serial); }
    catch (e) { serial[0] = Date.now() >>> 0; }
    var pages = [];
    var sequence = 0;
    pages.push(makeOggPage([buildOpusHead(preSkip)], 0, 2, serial[0], sequence++));
    pages.push(makeOggPage([buildOpusTags()], 0, 0, serial[0], sequence++));

    var packetIndex = 0;
    var cumulative = 0;
    while (packetIndex < packetLimit) {
      var group = [];
      var segmentCount = 0;
      var groupDuration = 0;
      while (packetIndex < packetLimit && group.length < 20) {
        var packetSegments = Math.floor(packets[packetIndex].length / 255) + 1;
        if (group.length && segmentCount + packetSegments > 240) break;
        group.push(packets[packetIndex]);
        segmentCount += packetSegments;
        groupDuration += durations[packetIndex];
        packetIndex++;
      }
      cumulative += groupDuration;
      var last = packetIndex >= packetLimit;
      var granule = last ? finalGranule : preSkip + cumulative;
      pages.push(makeOggPage(group, granule, last ? 4 : 0, serial[0], sequence++));
    }

    var totalLength = 0;
    for (var p = 0; p < pages.length; p++) totalLength += pages[p].length;
    var output = new Uint8Array(totalLength);
    var offset = 0;
    for (var q = 0; q < pages.length; q++) {
      output.set(pages[q], offset);
      offset += pages[q].length;
    }
    return new Blob([output], { type: 'audio/ogg;codecs=opus' });
  }

  function encodePcmToOgg(pcm) {
    var choice;
    try { choice = chooseOpusMime(); }
    catch (error) { return Promise.reject(error); }

    return recordPcmWithMediaRecorder(pcm, choice.mime, choice.webm).then(function (blob) {
      if (!blob || !blob.size) throw new Error('The Opus encoder returned an empty file');
      if (!choice.webm) return new Blob([blob], { type: 'audio/ogg;codecs=opus' });
      return blob.arrayBuffer().then(function (buffer) {
        return remuxWebMOpusToOgg(new Uint8Array(buffer), pcm.length);
      });
    });
  }

  function sendRec() {
    if (effectBusy || encodingBusy) return;
    if (recState === 'requesting') {
      sayR('Wait for microphone access or press STOP');
      return;
    }
    if (recState === 'rec' || recState === 'pause') stopRec();
    if (!pcmSamples || !pcmSamples.length) {
      sayR('Record audio before pressing SEND');
      setRecControls();
      return;
    }

    var token = ++sendEpoch;
    var sampleCount = pcmSamples.length;
    encodingBusy = true;
    setRecControls();
    sayR('Encoding Ogg/Opus from PCM…');

    encodePcmToOgg(pcmSamples).then(function (blob) {
      if (token !== sendEpoch || !recModal || !recModal.parentNode) return;
      encodingBusy = false;
      encodeCancel = null;
      var file = new File([blob], 'recording-' + Date.now() + '.ogg', {
        type: 'audio/ogg;codecs=opus'
      });
      if (!attachFile(file, 'прикреплено: ' + file.name + ' (' + fmtTime(sampleCount * 1000 / PCM_RATE) + ')')) {
        sayR('Браузер не дал записать файл');
        setRecControls();
        return;
      }
      pcmSamples = null;
      pcmChunks = [];
      pcmLength = 0;
      bars = [];
      barMs = BAR_MS;
      elapsed = 0;
      if (timeEl) timeEl.textContent = '00:00.0';
      drawHist();
      drawTrack();
      setRecControls();
      closeModal(recModal);
      sayR('');
    }).catch(function (error) {
      if (token !== sendEpoch) return;
      encodingBusy = false;
      encodeCancel = null;
      setRecControls();
      sayR('Encoding failed: ' + (error && error.message ? error.message : error));
    });
  }

  function closeRec() {
    captureEpoch++;
    effectEpoch++;
    sendEpoch++;
    if (encodeCancel) {
      var cancel = encodeCancel;
      encodeCancel = null;
      cancel();
    }
    cancelAnimationFrame(raf);
    raf = 0;
    recState = 'idle';
    stopAudioInput();
    pcmChunks = [];
    pcmLength = 0;
    pcmSamples = null;
    effectBusy = false;
    encodingBusy = false;
    setRecControls();
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

      var trackLabel = el('div', 'margin:4px 0;color:#333;font:11px Arial,sans-serif;');
      trackLabel.textContent = 'Audio track · PCM 48 kHz / 16-bit / mono';
      body.appendChild(trackLabel);

      trackCanvas = el('canvas', 'background:#fff;border:1px solid #333;display:block;');
      trackCanvas.width = HIST_W;
      trackCanvas.height = TRACK_H;
      trackCanvas.style.width = HIST_W + 'px';
      trackCanvas.style.height = TRACK_H + 'px';
      trackCtx = trackCanvas.getContext('2d');
      body.appendChild(trackCanvas);
      drawTrack();

      var effects = el('div', 'margin:5px 0 9px;display:flex;align-items:center;gap:6px;');
      recButtons.reverb = button(effects, 'REVERB', '', reverbRec);
      recButtons.normalize = button(effects, 'NORMALIZE', '', normalizeRec);
      body.appendChild(effects);

      var bottom = el('div', 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;');
      recButtons.rec = button(bottom, 'REC', '', startRec);
      recButtons.pause = button(bottom, 'PAUSE', '', pauseRec);
      recButtons.stop = button(bottom, 'STOP', '', stopRec);
      recButtons.send = button(bottom, 'SEND', 'font-weight:bold;', sendRec);
      recStatus = el('span', 'margin-left:6px;color:#333;');
      recStatus.id = 'nosql_rec_status';
      bottom.appendChild(recStatus);
      body.appendChild(bottom);
      setRecControls();
    }, closeRec);
  }

  /* Reply form controls */

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

    // Place the controls below the attachment input.
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

    // Escape closes the active modal.
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
