/**
 * OrderPally 專用圖片轉換器 — 全程在瀏覽器本機處理，不上傳任何檔案。
 *
 * 規則（OrderPally 官方規格：檔案 ≤ 2MB、尺寸不限）：
 *   - 照片 ≤ 2MB → 原檔保留，不做任何更動
 *   - 照片 >  2MB → 維持原尺寸、逐級降品質壓成 JPG；
 *                    壓到最低品質仍超標時，每輪縮小 20% 尺寸再壓（等比，不變形）
 *   - 全部處理完可單張下載或打包 ZIP
 */
(function () {
  "use strict";

  var MAX_BYTES = 2 * 1024 * 1024; // OrderPally 規格：2MB

  var els = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    resultPanel: document.getElementById("resultPanel"),
    fileList: document.getElementById("fileList"),
    downloadAll: document.getElementById("downloadAll"),
    clearAll: document.getElementById("clearAll"),
    summary: document.getElementById("summary"),
  };

  var results = []; // { name, blob, ok }
  var processing = 0;

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
      return /^image\//.test(f.type);
    });
    if (!files.length) return;

    els.resultPanel.classList.remove("hidden");

    files.forEach(function (file) {
      var li = addListItem(file.name);

      // 沒超過 2MB：原檔直接保留
      if (file.size <= MAX_BYTES) {
        results.push({ name: file.name, blob: file, ok: true });
        finishItem(li, file, { name: file.name, blob: file, passed: true }, null);
        updateSummary();
        return;
      }

      // 超過 2MB：壓縮
      processing++;
      updateSummary();
      compressFile(file)
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
    updateSummary();
  }

  function compressFile(file) {
    return loadBitmap(file).then(function (bmp) {
      var canvas = makeCanvas(bmp.width, bmp.height);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; // JPG 沒有透明，透明區補白
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return compressToLimit(canvas).then(function (blob) {
        var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
        return { name: name, blob: blob, passed: false };
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

  /** 品質 0.92 → 0.4 逐級壓；仍超標則每輪縮小 20% 尺寸再壓（等比不變形）。 */
  function compressToLimit(canvas) {
    var qualities = [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.4];

    function tryQualities(cnv) {
      var i = 0;
      function next(lastBlob) {
        if (i >= qualities.length) return Promise.resolve({ blob: lastBlob, over: true });
        var q = qualities[i++];
        return toBlob(cnv, "image/jpeg", q).then(function (blob) {
          if (!blob) throw new Error("轉檔失敗（瀏覽器不支援）");
          if (blob.size <= MAX_BYTES) return { blob: blob, over: false };
          return next(blob);
        });
      }
      return next(null);
    }

    function attempt(cnv, depth) {
      return tryQualities(cnv).then(function (r) {
        if (!r.over) return r.blob;
        if (depth >= 8 || Math.min(cnv.width, cnv.height) <= 300) {
          throw new Error("已壓到極限仍超過 2MB（" + fmtSize(r.blob.size) + "）");
        }
        var w = Math.round(cnv.width * 0.8);
        var h = Math.round(cnv.height * 0.8);
        var smaller = makeCanvas(w, h);
        var ctx = smaller.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(cnv, 0, 0, w, h);
        return attempt(smaller, depth + 1);
      });
    }
    return attempt(canvas, 0);
  }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type, quality);
    });
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
    meta.firstChild.textContent = out.passed
      ? "✅ " + fmtSize(file.size) + "，未超過 2MB，原檔保留"
      : "✅ 已壓縮 " + fmtSize(file.size) + " → " + fmtSize(out.blob.size);
    var a = document.createElement("a");
    a.href = url;
    a.download = out.name;
    a.textContent = "下載";
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

  function fmtSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return Math.round(bytes / 1024) + " KB";
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
