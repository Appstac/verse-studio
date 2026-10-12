// The effects gallery: a moving sample of every effect. Tick as many per group as you
// like; Claude picks the best of the ticked ones for each video.
import { EFFECT_GROUPS, EFFECT_INFO, type EffectGroup, type Effects } from "@shared/schema";

const GROUP_LABEL: Record<EffectGroup, { title: string; hint: string }> = {
  titles: { title: "Opening title", hint: "How the video introduces itself" },
  captions: { title: "Captions and lyrics", hint: "How words appear on screen" },
  transitions: { title: "Transitions", hint: "How shots change" },
  moves: { title: "Camera moves", hint: "How the frame moves on the person" },
  looks: { title: "Colour look", hint: "The overall grade" },
  extras: { title: "Extras", hint: "Optional touches" },
};

export function EffectsPicker({ value, onChange }: { value: Effects; onChange: (e: Effects) => void }) {
  const toggle = (g: EffectGroup, v: string) => {
    const cur = value[g] as string[];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ ...value, [g]: next } as Effects);
  };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="hint">Tick every effect you're happy with. Claude chooses the best of your ticked ones for each video and never uses anything unticked.</p>
      {(Object.keys(EFFECT_GROUPS) as EffectGroup[]).map((g) => (
        <div key={g} className="field">
          <span>
            {GROUP_LABEL[g].title} <small className="hint">· {GROUP_LABEL[g].hint} · {(value[g] as string[]).length || "none"} ticked</small>
          </span>
          <div className="fx-grid">
            {EFFECT_GROUPS[g].map((v) => {
              const key = `${g}.${v}`;
              const on = (value[g] as string[]).includes(v);
              return (
                <button key={v} type="button" className={`fx ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(g, v)} title={EFFECT_INFO[key]?.desc}>
                  <video src={`/effects/${key}.mp4`} poster={`/effects/${key}.jpg`} muted loop playsInline autoPlay preload="metadata" />
                  <span className="fx-check" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <b>{EFFECT_INFO[key]?.label ?? v}</b>
                  <small>{EFFECT_INFO[key]?.desc}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
