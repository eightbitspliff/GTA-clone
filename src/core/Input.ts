// ---------------------------------------------------------------------------
// Unified input: keyboard + mouse and Xbox / standard-mapping gamepads.
// Produces one `Controls` snapshot per frame that gameplay code consumes,
// so nothing else needs to know which device is in use.
// ---------------------------------------------------------------------------

export type Device = 'kbm' | 'pad';

export interface Controls {
  /** On-foot movement (-1..1). */
  moveX: number;
  moveY: number;
  /** Gamepad right-stick aim angle, or null when stick is centered. */
  padAim: number | null;
  /** Mouse position in screen pixels. */
  mouseX: number;
  mouseY: number;
  device: Device;
  fire: boolean;
  /** Drive-by fire (in vehicle). */
  carFire: boolean;
  interact: boolean;
  sprint: boolean;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  nitro: boolean;
  weaponNext: boolean;
  weaponPrev: boolean;
  weaponSlot: number;
  pause: boolean;
  help: boolean;
  confirm: boolean;
  quality: boolean;
}

// Standard gamepad button indices (Xbox layout)
const B_A = 0, B_B = 1, B_X = 2, B_Y = 3, B_LB = 4, B_RB = 5, B_LT = 6, B_RT = 7,
  B_BACK = 8, B_START = 9, B_DUP = 12, B_DDOWN = 13, B_DLEFT = 14, B_DRIGHT = 15;

const DEADZONE = 0.22;

function deadzone(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * s, y * s];
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = false;
  private wheel = 0;
  mouseX = 0;
  mouseY = 0;
  device: Device = 'kbm';
  padConnected = false;
  padName = '';
  private padPrev: boolean[] = [];
  private padIndex = -1;
  onDeviceMessage: ((msg: string) => void) | null = null;
  /** Called once on the first user gesture (needed to unlock audio). */
  onFirstGesture: (() => void) | null = null;
  private gestured = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.device = 'kbm';
      this.gesture();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.device = 'kbm';
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      this.pressed.add('Mouse' + e.button);
      this.device = 'kbm';
      this.gesture();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
      this.padConnected = true;
      this.padName = e.gamepad.id;
      this.onDeviceMessage?.('🎮 Controller verbunden');
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) {
        this.padIndex = -1;
        this.padConnected = false;
        this.device = 'kbm';
        this.onDeviceMessage?.('🎮 Controller getrennt');
      }
    });
  }

  private gesture() {
    if (!this.gestured) {
      this.gestured = true;
      this.onFirstGesture?.();
    }
  }

  private getPad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) {
      if (p && p.connected) {
        this.padIndex = p.index;
        this.padConnected = true;
        return p;
      }
    }
    return null;
  }

  private k(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }
  private kp(...codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }

  poll(): Controls {
    const kx = (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (this.k('KeyS', 'ArrowDown') ? 1 : 0) - (this.k('KeyW', 'ArrowUp') ? 1 : 0);

    let slot = -1;
    for (let i = 1; i <= 5; i++) if (this.kp('Digit' + i)) slot = i;

    const c: Controls = {
      moveX: kx,
      moveY: ky,
      padAim: null,
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      device: this.device,
      fire: this.mouseDown || this.k('ControlLeft', 'ControlRight'),
      carFire: this.mouseDown || this.k('ControlLeft', 'ControlRight'),
      interact: this.kp('KeyF', 'Enter'),
      sprint: this.k('ShiftLeft', 'ShiftRight'),
      throttle: this.k('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.k('KeyS', 'ArrowDown') ? 1 : 0,
      steer: kx,
      handbrake: this.k('Space'),
      nitro: this.k('ShiftLeft', 'ShiftRight'),
      weaponNext: this.kp('KeyE') || this.wheel > 0,
      weaponPrev: this.kp('KeyQ') || this.wheel < 0,
      weaponSlot: slot,
      pause: this.kp('Escape', 'KeyP'),
      help: this.kp('KeyH'),
      quality: this.kp('KeyG'),
      confirm: this.kp('Enter', 'Space', 'Mouse0'),
    };

    const pad = this.getPad();
    if (pad) {
      const btn = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      const val = (i: number) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const pressedNow = (i: number) => btn(i) && !this.padPrev[i];

      const [lx, ly] = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      const [rx, ry] = deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      const dx = (btn(B_DRIGHT) ? 1 : 0) - (btn(B_DLEFT) ? 1 : 0);
      const dy = (btn(B_DDOWN) ? 1 : 0) - (btn(B_DUP) ? 1 : 0);

      let active = Math.hypot(lx, ly) > 0 || Math.hypot(rx, ry) > 0 || dx !== 0 || dy !== 0;
      for (let i = 0; i < pad.buttons.length; i++) if (btn(i)) active = true;
      if (active) this.device = 'pad';
      c.device = this.device;

      c.moveX = Math.max(-1, Math.min(1, c.moveX + lx + dx));
      c.moveY = Math.max(-1, Math.min(1, c.moveY + ly + dy));
      c.steer = Math.max(-1, Math.min(1, c.steer + lx + dx));
      if (Math.hypot(rx, ry) > 0.35) c.padAim = Math.atan2(ry, rx);

      const rt = val(B_RT), lt = val(B_LT);
      c.fire = c.fire || rt > 0.35 || btn(B_X);
      c.carFire = c.carFire || btn(B_X);
      c.throttle = Math.max(c.throttle, rt);
      c.brake = Math.max(c.brake, lt);
      c.handbrake = c.handbrake || btn(B_A);
      c.sprint = c.sprint || btn(B_A);
      c.nitro = c.nitro || btn(B_B);
      c.interact = c.interact || pressedNow(B_Y);
      c.weaponNext = c.weaponNext || pressedNow(B_RB);
      c.weaponPrev = c.weaponPrev || pressedNow(B_LB);
      c.pause = c.pause || pressedNow(B_START);
      c.help = c.help || pressedNow(B_BACK);
      c.confirm = c.confirm || pressedNow(B_A) || pressedNow(B_START);

      this.padPrev = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    }
    return c;
  }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
  }

  rumble(strong: number, weak: number, ms: number) {
    if (this.device !== 'pad') return;
    const pad = this.getPad();
    const act = pad && (pad as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }).vibrationActuator;
    try {
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {});
    } catch {
      /* rumble unsupported */
    }
  }
}
