export function createSfx() {
  let ctx;
  const ensure = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };

  const beep = (freq, dur, type = "square", gain = 0.05, slide = 0) => {
    const ac = ensure();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };

  return {
    shoot: () => beep(180, 0.07, "square", 0.04, -80),
    hit: () => beep(520, 0.05, "square", 0.05),
    build: () => beep(240, 0.08, "triangle", 0.04, 40),
    hurt: () => beep(90, 0.12, "sawtooth", 0.06, -40),
    storm: () => beep(70, 0.4, "sine", 0.03, 20),
    win: () => {
      beep(440, 0.12, "square", 0.05);
      setTimeout(() => beep(660, 0.16, "square", 0.05), 120);
    },
    lose: () => beep(110, 0.4, "sawtooth", 0.05, -70),
  };
}
