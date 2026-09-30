import { Link } from "react-router-dom";

export default function BrandMark() {
  return (
    <Link className="brand" to="/" aria-label="PROJETABA início">
      <img src="/brand-mark.jpg" alt="" width="36" height="36" />
      <span>
        <span className="wordmark">
          PROJET<span className="aba">ABA</span>
        </span>
        <span className="kicker">SISTEMA DE GESTÃO E PROJEÇÃO</span>
      </span>
    </Link>
  );
}
