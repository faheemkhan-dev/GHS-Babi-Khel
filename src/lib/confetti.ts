import confetti from "canvas-confetti";

export function triggerConfetti(type: "burst" | "sides" | "gold" | "mini" = "burst") {
  switch (type) {
    case "burst":
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      break;
    case "sides":
      confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0 } });
      confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1 } });
      break;
    case "gold":
      confetti({
        particleCount: 80, spread: 60, origin: { y: 0.6 },
        colors: ["#1E3A8A", "#1E40AF", "#1E3A8A", "#1E40AF"],
      });
      break;
    case "mini":
      confetti({ particleCount: 15, spread: 40, origin: { y: 0.7 }, startVelocity: 20 });
      break;
  }
}
