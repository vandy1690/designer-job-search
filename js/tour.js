// The tour: right after setup, a spotlight on one real control at a time, with a card that says
// what to do there. A local piece (dash-tour), built on the SDC tokens; not a library.
//
// How it behaves:
//   - A modal <dialog> covers the page, so the page is inert, focus stays in the card, and Escape
//     skips the tour. The spotlight is a hole in a dimmed layer, drawn with the scrim token.
//   - Each step names where it points ("In the sidebar"), visibly and for screen readers, and a
//     hidden live region reads the new step when it changes. Focus stays on Next.
//   - With reduced motion, the spotlight and card jump instead of gliding (CSS only).
// Steps are data from app.js: { view, target, where, title, text }. go(view) opens a page;
// onEnd("done" | "skipped") saves the outcome.

export function runTour(steps, { go, onEnd }) {
  let i = 0;
  let ended = false;
  const dlg = document.createElement("dialog");
  dlg.className = "dash-tour";
  dlg.setAttribute("aria-labelledby", "tour-title");
  dlg.setAttribute("aria-describedby", "tour-text");
  dlg.innerHTML = `<div class="dash-tour__spot" aria-hidden="true"></div>
    <div class="dash-tour__card">
      <p class="sdc-eyebrow sdc-eyebrow--mute dash-tour__count" id="tour-count"></p>
      <h2 class="sdc-display-3" id="tour-title"></h2>
      <p class="dash-tour__text" id="tour-text"></p>
      <p class="sdc-u-sr-only" id="tour-live" aria-live="polite"></p>
      <div class="dash-tour__actions">
        <button type="button" class="dash-linkbtn" data-tour="skip">Skip the tour</button>
        <span class="dash-toolbar__grow"></span>
        <button type="button" class="sdc-btn" data-tour="back">Back</button>
        <button type="button" class="sdc-btn sdc-btn--primary" data-tour="next" autofocus>Next</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  const $ = (id) => dlg.querySelector(`#${id}`);
  const spot = dlg.querySelector(".dash-tour__spot");
  const card = dlg.querySelector(".dash-tour__card");
  const back = dlg.querySelector('[data-tour="back"]');
  const next = dlg.querySelector('[data-tour="next"]');
  const gap = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sdc-space-sm")) || 16;

  // Spotlight the target, then put the card beside it: to the right of a sidebar item, otherwise
  // below, above or to the left, whichever fits, always inside the window.
  function place() {
    if (ended) return;
    const s = steps[i];
    const t = document.querySelector(s.target);
    const vw = window.innerWidth, vh = window.innerHeight, g = gap();
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!t || !t.getClientRects().length) {
      spot.hidden = true;
      card.style.left = `${Math.max(g, (vw - cw) / 2)}px`;
      card.style.top = `${Math.max(g, (vh - ch) / 2)}px`;
      return;
    }
    const r = t.getBoundingClientRect();
    if (r.top < 0 || r.bottom > vh) { t.scrollIntoView({ block: "center" }); return requestAnimationFrame(place); }
    const pad = g / 2;
    spot.hidden = false;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const fits = {
      right: r.right + g + cw <= vw - g,
      below: r.bottom + g + ch <= vh - g,
      above: r.top - g - ch >= g,
      left: r.left - g - cw >= g
    };
    const side = r.left < vw * 0.3 && fits.right ? "right" : fits.below ? "below" : fits.above ? "above" : fits.left ? "left" : "below";
    let left, top;
    if (side === "right") { left = r.right + g; top = r.top - pad; }
    else if (side === "left") { left = r.left - g - cw; top = r.top - pad; }
    else { left = r.left - pad; top = side === "below" ? r.bottom + g : r.top - g - ch; }
    card.style.left = `${Math.min(Math.max(g, left), vw - cw - g)}px`;
    card.style.top = `${Math.min(Math.max(g, top), vh - ch - g)}px`;
  }

  function show(n) {
    i = n;
    const s = steps[i];
    const last = i === steps.length - 1;
    $("tour-count").textContent = `Step ${i + 1} of ${steps.length} · ${s.where}`;
    $("tour-title").textContent = s.title;
    $("tour-text").textContent = s.text;
    $("tour-live").textContent = `Step ${i + 1} of ${steps.length}. ${s.title}, ${s.where.toLowerCase()}. ${s.text}`;
    back.hidden = i === 0;
    next.textContent = last ? "Done" : "Next";
    go(s.view);
    // Focus first, so Safari does not leave it on the first button; then, two frames on, the page
    // has drawn the new view and the card is measured and placed.
    next.focus();
    requestAnimationFrame(() => requestAnimationFrame(place));
  }

  function end(how) {
    if (ended) return;
    ended = true;
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
    watch.disconnect();
    dlg.close();
    dlg.remove();
    onEnd(how);
  }

  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tour]");
    if (!b) return;
    const act = b.dataset.tour;
    if (act === "skip") end("skipped");
    else if (act === "back") show(Math.max(0, i - 1));
    else if (i === steps.length - 1) end("done");
    else show(i + 1);
  });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); end("skipped"); });
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  // The app redraws pages as data comes in (a first pull, a job check). Keep the spotlight on target.
  let queued = false;
  const watch = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; place(); }); });
  watch.observe(document.querySelector(".dash-shell"), { childList: true, subtree: true });

  dlg.showModal();
  show(0);
}
