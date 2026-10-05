import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="shell">
        <main id="conteudo" className="dash">
          <p className="error" role="alert">
            Algo correu mal nesta tela. Recarregue ou volte à biblioteca.
          </p>
          <button className="cta" type="button" onClick={() => this.setState({ error: null })}>
            Tentar de novo
          </button>
        </main>
      </div>
    );
  }
}
