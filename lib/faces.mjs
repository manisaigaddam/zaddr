export const FACES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22, 29, 39, 42];

export function faceUrl(id) {
  return `https://zaddr.net/assets/mosaic/${id}.png`;
}

export function pickFace(used) {
  const pool = FACES.filter((id) => !used.includes(id));
  const src = pool.length ? pool : FACES;
  return src[Math.floor(Math.random() * src.length)];
}
