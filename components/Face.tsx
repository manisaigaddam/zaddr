"use client";

import { SPRITE_FRAMES, faceUrl } from "@/lib/mosaic";

export default function Face({ id, empty }: { id?: number; empty?: boolean }) {
  if (empty || id == null) return <div className="face empty" />;
  return (
    <div
      className="face sheet"
      style={{
        backgroundImage: `url(${faceUrl(id)})`,
        ["--frames" as string]: String(SPRITE_FRAMES),
      }}
    />
  );
}
