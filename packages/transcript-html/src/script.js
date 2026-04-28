(() => {
  // --- Prompt navigation ---
  const prompts = Array.from(
    document.querySelectorAll('section.event--user[data-role="user"]'),
  );
  const total = prompts.length;
  const posEl = document.querySelector("[data-nav-pos]");
  const totalEl = document.querySelector("[data-nav-total]");
  if (totalEl) totalEl.textContent = String(total);
  let cur = -1;

  function highlight(idx) {
    prompts.forEach((p, i) => {
      p.classList.toggle("is-current", i === idx);
    });
    if (posEl)
      posEl.textContent = idx >= 0 ? String(idx + 1).padStart(2, "0") : "–";
  }

  function jumpTo(idx) {
    if (total === 0) return;
    const next = ((idx % total) + total) % total;
    cur = next;
    prompts[next].scrollIntoView({ behavior: "smooth", block: "start" });
    highlight(next);
  }

  document
    .querySelector('[data-nav="prev"]')
    ?.addEventListener("click", () => jumpTo(cur - 1));
  document
    .querySelector('[data-nav="next"]')
    ?.addEventListener("click", () => jumpTo(cur + 1));

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable)
        return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      jumpTo(cur + 1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      jumpTo(cur - 1);
    }
  });

  highlight(-1);

  // --- Hide tool calls toggle (default: hidden) ---
  const toolBtn = document.querySelector('[data-toggle="tools"]');
  function applyTools(hide) {
    document.body.dataset.hideTools = String(hide);
    if (toolBtn) {
      toolBtn.setAttribute("aria-pressed", String(hide));
      const stateEl = toolBtn.querySelector("[data-state]");
      if (stateEl) stateEl.textContent = hide ? "hidden" : "shown";
    }
  }
  const storedHideTools = localStorage.getItem("kolu-export-hide-tools");
  applyTools(storedHideTools !== "0");
  toolBtn?.addEventListener("click", () => {
    const nextHide = document.body.dataset.hideTools !== "true";
    localStorage.setItem("kolu-export-hide-tools", nextHide ? "1" : "0");
    applyTools(nextHide);
  });

  // --- Hide reasoning toggle (default: hidden) ---
  const reasoningBtn = document.querySelector('[data-toggle="reasoning"]');
  function applyReasoning(hide) {
    document.body.dataset.hideReasoning = String(hide);
    if (reasoningBtn) {
      reasoningBtn.setAttribute("aria-pressed", String(hide));
      const stateEl = reasoningBtn.querySelector("[data-state]");
      if (stateEl) stateEl.textContent = hide ? "hidden" : "shown";
    }
  }
  const storedHideReasoning = localStorage.getItem(
    "kolu-export-hide-reasoning",
  );
  applyReasoning(storedHideReasoning !== "0");
  reasoningBtn?.addEventListener("click", () => {
    const nextHide = document.body.dataset.hideReasoning !== "true";
    localStorage.setItem("kolu-export-hide-reasoning", nextHide ? "1" : "0");
    applyReasoning(nextHide);
  });

  // --- Hide edit calls toggle (default: shown) ---
  const editBtn = document.querySelector('[data-toggle="edits"]');
  function applyEdits(hide) {
    document.body.dataset.hideEdits = String(hide);
    if (editBtn) {
      editBtn.setAttribute("aria-pressed", String(hide));
      const stateEl = editBtn.querySelector("[data-state]");
      if (stateEl) stateEl.textContent = hide ? "hidden" : "shown";
    }
  }
  const storedHideEdits = localStorage.getItem("kolu-export-hide-edits");
  applyEdits(storedHideEdits === "1");
  editBtn?.addEventListener("click", () => {
    const nextHide = document.body.dataset.hideEdits !== "true";
    localStorage.setItem("kolu-export-hide-edits", nextHide ? "1" : "0");
    applyEdits(nextHide);
  });

  // --- Subtask collapse (click the start divider to fold the child events) ---
  function toggleSubtask(start) {
    const collapsed = start.dataset.collapsed === "true";
    const nextCollapsed = !collapsed;
    start.dataset.collapsed = String(nextCollapsed);
    start.setAttribute("aria-expanded", String(!nextCollapsed));
    // Walk forward siblings until the matching end divider, respecting
    // nested subtasks by depth counting.
    let depth = 0;
    let node = start.nextElementSibling;
    while (node) {
      const isStart = node.classList?.contains("subtask-boundary--start");
      const isEnd = node.classList?.contains("subtask-boundary--end");
      if (isStart) depth++;
      if (isEnd) {
        if (depth === 0) {
          node.classList.toggle("is-subtask-hidden", nextCollapsed);
          break;
        }
        depth--;
      }
      node.classList.toggle("is-subtask-hidden", nextCollapsed);
      node = node.nextElementSibling;
    }
  }
  document.querySelectorAll(".subtask-boundary--start").forEach((el) => {
    el.addEventListener("click", () => toggleSubtask(el));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSubtask(el);
      }
    });
  });

  // --- Long-prose expand toggle ---
  document.querySelectorAll(".collapse-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".msg-collapsible");
      if (!wrap) return;
      const lineCount = wrap.dataset.lineCount;
      const collapsed = wrap.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
      const label = btn.querySelector("[data-toggle-label]");
      if (label)
        label.textContent = collapsed
          ? `Show all ${lineCount} lines`
          : "Collapse";
    });
  });

  // --- Theme cycle (auto → light → dark → auto) ---
  const themeBtn = document.querySelector('[data-toggle="theme"]');
  function applyTheme(theme) {
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    if (themeBtn) {
      const stateEl = themeBtn.querySelector("[data-state]");
      if (stateEl) stateEl.textContent = theme;
    }
  }
  let theme = localStorage.getItem("kolu-export-theme") || "auto";
  if (theme !== "light" && theme !== "dark") theme = "auto";
  applyTheme(theme);
  themeBtn?.addEventListener("click", () => {
    theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    localStorage.setItem("kolu-export-theme", theme);
    applyTheme(theme);
  });
})();
