(function injectTopNav() {
  const mountPoint = document.getElementById("topNavMount");
  if (!mountPoint) return;

  const storageKey = "lsa-dashboard-theme";
  const themeOptions = {
    light: "☀️ Light",
    dark: "🌙 Dark"
  };

  function getTheme() {
    try {
      const savedTheme = localStorage.getItem(storageKey);
      if (savedTheme === "dark" || savedTheme === "light") {
        return savedTheme;
      }
    } catch (error) {
      // no-op, fallback to light
    }
    return "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(storageKey, theme);
    } catch (error) {
      // no-op when storage is unavailable
    }

    const themeToggle = document.getElementById("themeToggleBtn");
    if (themeToggle) {
      themeToggle.textContent = themeOptions[theme] || themeOptions.light;
      themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
    }
  }

  let pageKey = document.body.getAttribute("data-page") || "";
  if (window.location.pathname === "/inbox" && new URLSearchParams(window.location.search).get("view") === "archived") {
    pageKey = "archived";
  }

  const navItems = [
    { key: "inbox", label: "Inbox", href: "/inbox" },
    { key: "kb", label: "Knowledge Base", href: "/kb" },
    { key: "capture", label: "Capture Assistant", href: "/kb-capture" },
    { key: "providers", label: "Providers", href: "/providers" },
    { key: "archived", label: "Archived Threads", href: "/archived" },
    { key: "quick-capture", label: "Quick Capture", href: "#", placeholder: true },
    { key: "settings", label: "Settings", href: "#", placeholder: true },
    { key: "ai-tools", label: "AI Tools", href: "#", placeholder: true },
    { key: "reports", label: "Reports", href: "#", placeholder: true },
    { key: "logout", label: "Logout", href: "/logout", logout: true }
  ];

  const linksHtml = navItems
    .map((item) => {
      const classNames = ["lsa-top-nav__link"];
      if (item.key === pageKey) classNames.push("is-active");
      if (item.logout) classNames.push("lsa-top-nav__link--logout");
      if (item.placeholder) classNames.push("lsa-top-nav__link--placeholder");
      const extra = item.placeholder ? ' aria-disabled="true" onclick="return false;"' : "";
      return `<a class="${classNames.join(" ")}" href="${item.href}"${extra}>${item.label}</a>`;
    })
    .join("");

  mountPoint.innerHTML = `
    <header class="lsa-top-nav">
      <div class="lsa-top-nav__inner">
        <div class="lsa-top-nav__brand">LSA GLOBAL Internal</div>
        <div class="lsa-top-nav__right">
          <div class="lsa-mode-control" aria-live="polite">
            <span id="modeStatusBadge" class="lsa-mode-badge lsa-mode-badge--loading">MODE: ...</span>
            <button id="modeToggleBtn" class="lsa-mode-toggle" type="button" disabled>Loading mode...</button>
          </div>
          <nav class="lsa-top-nav__links" aria-label="Primary">
            ${linksHtml}
          </nav>
          <button id="themeToggleBtn" class="lsa-theme-toggle" type="button">☀️ Light</button>
        </div>
      </div>
    </header>
  `;

  const themeToggle = document.getElementById("themeToggleBtn");
  const modeStatusBadge = document.getElementById("modeStatusBadge");
  const modeToggleBtn = document.getElementById("modeToggleBtn");
  let currentMode = null;
  let canChangeMode = false;

  function renderMode() {
    if (!modeStatusBadge || !modeToggleBtn) return;
    const isTest = currentMode === "test";
    modeStatusBadge.textContent = isTest ? "TEST MODE" : "LIVE MODE";
    modeStatusBadge.classList.remove("lsa-mode-badge--loading", "lsa-mode-badge--live", "lsa-mode-badge--test");
    modeStatusBadge.classList.add(isTest ? "lsa-mode-badge--test" : "lsa-mode-badge--live");

    if (!canChangeMode) {
      modeToggleBtn.textContent = "Mode locked";
      modeToggleBtn.disabled = true;
      modeToggleBtn.setAttribute("aria-disabled", "true");
      modeToggleBtn.title = "Only trusted/admin internal users can change mode";
      return;
    }

    modeToggleBtn.disabled = false;
    modeToggleBtn.setAttribute("aria-disabled", "false");
    modeToggleBtn.textContent = isTest ? "Switch to Live Mode" : "Switch to Test Mode";
    modeToggleBtn.title = isTest
      ? "Live Mode disables autonomous AI replies for customer-facing safety"
      : "Test Mode enables controlled internal AI experimentation";
  }

  async function loadMode() {
    if (!modeStatusBadge || !modeToggleBtn) return;
    try {
      const response = await fetch("/api/system/mode", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Failed to load mode");
      const payload = await response.json();
      currentMode = payload.mode === "test" ? "test" : "live";
      canChangeMode = Boolean(payload.can_change);
      renderMode();
    } catch (error) {
      modeStatusBadge.textContent = "MODE UNAVAILABLE";
      modeStatusBadge.classList.remove("lsa-mode-badge--loading");
      modeStatusBadge.classList.add("lsa-mode-badge--live");
      modeToggleBtn.textContent = "Unavailable";
      modeToggleBtn.disabled = true;
      modeToggleBtn.setAttribute("aria-disabled", "true");
    }
  }

  async function toggleMode() {
    if (!canChangeMode || !currentMode) return;
    const nextMode = currentMode === "test" ? "live" : "test";
    modeToggleBtn.disabled = true;
    modeToggleBtn.textContent = "Saving...";
    try {
      const response = await fetch("/api/system/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mode: nextMode })
      });
      if (!response.ok) throw new Error("Failed to update mode");
      const payload = await response.json();
      currentMode = payload.mode === "test" ? "test" : "live";
      canChangeMode = Boolean(payload.can_change);
      renderMode();
    } catch (error) {
      modeToggleBtn.disabled = false;
      modeToggleBtn.textContent = "Try again";
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const nextTheme = getTheme() === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
    });
  }
  if (modeToggleBtn) {
    modeToggleBtn.addEventListener("click", toggleMode);
  }

  applyTheme(getTheme());
  loadMode();
})();
