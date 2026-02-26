export const TAGLINES = [
  "Drive. Drift. Repeat.",
  "Stay Sideways.",
  "Precision in Motion.",
  "Fun over friction.",
  "Feel the drift.",
  "Slide Into Control.",
  "Throttle. Angle. Smile.",
  "Grip Is Optional.",
  "Corners Are Suggestions.",
  "Steer the Chaos.",
  "Where Physics Plays.",
  "Arcade in Every Apex.",
  "Turn. Burn. Return.",
  "Full Lock Living.",
  "Lines Are Meant to Bend.",
  "Master the Angle.",
  "Balance the Drift.",
  "Control the Slip.",
  "Ride the Edge.",
  "Slide with Intent.",
  "Own the Apex.",
  "Find Your Line.",
  "Hold the Angle.",
  "Arcade by Design.",
  "Fun, Calculated.",
  "Precision. Play.",
  "Driven by Design.",
  "Control the Variables.",
  "Physics, Unleashed.",
  "Drive Different.",
  "Keep It Moving.",
  "Pure Arcade.",
  "Made to Move.",
  "Commit.",
  "No Brakes.",
  "Grip Is Overrated.",
  "Mistakes Look Better Sideways.",
  "Spin with Style.",
  "Fast Is a Feeling.",
  "More Angle, More Fun.",
  "Small Cars. Big Slides.",
  "Slide Responsibly.",
  "Lose Control. On Purpose.",
  "Drift Happens."
];

export function shuffledTaglines() {
  const items = [...TAGLINES];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function nextTaglineSet(previousSet = []) {
  const next = shuffledTaglines();
  if (next.length > 1 && previousSet.length > 0 && next[0] === previousSet[previousSet.length - 1]) {
    [next[0], next[1]] = [next[1], next[0]];
  }
  return next;
}
