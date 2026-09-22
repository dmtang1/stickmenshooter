export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.lmb = false;
    this.rmb = false;
    this.uiClick = false;
    this.locked = false;
    this.queued = [];
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (["KeyQ", "KeyZ", "KeyC", "KeyB", "Digit1", "Digit2", "Digit3", "Digit4", "KeyR"].includes(e.code)) {
        this.queued.push(e.code);
      }
      if (["Space", "KeyB"].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouse = (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    };
    this._onDown = (e) => {
      this.uiClick = !!e.target?.closest?.("button, input, .chip, a");
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.rmb = true;
    };
    this._onUp = (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    };
    this._onLock = () => {
      this.locked = document.pointerLockElement === canvas;
    };
    this._blockMenu = (e) => e.preventDefault();
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("mousemove", this._onMouse);
    window.addEventListener("mousedown", this._onDown);
    window.addEventListener("mouseup", this._onUp);
    window.addEventListener("contextmenu", this._blockMenu);
    document.addEventListener("pointerlockchange", this._onLock);
    canvas.addEventListener("contextmenu", this._blockMenu);
  }

  consumeLook() {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return { x, y };
  }

  consumeQueue() {
    const q = this.queued.slice();
    this.queued.length = 0;
    return q;
  }

  snapshot() {
    return {
      w: this.keys.has("KeyW"),
      a: this.keys.has("KeyA"),
      s: this.keys.has("KeyS"),
      d: this.keys.has("KeyD"),
      jump: this.keys.has("Space"),
      sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      crouch: this.keys.has("ControlLeft"),
      lmb: this.lmb,
      rmb: this.rmb,
      lookX: this.lookX,
      lookY: this.lookY,
      queued: this.consumeQueue(),
    };
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("mousemove", this._onMouse);
    window.removeEventListener("mousedown", this._onDown);
    window.removeEventListener("mouseup", this._onUp);
    window.removeEventListener("contextmenu", this._blockMenu);
    document.removeEventListener("pointerlockchange", this._onLock);
    this.canvas.removeEventListener("contextmenu", this._blockMenu);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
