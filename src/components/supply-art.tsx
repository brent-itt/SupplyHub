type ArtKind = "notebook" | "pencils" | "backpack" | "art";

export function SupplyArt({
  kind,
  hero = false,
}: {
  kind: ArtKind;
  hero?: boolean;
}) {
  if (kind === "notebook") {
    return (
      <div
        className={`supply-art notebook-art ${hero ? "hero-notebooks" : ""}`}
        aria-hidden="true"
      >
        <div className="notebook notebook-back">
          <span />
        </div>
        <div className="notebook notebook-front">
          <div className="notebook-rings">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <div className="notebook-label">
            <small>A PLACE FOR</small>
            <strong>
              big
              <br />
              ideas.
            </strong>
            <span>MAKE SOMETHING GOOD.</span>
          </div>
          <span className="notebook-star">✳</span>
        </div>
      </div>
    );
  }
  if (kind === "pencils") {
    return (
      <div className="supply-art pencils-art" aria-hidden="true">
        {["orange", "green", "pink", "yellow", "blue"].map((color) => (
          <div className={`pencil pencil-${color}`} key={color}>
            <span />
            <i />
          </div>
        ))}
      </div>
    );
  }
  if (kind === "backpack") {
    return (
      <div className="supply-art backpack-art" aria-hidden="true">
        <div className="backpack-handle" />
        <div className="backpack">
          <div className="backpack-label">
            SupplyHub<span>EVERYDAY ADVENTURES</span>
          </div>
          <div className="backpack-pocket">
            <i />
          </div>
        </div>
        <div className="backpack-shadow" />
      </div>
    );
  }
  return (
    <div className="supply-art art-art" aria-hidden="true">
      <div className="paint-box">
        <div className="paint-lid" />
        <div className="paint-colors">
          {[
            "#e37762",
            "#e9bd49",
            "#537d68",
            "#6695ba",
            "#9882b1",
            "#d47794",
          ].map((color) => (
            <i key={color} style={{ background: color }} />
          ))}
        </div>
      </div>
      <div className="paintbrush" />
    </div>
  );
}
