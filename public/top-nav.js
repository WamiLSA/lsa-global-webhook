(function injectTopNav() {
  const mountPoint = document.getElementById("topNavMount");
  if (!mountPoint) return;

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
        <nav class="lsa-top-nav__links" aria-label="Primary">
          ${linksHtml}
        </nav>
      </div>
    </header>
  `;
})();
