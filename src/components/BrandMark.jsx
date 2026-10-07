import { Link } from "react-router-dom";

export default function BrandMark({ to = "/" }) {
  return (
    <Link className="brand" to={to}>
      <img src="/brand-mark.png" alt="" width="44" height="44" />
      <span>
        <span className="wordmark">
          PROJET<span className="aba">-ABA</span>
        </span>
        <span className="kicker">OPERADOR · PALESTRANTE · TELÃO</span>
      </span>
    </Link>
  );
}
