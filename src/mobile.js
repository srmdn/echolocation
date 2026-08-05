/**
 * Shared mobile shell helpers for the standalone game page.
 * Keeps the game playable in portrait while recommending landscape on phones.
 */

const STYLE_ID = "xgamer-mobile-shell-style";
const PROMPT_ID = "xgamer-orientation-prompt";

/** @returns {{ w: number, h: number }} */
export function viewportSize() {
  let w = Math.max(
    1,
    Math.floor(window.innerWidth || document.documentElement.clientWidth || 1)
  );
  let h = Math.max(
    1,
    Math.floor(window.innerHeight || document.documentElement.clientHeight || 1)
  );

  if (window.visualViewport) {
    w = Math.max(1, Math.floor(window.visualViewport.width || w));
    h = Math.max(1, Math.floor(Math.min(h, window.visualViewport.height || h)));
  }

  return { w, h };
}

/**
 * Add a non-blocking portrait hint for touch devices.
 * Browsers cannot reliably force orientation from an ordinary tab, so the
 * player can dismiss the hint and continue in portrait when needed.
 *
 * @param {{ game?: string, accent?: string }} [options]
 */
export function initOrientationPrompt(options = {}) {
  const existing = document.getElementById(PROMPT_ID);
  if (existing) return { refresh: () => {}, isVisible: () => !existing.hidden };

  const game = options.game || "This game";
  const accent = options.accent || "#9ec9ff";

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PROMPT_ID} {
        --orientation-accent: ${accent};
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: max(24px, env(safe-area-inset-top))
          max(18px, env(safe-area-inset-right))
          max(24px, env(safe-area-inset-bottom))
          max(18px, env(safe-area-inset-left));
        background: rgba(2, 4, 10, 0.96);
        color: #e8eef8;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        text-align: center;
        touch-action: auto;
        user-select: none;
      }

      #${PROMPT_ID}[hidden] {
        display: none;
      }

      #${PROMPT_ID} .orientation-card {
        width: min(100%, 360px);
        padding: 28px 22px 22px;
        border: 1px solid var(--orientation-accent);
        border-color: color-mix(in srgb, var(--orientation-accent) 70%, transparent);
        border-radius: 14px;
        background: rgba(12, 18, 30, 0.96);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
      }

      #${PROMPT_ID} .orientation-icon {
        display: grid;
        place-items: center;
        width: 72px;
        height: 72px;
        margin: 0 auto 18px;
        border: 2px solid var(--orientation-accent);
        border-radius: 16px;
        color: var(--orientation-accent);
        font-size: 40px;
        line-height: 1;
      }

      #${PROMPT_ID} .orientation-kicker {
        margin: 0 0 10px;
        color: var(--orientation-accent);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      #${PROMPT_ID} h1 {
        margin: 0;
        font-size: clamp(20px, 6vw, 28px);
        line-height: 1.15;
      }

      #${PROMPT_ID} p:not(.orientation-kicker) {
        margin: 14px auto 22px;
        max-width: 30ch;
        color: #9aa9bd;
        font-size: 13px;
        line-height: 1.55;
      }

      #${PROMPT_ID} button {
        min-height: 48px;
        width: 100%;
        padding: 0 16px;
        border: 1px solid var(--orientation-accent);
        border-radius: 8px;
        background: transparent;
        color: #e8eef8;
        font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        touch-action: manipulation;
      }

      #${PROMPT_ID} button:active {
        background: rgba(255, 255, 255, 0.08);
        background: color-mix(in srgb, var(--orientation-accent) 18%, transparent);
      }
    `;
    document.head.append(style);
  }

  const prompt = document.createElement("section");
  prompt.id = PROMPT_ID;
  prompt.hidden = true;
  prompt.setAttribute("aria-hidden", "true");
  prompt.setAttribute("role", "dialog");
  prompt.setAttribute("aria-modal", "true");
  prompt.setAttribute("aria-labelledby", "xgamer-orientation-title");
  prompt.innerHTML = `
    <div class="orientation-card">
      <div class="orientation-icon" aria-hidden="true">↻</div>
      <p class="orientation-kicker">Landscape recommended</p>
      <h1 id="xgamer-orientation-title"></h1>
      <p>Rotate your phone for a roomier view. The game still works in portrait if you want to keep playing this way.</p>
      <button type="button" data-orientation-continue>Play in portrait</button>
    </div>
  `;
  prompt.querySelector("h1").textContent = `${game} plays better sideways`;
  document.body.append(prompt);

  let portraitDismissed = false;

  function isTouchDevice() {
    try {
      return (
        window.matchMedia("(pointer: coarse)").matches ||
        (navigator.maxTouchPoints || 0) > 0
      );
    } catch {
      return false;
    }
  }

  function isPortrait() {
    const { w, h } = viewportSize();
    return h > w && Math.min(w, h) <= 700;
  }

  function hide() {
    prompt.hidden = true;
    prompt.setAttribute("aria-hidden", "true");
  }

  function show() {
    prompt.hidden = false;
    prompt.setAttribute("aria-hidden", "false");
  }

  function refresh() {
    if (isTouchDevice() && isPortrait() && !portraitDismissed) show();
    else hide();
  }

  prompt.querySelector("[data-orientation-continue]").addEventListener("click", () => {
    portraitDismissed = true;
    hide();
  });

  const onOrientationChange = () => {
    if (!isPortrait()) portraitDismissed = false;
    refresh();
  };

  window.addEventListener("resize", refresh, { passive: true });
  window.addEventListener("orientationchange", () => {
    window.setTimeout(onOrientationChange, 80);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", refresh, { passive: true });
  }

  refresh();
  return { refresh, isVisible: () => !prompt.hidden };
}
