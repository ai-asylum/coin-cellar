// Logical viewport size. On touch phones held in portrait we can't always ask
// the browser to rotate (Screen Orientation lock needs fullscreen and isn't
// supported on iOS Safari), so as a fallback we CSS-rotate #app / #hud 90° to
// render the game in landscape. When that fallback is active, `rotated` is true
// and the real window dimensions are swapped: every bit of screen-space math
// (renderer size, camera aspect, world→screen projection, the virtual joystick)
// must read w/h from here instead of window.innerWidth/innerHeight so it lines
// up with the rotated layout.
export const viewport = {
  rotated: false,
  get w() {
    return this.rotated ? window.innerHeight : window.innerWidth;
  },
  get h() {
    return this.rotated ? window.innerWidth : window.innerHeight;
  },
  // Map a real touch/pointer coordinate (screen space) into the rotated layout's
  // local space, matching the CSS `translateX(100vw) rotate(90deg)` transform.
  // In the rotated frame: local.x = screenY, local.y = screenWidth - screenX.
  toLocal(clientX, clientY) {
    if (!this.rotated) return { x: clientX, y: clientY };
    return { x: clientY, y: window.innerWidth - clientX };
  },
};
