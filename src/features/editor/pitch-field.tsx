import { Button } from "../../components/ui/button";
import { SelectField } from "../../components/ui/field";
import { playTone } from "../audio/tone-player";
import { frequencyNote, NOTE_NAMES, noteFrequency } from "./pitch-settings";

export const PitchField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (hz: number) => void;
}) => {
  const note = frequencyNote(value);
  const name = ((note % 12) + 12) % 12;
  const octave = Math.floor(note / 12) - 1;
  return (
    <div className="flex items-end gap-2">
      <SelectField
        label={label}
        value={String(name)}
        options={NOTE_NAMES.map((text, index) => ({
          id: String(index),
          label: text,
        }))}
        onChange={(next) => {
          onChange(noteFrequency((octave + 1) * 12 + Number(next)));
        }}
      />
      <SelectField
        label={`${label}のオクターブ`}
        value={String(octave)}
        options={Array.from({ length: 8 }, (_, index) => ({
          id: String(index),
          label: String(index),
        }))}
        onChange={(next) => {
          onChange(noteFrequency((Number(next) + 1) * 12 + name));
        }}
      />
      <Button
        aria-label={`${label}を試聴`}
        onPress={() => {
          void playTone(value);
        }}
      >
        試聴
      </Button>
      <span className="pb-2 text-xs text-slate-400">{value.toFixed(2)} Hz</span>
    </div>
  );
};
