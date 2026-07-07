/**
 * 商品圖片批次轉檔工具 — 全程在瀏覽器本機處理，不上傳任何檔案。
 *
 * 流程：讀檔 → 等比縮放（分段縮小保畫質）→ 補底色(可選) → 迭代降品質壓到大小上限 → 單張/整批 ZIP 下載
 */
(function () {
  "use strict";

  var els = {
    sizePreset: document.getElementById("sizePreset"),
    customSizeWrap: document.getElementById("customSizeWrap"),
    customW: document.getElementById("customW"),
    customH: document.getElementById("customH"),
    fitMode: document.getElementById("fitMode"),
    bgWrap: document.getElementById("bgWrap"),
    bgColor: document.getElementById("bgColor"),
    maxKB: document.getElementById("maxKB"),
    format: document.getElementById("format"),
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    resultPanel: document.getElementById("resultPanel"),
    fileList: document.getElementById("fileList"),
    downloadAll: document.getElementById("downloadAll"),
    clearAll: document.getElementById("clearAll"),
    summary: document.getElementById("summary"),
  };

  var results = []; // { name, blob, ok, error }
  var processing = 0;

  // ---------- 設定 ----------
  function currentSettings() {
    var w, h;
    if (els.sizePreset.value === "custom") {
      w = clampInt(els.customW.value, 50, 8000, 1000);
      h = clampInt(els.customH.value, 50, 8000, 1000);
    } else {
      w = h = parseInt(els.sizePreset.value, 10);
    }
    return {
      width: w,
      height: h,
      fitMode: els.fitMode.value,          // 'pad' | 'fit'
      bgColor: els.bgColor.value,
      maxBytes: parseInt(els.maxKB.value, 10) * 1024, // 0 = 不限制
      format: els.format.value,
    };
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  els.sizePreset.addEventListener("change", function () {
    els.customSizeWrap.classList.toggle("hidden", els.sizePreset.value !== "custom");
  });
  els.fitMode.addEventListener("change", function () {
    els.bgWrap.classList.toggle("hidden", els.fitMode.value !== "pad");
  });

  // ---------- 選檔 / 拖放 ----------
  els.dropzone.addEventListener("click", function () { els.fileInput.click(); });
  els.dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") els.fileInput.click();
  });
  els.fileInput.addEventListener("change", function () {
    handleFiles(els.fileInput.files);
    els.fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    els.dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  });
  els.dropzone.addEventListener("drop", function (e) {
    handleFiles(e.dataTransfer.files);
  });

  // ---------- 主流程 ----------
  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name);
    });
    if (!files.length) return;

    var settings = currentSettings();
    els.resultPanel.classList.remove("hidden");

    files.forEach(function (file) {
      var li = addListItem(file.name);
      processing++;
      updateSummary();
      processOne(file, settings)
        .then(function (out) {
          results.push({ name: out.name, blob: out.blob, ok: true });
          finishItem(li, file, out, null);
        })
        .catch(function (err) {
          results.push({ name: file.name, blob: null, ok: false });
          finishItem(li, file, null, err);
        })
        .then(function () {
          processing--;
          updateSummary();
        });
    });
  }

  function processOne(file, s) {
    return loadBitmap(file).then(function (bmp) {
      var canvas = renderToCanvas(bmp, s);
      if (bmp.close) bmp.close();
      return compressToLimit(canvas, s).then(function (blob) {
        if (!blob) throw new Error("轉檔失敗（瀏覽器不支援此輸出格式）");
        return { name: outputName(file.name, s), blob: blob };
      });
    });
  }

  /** 讀圖：優先 createImageBitmap（自動處理 EXIF 方向），失敗退回 <img>。 */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
        return loadViaImg(file);
      });
    }
    return loadViaImg(file);
  }

  function loadViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("無法讀取（格式可能不被此瀏覽器支援）"));
      };
      img.src = url;
    });
  }

  /** 等比縮放到目標框內；pad 模式輸出固定尺寸並補底色。大幅縮小時分段減半保畫質。 */
  function renderToCanvas(src, s) {
    var sw = src.width, sh = src.height;
    var scale = Math.min(s.width / sw, s.height / sh, 1); // 只縮小不放大
    var dw = Math.max(1, Math.round(sw * scale));
    var dh = Math.max(1, Math.round(sh * scale));

    // 分段減半縮小（一次縮太多會糊）
    var cur = src, cw = sw, ch = sh;
    while (cw / 2 > dw && ch / 2 > dh) {
      cw = Math.round(cw / 2);
      ch = Math.round(ch / 2);
      var step = makeCanvas(cw, ch);
      var sctx = step.getContext("2d");
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(cur, 0, 0, cw, ch);
      cur = step;
    }

    var outW = s.fitMode === "pad" ? s.width : dw;
    var outH = s.fitMode === "pad" ? s.height : dh;
    var canvas = makeCanvas(outW, outH);
    var ctx = canvas.getContext("2d");
    if (s.fitMode === "pad" || s.format === "image/jpeg") {
      // JPG 沒有透明，PNG/WebP 的 fit 模式維持透明背景
      ctx.fillStyle = s.bgColor;
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, Math.round((outW - dw) / 2), Math.round((outH - dh) / 2), dw, dh);
    return canvas;
  }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /** 迭代降品質，把檔案壓到 maxBytes 以下（PNG 無品質參數，超標時直接回報）。 */
  function compressToLimit(canvas, s) {
    if (s.format === "image/png" || s.maxBytes === 0) {
      return toBlob(canvas, s.format, 0.92).then(function (blob) {
        if (blob && s.maxBytes && blob.size > s.maxBytes) {
          throw new Error("PNG 壓不到大小上限（" + fmtSize(blob.size) + "），請改用 JPG");
        }
        return blob;
      });
    }
    var qualities = [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.4];
    var i = 0;
    function tryNext(lastBlob) {
      if (i >= qualities.length) {
        if (lastBlob) throw new Error("已壓到最低品質仍超過上限（" + fmtSize(lastBlob.size) + "），請調低目標尺寸");
        throw new Error("轉檔失敗");
      }
      var q = qualities[i++];
      return toBlob(canvas, s.format, q).then(function (blob) {
        if (!blob) throw new Error("瀏覽器不支援此輸出格式");
        if (blob.size <= s.maxBytes) return blob;
        return tryNext(blob);
      });
    }
    return tryNext(null);
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type, quality);
    });
  }

  function outputName(original, s) {
    var base = original.replace(/\.[^.]+$/, "");
    var ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[s.format] || "jpg";
    var dim = s.fitMode === "pad" ? s.width + "x" + s.height : "resized";
    return base + "_" + dim + "." + ext;
  }

  // ---------- 畫面 ----------
  function addListItem(name) {
    var li = document.createElement("li");
    li.innerHTML =
      '<img class="thumb" alt="">' +
      '<div class="fileinfo"><div class="name"></div><div class="meta">處理中…</div></div>' +
      '<span class="dl"></span>';
    li.querySelector(".name").textContent = name;
    els.fileList.appendChild(li);
    return li;
  }

  function finishItem(li, file, out, err) {
    var meta = li.querySelector(".meta");
    if (err) {
      meta.innerHTML = '<span class="err"></span>';
      meta.firstChild.textContent = "❌ " + (err.message || "處理失敗");
      return;
    }
    var url = URL.createObjectURL(out.blob);
    li.querySelector(".thumb").src = url;
    meta.innerHTML = '<span class="ok"></span>';
    meta.firstChild.textContent =
      "✅ " + fmtSize(file.size) + " → " + fmtSize(out.blob.size);
    var a = document.createElement("a");
    a.href = url;
    a.download = out.name;
    a.textContent = "下載";
    a.className = "dl-link";
    li.querySelector(".dl").appendChild(a);
  }

  function updateSummary() {
    var ok = results.filter(function (r) { return r.ok; }).length;
    var fail = results.length - ok;
    els.summary.textContent =
      (processing > 0 ? "處理中 " + processing + " 張… " : "") +
      "完成 " + ok + " 張" + (fail ? "，失敗 " + fail + " 張" : "");
    els.downloadAll.disabled = processing > 0 || ok === 0;
  }

  // ---------- 批次下載 ----------
  els.downloadAll.addEventListener("click", function () {
    var zip = new JSZip();
    var used = {};
    results.forEach(function (r) {
      if (!r.ok) return;
      var name = r.name;
      var n = 1;
      while (used[name]) { // 同名檔加流水號
        name = r.name.replace(/(\.[^.]+)$/, "_" + (++n) + "$1");
      }
      used[name] = true;
      zip.file(name, r.blob);
    });
    els.downloadAll.disabled = true;
    els.downloadAll.textContent = "打包中…";
    zip.generateAsync({ type: "blob" }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "商品圖_" + new Date().toISOString().slice(0, 10) + ".zip";
      a.click();
      els.downloadAll.disabled = false;
      els.downloadAll.textContent = "⬇️ 全部下載（ZIP）";
    });
  });

  els.clearAll.addEventListener("click", function () {
    results = [];
    els.fileList.innerHTML = "";
    els.resultPanel.classList.add("hidden");
    updateSummary();
  });
})();
