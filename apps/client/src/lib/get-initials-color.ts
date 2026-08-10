import { MantineColor } from "@mantine/core";

function hashCode(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}

export const defaultInitialsColors: MantineColor[] = [
  "blue.9",
  "grape.9",
  "indigo.9",
  "pink.9",
  "red.9",
  "violet.9",
];

export function getInitialsColor(
  name: string,
  colors: MantineColor[] = defaultInitialsColors,
) {
  const hash = hashCode(name);
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}
