import { useEffect } from "react";

const TARGET = "[data-controller-target]";

export function controllerNavigationEnabled(pathname: string): boolean {
  return !pathname.startsWith("/play/");
}

export function useControllerNavigation(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const move = (direction: -1 | 1) => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>(TARGET)).filter(
        (element) => !element.hasAttribute("disabled") && element.offsetParent !== null,
      );
      if (!targets.length) return;
      const current = targets.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? 0 : (current + direction + targets.length) % targets.length;
      targets[next]?.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        move(-1);
      }
      if (["ArrowRight", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    let frame = 0;
    let lastInputAt = 0;
    const poll = () => {
      const gamepad = navigator.getGamepads?.().find(Boolean);
      const now = performance.now();
      if (gamepad && now - lastInputAt > 230) {
        if (gamepad.buttons[14]?.pressed || gamepad.buttons[12]?.pressed) {
          move(-1);
          lastInputAt = now;
        } else if (gamepad.buttons[15]?.pressed || gamepad.buttons[13]?.pressed) {
          move(1);
          lastInputAt = now;
        } else if (gamepad.buttons[0]?.pressed) {
          const active = document.activeElement as HTMLElement | null;
          if (active?.matches(TARGET)) active.click();
          else move(1);
          lastInputAt = now;
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
}
