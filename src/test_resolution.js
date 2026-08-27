// test_resolution.js
//
// Outil de test TEMPORAIRE pour valider get_game_info/get_game_resolution
// sur toutes les résolutions du jeu avant de rebrancher spin_overlay/
// ruler_overlay dessus. À retirer une fois la détection validée.
//
// Ajoute test_resolution_panel.html dans index.html, et charge ce fichier
// après TauriService (même pattern que les autres modules de l'app).

(function () {
  "use strict";

  let history = []; // { n, expected, detected, process, title, match }

  function normalizeResolution(str) {
    // Accepte "1280x720", "1280 x 720", "1280*720", espaces en trop...
    if (!str) return null;
    const match = str.trim().match(/(\d+)\s*[x*]\s*(\d+)/i);
    if (!match) return null;
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  }

  function renderCurrentResult(content, isError) {
    const el = document.getElementById("testCurrentResult");
    if (!el) return;
    el.innerHTML = content;
    el.classList.toggle("test-error", !!isError);
  }

  function renderHistory() {
    const tbody = document.getElementById("testHistoryBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    history.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.n}</td>
        <td>${row.expected || "—"}</td>
        <td>${row.detected}</td>
        <td>${row.process}</td>
        <td>${row.title}</td>
        <td class="${row.match === null ? "" : row.match ? "test-match-ok" : "test-match-bad"}">
          ${row.match === null ? "?" : row.match ? "✅" : "❌"}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function onTestDetect() {
    const tauri = window.TauriService;
    if (!tauri?.isAvailable) {
      renderCurrentResult("⚠️ TauriService indisponible.", true);
      return;
    }

    const expectedInput = document.getElementById("test-expected-resolution");
    const expectedStr = expectedInput ? expectedInput.value.trim() : "";
    const expected = normalizeResolution(expectedStr);

    try {
      const info = await tauri.invoke("get_game_info");
      // info attendu : { hwnd, pid, process_name, window_title, width, height }

      const detectedStr = `${info.width}x${info.height}`;
      const match = expected
        ? expected.width === info.width && expected.height === info.height
        : null;

      renderCurrentResult(`
        <strong>✅ Fenêtre détectée</strong><br>
        Process : <code>${info.process_name}</code><br>
        Titre : <code>${info.window_title}</code><br>
        PID : ${info.pid} — HWND : ${info.hwnd}<br>
        Résolution détectée : <strong>${detectedStr}</strong>
        ${expected ? (match ? " ✅ correspond à l'attendu" : " ❌ NE correspond PAS à l'attendu") : ""}
      `);

      history.push({
        n: history.length + 1,
        expected: expectedStr || null,
        detected: detectedStr,
        process: info.process_name,
        title: info.window_title,
        match,
      });
      renderHistory();
    } catch (err) {
      renderCurrentResult(`❌ Erreur : ${err}`, true);
      history.push({
        n: history.length + 1,
        expected: expectedStr || null,
        detected: "ERREUR",
        process: "—",
        title: String(err),
        match: false,
      });
      renderHistory();
    }
  }

  async function onListWindows() {
    const tauri = window.TauriService;
    if (!tauri?.isAvailable) return;

    const el = document.getElementById("testListWindowsResult");
    if (!el) return;

    try {
      const result = await tauri.invoke("list_all_visible_windows");
      // result attendu : { total, windows: [{index, hwnd, pid, process_name, window_title}, ...] }

      const rows = result.windows
        .map(
          (w) =>
            `<tr><td>${w.index}</td><td><code>${w.process_name}</code></td><td>${w.window_title}</td></tr>`,
        )
        .join("");

      el.innerHTML = `
        <p>${result.total} fenêtre(s) visible(s) :</p>
        <table class="test-history-table">
          <thead><tr><th>#</th><th>Process</th><th>Titre</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      el.innerHTML = `❌ Erreur : ${err}`;
    }
  }

  function onExport() {
    const json = JSON.stringify(history, null, 2);
    navigator.clipboard
      ?.writeText(json)
      .then(() => {
        renderCurrentResult(
          `📋 Historique copié dans le presse-papier (${history.length} tests).`,
        );
      })
      .catch(() => {
        // Fallback si l'API clipboard n'est pas dispo dans ce contexte
        console.log("Historique des tests :", json);
        renderCurrentResult(
          "📋 Copie automatique indisponible — vois la console pour le JSON.",
        );
      });
  }

  function onClear() {
    history = [];
    renderHistory();
    renderCurrentResult("<em>Historique vidé.</em>");
  }

  document.addEventListener("DOMContentLoaded", () => {
    document
      .getElementById("btn-test-detect")
      ?.addEventListener("click", onTestDetect);
    document
      .getElementById("btn-test-list-windows")
      ?.addEventListener("click", onListWindows);
    document
      .getElementById("btn-test-export")
      ?.addEventListener("click", onExport);
    document
      .getElementById("btn-test-clear")
      ?.addEventListener("click", onClear);
  });
})();
