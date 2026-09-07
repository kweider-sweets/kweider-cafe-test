      (() => {
        if ("serviceWorker" in navigator) {
          window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => {}));
        }
        let installPrompt = null;
        const installButton = () => document.getElementById("installStaffApp");
        const help = () => document.getElementById("installStaffHelp");
        window.addEventListener("beforeinstallprompt", (event) => {
          event.preventDefault();
          installPrompt = event;
          const button = installButton();
          if (button) button.classList.remove("hidden");
        });
        window.addEventListener("appinstalled", () => {
          installPrompt = null;
          if (help()) help().textContent = "Installed successfully · تم تثبيت التطبيق";
        });
        document.addEventListener("click", async (event) => {
          if (event.target?.id !== "installStaffApp") return;
          if (installPrompt) {
            installPrompt.prompt();
            await installPrompt.userChoice;
            installPrompt = null;
            return;
          }
          const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
          if (help()) help().textContent = ios
            ? "On iPhone: Share → Add to Home Screen · على الآيفون: مشاركة ← إضافة إلى الشاشة الرئيسية"
            : "Use the browser menu and choose Install app / Add to Home screen.";
        });
      })();
    
