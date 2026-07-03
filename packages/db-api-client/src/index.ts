export * from "./bahnExpert";
export * from "./journey";
export async function getNextTrainEta() {
  const now = new Date();

  return new Date(
    now.getTime() + 5 * 60 * 1000
  );
}