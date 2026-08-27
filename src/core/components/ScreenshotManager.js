// core/components/ScreenshotManager.js
(function () {
  "use strict";

  window.ScreenshotManager = function (tauri, storage) {
    // Fallback si storage n'est pas passé (ex: appel depuis une fenêtre
    // où StorageService n'est pas chargé) — évite un crash, sans persistance.
    const store = storage ||
      window.StorageService || {
        get: (key, defaultValue) => defaultValue,
        set: () => {},
      };

    let selectedFolderPath = "";

    const btnSelectFolder = document.getElementById("btn-select-folder");
    const inputFolderPath = document.getElementById("folder-path");
    const btnRefreshWind = document.getElementById("btn-refresh-img");
    const btnClearFolder = document.getElementById("btn-clear-folder");
    const confirmModal = document.getElementById("custom-confirm-modal");
    const modalConfirmBtn = document.getElementById("modal-confirm-btn");
    const modalCancelBtn = document.getElementById("modal-cancel-btn");
    const windImage = document.getElementById("wind-image");
    const msgAttente = document.getElementById("msg-attente");

    // ================================================================
    // CHARGER LA DERNIÈRE IMAGE
    // ================================================================

    async function chargerDerniereImage() {
      if (!selectedFolderPath || !tauri.isAvailable) return;
      try {
        const base64Image = await tauri.invoke("get_latest_image", {
          folderPath: selectedFolderPath,
        });
        if (windImage) {
          windImage.src = base64Image;
          windImage.style.display = "block";
          if (msgAttente) msgAttente.style.display = "none";
        }
      } catch (error) {
        console.error("❌ Erreur récupération image:", error);
      }
    }

    // ================================================================
    // ÉCOUTER LES NOUVELLES CAPTURES
    // ================================================================

    tauri.listen("nouvelle-capture-detectee", chargerDerniereImage);

    // ================================================================
    // SÉLECTIONNER LE DOSSIER
    // ================================================================

    if (btnSelectFolder && tauri.isAvailable) {
      btnSelectFolder.addEventListener("click", async () => {
        try {
          const selected = await tauri.invoke("select_folder");
          if (!selected) return;
          selectedFolderPath = selected;
          if (inputFolderPath) inputFolderPath.value = selected;
          store.set("screenshot_folder", selected);
          await chargerDerniereImage();
        } catch (err) {
          console.error("❌ Erreur select_folder:", err);
        }
      });
    }

    // ================================================================
    // RAFRAÎCHIR L'IMAGE
    // ================================================================

    if (btnRefreshWind) {
      btnRefreshWind.addEventListener("click", chargerDerniereImage);
    }

    // ================================================================
    // RESTAURER LE DOSSIER SAUVEGARDÉ
    // ================================================================

    const savedFolder = store.get("screenshot_folder", null);
    if (savedFolder) {
      selectedFolderPath = savedFolder;
      if (inputFolderPath) inputFolderPath.value = savedFolder;
      setTimeout(chargerDerniereImage, 100);
    }

    // ================================================================
    // VIDER LE DOSSIER
    // ================================================================

    if (btnClearFolder && confirmModal && tauri.isAvailable) {
      btnClearFolder.addEventListener("click", () => {
        if (!selectedFolderPath) {
          alert("Aucun dossier sélectionné.");
          return;
        }
        confirmModal.style.display = "flex";
      });

      if (modalCancelBtn) {
        modalCancelBtn.addEventListener("click", () => {
          confirmModal.style.display = "none";
        });
      }

      if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener("click", async () => {
          confirmModal.style.display = "none";
          try {
            await tauri.invoke("clear_screenshot_folder", {
              folderPath: selectedFolderPath,
            });
            if (windImage) {
              windImage.src = "";
              windImage.style.display = "none";
            }
            if (msgAttente) msgAttente.style.display = "block";
          } catch (err) {
            console.error("❌ Erreur nettoyage dossier:", err);
          }
        });
      }
    }

    // ================================================================
    // CROP DE L'IMAGE
    // ================================================================

    let windImgOffsetX = Number(store.get("imgOffsetX", 0));
    let windImgOffsetY = Number(store.get("imgOffsetY", 0));

    function updateWindImagePosition() {
      if (windImage) {
        windImage.style.transform = `translate(${windImgOffsetX}px, ${windImgOffsetY}px)`;
      }
      store.set("imgOffsetX", windImgOffsetX);
      store.set("imgOffsetY", windImgOffsetY);
    }

    document.getElementById("btn-crop-up")?.addEventListener("click", () => {
      windImgOffsetY -= 1;
      updateWindImagePosition();
    });

    document.getElementById("btn-crop-down")?.addEventListener("click", () => {
      windImgOffsetY += 1;
      updateWindImagePosition();
    });

    document.getElementById("btn-crop-left")?.addEventListener("click", () => {
      windImgOffsetX -= 1;
      updateWindImagePosition();
    });

    document.getElementById("btn-crop-right")?.addEventListener("click", () => {
      windImgOffsetX += 1;
      updateWindImagePosition();
    });

    // Appliquer la position initiale
    updateWindImagePosition();

    // ================================================================
    // RETOURNER L'INSTANCE
    // ================================================================

    return {
      chargerDerniereImage,
      updateWindImagePosition,
      selectedFolderPath,
    };
  };
})();
