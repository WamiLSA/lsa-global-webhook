(function initTheme() {
  const storageKey = "lsa-dashboard-theme";
  let savedTheme = "light";

  try {
    savedTheme = localStorage.getItem(storageKey) || "light";
  } catch (error) {
    savedTheme = "light";
  }

  if (savedTheme !== "dark" && savedTheme !== "light") {
    savedTheme = "light";
  }

  document.documentElement.setAttribute("data-theme", savedTheme);
})();
