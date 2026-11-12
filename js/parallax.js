const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
let pointerX = 0;
let pointerY = 0;
let frame = 0;

function paint() {
  frame = 0;
  const scroll = Math.min(360, Math.max(0, window.scrollY));
  root.style.setProperty("--stars-x", `${pointerX * 8}px`);
  root.style.setProperty("--stars-y", `${pointerY * 6 + scroll * 0.025}px`);
  root.style.setProperty("--horizon-x", `${pointerX * 22}px`);
  root.style.setProperty("--horizon-y", `${pointerY * 13 + scroll * 0.075}px`);
}

function schedulePaint() {
  if (!frame && !reducedMotion.matches) frame = window.requestAnimationFrame(paint);
}

function centerPointer() {
  pointerX = 0;
  pointerY = 0;
  schedulePaint();
}

window.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse" || !finePointer.matches || reducedMotion.matches) return;
  pointerX = 2 * event.clientX / window.innerWidth - 1;
  pointerY = 2 * event.clientY / window.innerHeight - 1;
  schedulePaint();
}, { passive: true });

root.addEventListener("pointerleave", centerPointer);
window.addEventListener("blur", centerPointer);
window.addEventListener("scroll", schedulePaint, { passive: true });
reducedMotion.addEventListener("change", centerPointer);
schedulePaint();
