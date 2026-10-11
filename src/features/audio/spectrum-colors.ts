const palettes = {
  color1: [
    "000",
    "004",
    "006",
    "00a",
    "00f",
    "02f",
    "04f",
    "06f",
    "08f",
    "0af",
    "0cf",
    "0ff",
    "0fe",
    "0fc",
    "0fa",
    "0f8",
    "0f6",
    "0f4",
    "0f2",
    "0f0",
    "2f0",
    "4f0",
    "6f0",
    "8f0",
    "af0",
    "cf0",
    "fe0",
    "fc0",
    "fa0",
    "f80",
    "f60",
    "f40",
    "f20",
    "f00",
  ],
  color2: [
    "fff",
    "bbf",
    "77f",
    "33f",
    "00f",
    "07f",
    "0bf",
    "0ff",
    "0fb",
    "0f7",
    "0f0",
    "3f0",
    "7f0",
    "bf0",
    "ff0",
    "fb0",
    "f70",
    "f30",
    "f00",
  ],
};

export const spectrumColorMap = (
  name: "gray" | "roseus" | "igray" | "color1" | "color2"
): "gray" | "roseus" | "igray" | number[][] => {
  if (name !== "color1" && name !== "color2") {
    return name;
  }
  const stops = palettes[name].map((hex) =>
    hex.split("").map((digit) => Number.parseInt(digit, 16) / 15)
  );
  return Array.from({ length: 256 }, (_, index) => {
    const at = (index * (stops.length - 1)) / 255;
    const left = Math.floor(at);
    const fraction = at - left;
    return [
      ...[0, 1, 2].map(
        (channel) =>
          (stops[left]?.[channel] ?? 0) * (1 - fraction) +
          (stops[Math.min(left + 1, stops.length - 1)]?.[channel] ?? 0) *
            fraction
      ),
      1,
    ];
  });
};
