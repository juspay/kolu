(() => {
  const prompts = Array.from(document.querySelectorAll("[data-human-message]"));
  const nav = document.querySelector("[data-prompt-nav]");
  if (!nav || prompts.length < 2) return;

  const previous = nav.querySelector('[data-prompt-nav-action="prev"]');
  const next = nav.querySelector('[data-prompt-nav-action="next"]');
  if (!(previous instanceof HTMLButtonElement)) return;
  if (!(next instanceof HTMLButtonElement)) return;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const topOf = (element) => element.getBoundingClientRect().top + scrollY;
  const viewportLine = () => scrollY + 12;

  function promptBefore() {
    const line = viewportLine() - 12;
    for (let i = prompts.length - 1; i >= 0; i--) {
      if (topOf(prompts[i]) < line) return prompts[i];
    }
    return null;
  }

  function promptAfter() {
    const line = viewportLine() + 12;
    return prompts.find((prompt) => topOf(prompt) > line) ?? null;
  }

  function jumpTo(target) {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: "start",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  let frame = 0;
  function update() {
    frame = 0;
    previous.disabled = promptBefore() === null;
    next.disabled = promptAfter() === null;
  }

  function scheduleUpdate() {
    if (frame) return;
    frame = requestAnimationFrame(update);
  }

  previous.addEventListener("click", () => jumpTo(promptBefore()));
  next.addEventListener("click", () => jumpTo(promptAfter()));
  addEventListener("scroll", scheduleUpdate, { passive: true });
  addEventListener("resize", scheduleUpdate);
  update();
})();
